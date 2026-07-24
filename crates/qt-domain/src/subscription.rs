use serde::{Deserialize, Serialize};

use crate::records::{required_id, timestamp};
use crate::{DomainError, Issue};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionSource {
    GoogleForm,
    OnSite,
    LegacyXlsx,
    Manual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Scheduled,
    Active,
    Expired,
    NeedsReview,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SubscriptionAssessment {
    pub status: SubscriptionStatus,
    pub last_issue: Issue,
    pub is_last_issue: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub person_id: String,
    pub start_issue: Issue,
    pub issue_count: u16,
    pub quantity: u32,
    pub applied_at: Option<String>,
    pub source: SubscriptionSource,
    pub source_reference: Option<String>,
    pub memo: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

impl Subscription {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "subscription_id")?;
        required_id(&self.person_id, "subscription_person_id")?;
        if self.issue_count == 0 {
            return Err(DomainError::InvalidIssueCount);
        }
        if self.quantity == 0 {
            return Err(DomainError::InvalidQuantity);
        }
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }

    pub fn last_issue(&self) -> Result<Issue, DomainError> {
        self.validate()?;
        Ok(self.start_issue.advance(self.issue_count - 1))
    }

    pub fn includes(&self, issue: Issue) -> Result<bool, DomainError> {
        Ok(issue >= self.start_issue && issue <= self.last_issue()?)
    }

    pub fn assess(
        &self,
        selected_issue: Issue,
        has_conflict: bool,
    ) -> Result<SubscriptionAssessment, DomainError> {
        let last_issue = self.last_issue()?;
        let status = if has_conflict {
            SubscriptionStatus::NeedsReview
        } else if selected_issue < self.start_issue {
            SubscriptionStatus::Scheduled
        } else if selected_issue > last_issue {
            SubscriptionStatus::Expired
        } else {
            SubscriptionStatus::Active
        };
        Ok(SubscriptionAssessment {
            status,
            last_issue,
            is_last_issue: selected_issue == last_issue,
        })
    }

    pub fn overlaps(&self, other: &Self) -> Result<bool, DomainError> {
        if self.person_id != other.person_id {
            return Ok(false);
        }
        Ok(self.start_issue <= other.last_issue()? && other.start_issue <= self.last_issue()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn annual_subscription(start_issue: Issue) -> Subscription {
        Subscription {
            id: "subscription-1".into(),
            person_id: "person-1".into(),
            start_issue,
            issue_count: 6,
            quantity: 2,
            applied_at: None,
            source: SubscriptionSource::Manual,
            source_reference: None,
            memo: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
            archived_at: None,
        }
    }

    #[test]
    fn annual_subscription_contains_exactly_six_issues() {
        for start_month in [1, 3, 5, 7, 9, 11] {
            let start = Issue::new(2026, start_month).unwrap();
            let subscription = annual_subscription(start);

            assert!(subscription.includes(start.advance(5)).unwrap());
            assert!(!subscription.includes(start.advance(6)).unwrap());
            assert_eq!(subscription.last_issue().unwrap(), start.advance(5));
        }
    }

    #[test]
    fn assesses_scheduled_active_last_and_expired_by_issue_not_today() {
        let subscription = annual_subscription(Issue::new(2026, 7).unwrap());

        assert_eq!(
            subscription
                .assess(Issue::new(2026, 5).unwrap(), false)
                .unwrap()
                .status,
            SubscriptionStatus::Scheduled
        );
        assert_eq!(
            subscription
                .assess(Issue::new(2026, 7).unwrap(), false)
                .unwrap()
                .status,
            SubscriptionStatus::Active
        );
        assert!(
            subscription
                .assess(Issue::new(2027, 5).unwrap(), false)
                .unwrap()
                .is_last_issue
        );
        assert_eq!(
            subscription
                .assess(Issue::new(2027, 7).unwrap(), false)
                .unwrap()
                .status,
            SubscriptionStatus::Expired
        );
    }

    #[test]
    fn detects_overlap_only_for_same_person() {
        let first = annual_subscription(Issue::new(2026, 1).unwrap());
        let mut overlapping = annual_subscription(Issue::new(2026, 11).unwrap());
        overlapping.id = "subscription-2".into();

        assert!(first.overlaps(&overlapping).unwrap());
        overlapping.person_id = "person-2".into();
        assert!(!first.overlaps(&overlapping).unwrap());
    }

    #[test]
    fn marks_conflicting_subscription_for_review() {
        let subscription = annual_subscription(Issue::new(2026, 1).unwrap());

        assert_eq!(
            subscription
                .assess(Issue::new(2026, 3).unwrap(), true)
                .unwrap()
                .status,
            SubscriptionStatus::NeedsReview
        );
    }
}
