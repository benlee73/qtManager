use crate::{ApplicationError, Clock, IdGenerator, PortError, RuntimeServices};
use qt_domain::{ChangeLog, OneTimePurchase, PaymentStatus, Person, Subscription};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub enum PaymentIntake {
    Subscription(Person, Subscription),
    Purchase(Option<Person>, OneTimePurchase),
}

pub trait PaymentRepository {
    fn payment_operator(&self) -> Result<Option<String>, PortError>;
    fn payment_intakes(&self) -> Result<Vec<PaymentIntake>, PortError>;
    fn save_payment_changes(
        &mut self,
        changes: &[(PaymentIntake, ChangeLog)],
    ) -> Result<(), PortError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentKind {
    Subscription,
    Purchase,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentView {
    pub id: String,
    pub kind: PaymentKind,
    pub person_id: Option<String>,
    pub name: String,
    pub cohort: Option<String>,
    pub issue: String,
    pub quantity: u32,
    pub applied_at: String,
    pub status: PaymentStatus,
    pub updated_at: String,
}

impl PaymentIntake {
    fn view(&self) -> Option<PaymentView> {
        match self {
            Self::Subscription(person, subscription)
                if !person.is_group && subscription.archived_at.is_none() =>
            {
                Some(PaymentView {
                    id: subscription.id.clone(),
                    kind: PaymentKind::Subscription,
                    person_id: Some(person.id.clone()),
                    name: person.name.clone(),
                    cohort: person.cohort.clone(),
                    issue: subscription.start_issue.display_name(),
                    quantity: subscription.quantity,
                    applied_at: subscription
                        .applied_at
                        .clone()
                        .unwrap_or_else(|| subscription.created_at.clone()),
                    status: subscription.payment_status?,
                    updated_at: subscription.updated_at.clone(),
                })
            }
            Self::Purchase(person, purchase)
                if !purchase.is_group_distribution
                    && purchase.reversal_of.is_none()
                    && !person.as_ref().is_some_and(|person| person.is_group) =>
            {
                Some(PaymentView {
                    id: purchase.id.clone(),
                    kind: PaymentKind::Purchase,
                    person_id: purchase.person_id.clone(),
                    name: person
                        .as_ref()
                        .map(|p| p.name.clone())
                        .or_else(|| purchase.buyer_name.clone())
                        .unwrap_or_else(|| "익명 구매".into()),
                    cohort: person.as_ref().and_then(|p| p.cohort.clone()),
                    issue: purchase.issue.display_name(),
                    quantity: purchase.quantity,
                    applied_at: purchase.purchased_at.clone(),
                    status: purchase.payment_status?,
                    updated_at: purchase.updated_at.clone(),
                })
            }
            _ => None,
        }
    }
}

pub fn load_payments<R: PaymentRepository>(
    repository: &R,
) -> Result<Vec<PaymentView>, ApplicationError> {
    let mut rows = repository
        .payment_intakes()?
        .iter()
        .filter_map(PaymentIntake::view)
        .collect::<Vec<_>>();
    // Display order is stable while the operator checks a bank statement.
    rows.sort_by(|a, b| a.applied_at.cmp(&b.applied_at).then(a.id.cmp(&b.id)));
    Ok(rows)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSelection {
    pub id: String,
    pub kind: PaymentKind,
}

pub fn set_payment_confirmed<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<'_, C, I>,
    selections: Vec<PaymentSelection>,
    confirmed: bool,
) -> Result<(), ApplicationError>
where
    R: PaymentRepository,
    C: Clock,
    I: IdGenerator,
{
    let operator = repository
        .payment_operator()?
        .filter(|name| !name.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)?;
    let now = runtime.clock.now();
    let status = if confirmed {
        PaymentStatus::Confirmed
    } else {
        PaymentStatus::Pending
    };
    let mut intakes = repository.payment_intakes()?;
    let mut changes = Vec::new();
    for selection in selections {
        let intake = intakes
            .iter_mut()
            .find(|intake| {
                intake
                    .view()
                    .is_some_and(|view| view.id == selection.id && view.kind == selection.kind)
            })
            .ok_or(ApplicationError::MissingDeskRecord)?;
        let before = intake.view().ok_or(ApplicationError::MissingDeskRecord)?;
        if before.status == status {
            continue;
        }
        match intake {
            PaymentIntake::Subscription(_, subscription) => {
                subscription.payment_status = Some(status);
                subscription.updated_at = now.clone();
            }
            PaymentIntake::Purchase(_, purchase) => {
                purchase.payment_status = Some(status);
                purchase.updated_at = now.clone();
            }
        }
        changes.push((
            intake.clone(),
            ChangeLog {
                id: runtime.ids.next_id(),
                occurred_at: now.clone(),
                operator_name: operator.clone(),
                action_type: if confirmed {
                    "payment_confirmed"
                } else {
                    "payment_confirmation_reverted"
                }
                .into(),
                entity_type: match selection.kind {
                    PaymentKind::Subscription => "subscription",
                    PaymentKind::Purchase => "one_time_purchase",
                }
                .into(),
                entity_id: selection.id,
                summary: if confirmed {
                    "입금 확인"
                } else {
                    "입금 확인 취소"
                }
                .into(),
                before_json: Some(format!("payment_status={}", before.status.as_str())),
                after_json: Some(format!("payment_status={}", status.as_str())),
            },
        ));
    }
    repository.save_payment_changes(&changes)?;
    Ok(())
}
