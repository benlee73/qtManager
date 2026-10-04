use serde::{Deserialize, Serialize};

use crate::records::{required_id, timestamp};
use crate::{DomainError, Issue, Subscription, SubscriptionStatus};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Distribution {
    pub id: String,
    pub subscription_id: String,
    pub issue: Issue,
    pub quantity: u32,
    pub distributed_at: String,
    pub note: Option<String>,
    pub reversal_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Distribution {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "distribution_id")?;
        required_id(&self.subscription_id, "distribution_subscription_id")?;
        if self.quantity == 0 {
            return Err(DomainError::InvalidQuantity);
        }
        timestamp(&self.distributed_at, "distributed_at")?;
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DistributionStatus {
    NotEligible,
    Undistributed,
    Partial,
    Complete,
    Overdistributed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DistributionAssessment {
    pub status: DistributionStatus,
    pub target_quantity: u32,
    pub distributed_quantity: u32,
    pub remaining_quantity: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlannedDistribution {
    pub quantity: u32,
    pub completes_issue: bool,
}

pub fn assess_distribution(
    subscription: &Subscription,
    selected_issue: Issue,
    has_subscription_conflict: bool,
    distributions: &[Distribution],
) -> Result<DistributionAssessment, DomainError> {
    let subscription_status = subscription
        .assess(selected_issue, has_subscription_conflict)?
        .status;
    if subscription_status != SubscriptionStatus::Active {
        return Ok(DistributionAssessment {
            status: DistributionStatus::NotEligible,
            target_quantity: subscription.quantity,
            distributed_quantity: 0,
            remaining_quantity: subscription.quantity,
        });
    }

    let distributed = net_distributed(subscription, selected_issue, distributions)?;
    let status = match distributed.cmp(&i64::from(subscription.quantity)) {
        std::cmp::Ordering::Less if distributed == 0 => DistributionStatus::Undistributed,
        std::cmp::Ordering::Less => DistributionStatus::Partial,
        std::cmp::Ordering::Equal => DistributionStatus::Complete,
        std::cmp::Ordering::Greater => DistributionStatus::Overdistributed,
    };
    Ok(DistributionAssessment {
        status,
        target_quantity: subscription.quantity,
        distributed_quantity: u32::try_from(distributed)
            .map_err(|_| DomainError::InvalidDistributionHistory)?,
        remaining_quantity: subscription
            .quantity
            .saturating_sub(u32::try_from(distributed).unwrap_or(u32::MAX)),
    })
}

pub fn plan_distribution(
    subscription: &Subscription,
    selected_issue: Issue,
    has_subscription_conflict: bool,
    distributions: &[Distribution],
    requested_quantity: Option<u32>,
) -> Result<PlannedDistribution, DomainError> {
    let assessment = assess_distribution(
        subscription,
        selected_issue,
        has_subscription_conflict,
        distributions,
    )?;
    if assessment.status == DistributionStatus::NotEligible {
        return Err(DomainError::DistributionNotEligible);
    }
    if assessment.remaining_quantity == 0 {
        return Err(DomainError::DistributionAlreadyComplete);
    }
    let quantity = requested_quantity.unwrap_or(assessment.remaining_quantity);
    if quantity == 0 {
        return Err(DomainError::InvalidQuantity);
    }
    if quantity > assessment.remaining_quantity {
        return Err(DomainError::DistributionExceedsRemaining {
            requested: quantity,
            remaining: assessment.remaining_quantity,
        });
    }
    Ok(PlannedDistribution {
        quantity,
        completes_issue: quantity == assessment.remaining_quantity,
    })
}

fn net_distributed(
    subscription: &Subscription,
    selected_issue: Issue,
    distributions: &[Distribution],
) -> Result<i64, DomainError> {
    let mut delivered = 0_i64;
    let mut reversed = 0_i64;
    for distribution in distributions.iter().filter(|distribution| {
        distribution.subscription_id == subscription.id && distribution.issue == selected_issue
    }) {
        distribution.validate()?;
        let quantity = i64::from(distribution.quantity);
        if distribution.reversal_of.is_some() {
            reversed += quantity;
        } else {
            delivered += quantity;
        }
    }
    delivered
        .checked_sub(reversed)
        .filter(|total| *total >= 0)
        .ok_or(DomainError::InvalidDistributionHistory)
}

#[cfg(test)]
mod tests {
    use crate::{SubscriptionSource, subscription::Subscription};

    use super::*;

    fn subscription() -> Subscription {
        Subscription {
            payment_status: None,
            id: "subscription-1".into(),
            person_id: "person-1".into(),
            start_issue: Issue::new(2026, 1).unwrap(),
            issue_count: 6,
            quantity: 2,
            applied_at: None,
            source: SubscriptionSource::Manual,
            source_reference: None,
            memo: None,
            created_at: "2026-01-01T00:00:00+09:00".into(),
            updated_at: "2026-01-01T00:00:00+09:00".into(),
            archived_at: None,
        }
    }

    fn distribution(id: &str, quantity: u32, reversal_of: Option<&str>) -> Distribution {
        Distribution {
            id: id.into(),
            subscription_id: "subscription-1".into(),
            issue: Issue::new(2026, 3).unwrap(),
            quantity,
            distributed_at: "2026-02-22T12:00:00+09:00".into(),
            note: None,
            reversal_of: reversal_of.map(str::to_owned),
            created_at: "2026-02-22T12:00:00+09:00".into(),
            updated_at: "2026-02-22T12:00:00+09:00".into(),
        }
    }

    #[test]
    fn defaults_to_all_remaining_books_and_supports_partial_distribution() {
        let subscription = subscription();
        let issue = Issue::new(2026, 3).unwrap();

        assert_eq!(
            plan_distribution(&subscription, issue, false, &[], None).unwrap(),
            PlannedDistribution {
                quantity: 2,
                completes_issue: true
            }
        );
        assert_eq!(
            plan_distribution(&subscription, issue, false, &[], Some(1)).unwrap(),
            PlannedDistribution {
                quantity: 1,
                completes_issue: false
            }
        );
    }

    #[test]
    fn reports_partial_complete_overdistributed_and_reversal() {
        let subscription = subscription();
        let issue = Issue::new(2026, 3).unwrap();
        let one = distribution("distribution-1", 1, None);
        let two = distribution("distribution-2", 1, None);
        let extra = distribution("distribution-3", 1, None);
        let reversal = distribution("distribution-4", 1, Some("distribution-2"));

        assert_eq!(
            assess_distribution(&subscription, issue, false, std::slice::from_ref(&one))
                .unwrap()
                .status,
            DistributionStatus::Partial
        );
        assert_eq!(
            assess_distribution(&subscription, issue, false, &[one.clone(), two.clone()])
                .unwrap()
                .status,
            DistributionStatus::Complete
        );
        assert_eq!(
            assess_distribution(
                &subscription,
                issue,
                false,
                &[one.clone(), two.clone(), extra]
            )
            .unwrap()
            .status,
            DistributionStatus::Overdistributed
        );
        assert_eq!(
            assess_distribution(&subscription, issue, false, &[one, two, reversal])
                .unwrap()
                .status,
            DistributionStatus::Partial
        );
    }

    #[test]
    fn blocks_ineligible_duplicate_and_excess_distribution() {
        let subscription = subscription();
        let active = Issue::new(2026, 3).unwrap();
        let expired = Issue::new(2027, 1).unwrap();
        let complete = [distribution("distribution-1", 2, None)];

        assert_eq!(
            plan_distribution(&subscription, expired, false, &[], None),
            Err(DomainError::DistributionNotEligible)
        );
        assert_eq!(
            plan_distribution(&subscription, active, false, &complete, None),
            Err(DomainError::DistributionAlreadyComplete)
        );
        assert_eq!(
            plan_distribution(&subscription, active, false, &[], Some(3)),
            Err(DomainError::DistributionExceedsRemaining {
                requested: 3,
                remaining: 2
            })
        );
    }

    #[test]
    fn reversal_calculation_does_not_depend_on_input_order() {
        let subscription = subscription();
        let issue = Issue::new(2026, 3).unwrap();
        let original = distribution("distribution-1", 1, None);
        let reversal = distribution("distribution-2", 1, Some("distribution-1"));

        assert_eq!(
            assess_distribution(&subscription, issue, false, &[reversal, original])
                .unwrap()
                .status,
            DistributionStatus::Undistributed
        );
    }
}
