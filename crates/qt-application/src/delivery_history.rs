//! Per-row delivery changes never alter profile or purchase/payment fields.
use crate::{
    ApplicationError, Clock, IdGenerator, OperationBatch, OperationsRepository, PortError,
    RuntimeServices,
};
use qt_domain::{ChangeLog, Distribution, OneTimePurchase, PersonStatus};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryHistoryKind {
    Distribution,
    Purchase,
    PurchaseDelivery,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryHistoryRequest {
    pub person_id: String,
    pub record_id: String,
    pub kind: DeliveryHistoryKind,
    #[serde(default)]
    pub purchase_id: Option<String>,
    #[serde(default)]
    pub restore: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryHistoryChange {
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub record_id: String,
    pub kind: DeliveryHistoryKind,
    pub purchase_id: Option<String>,
}
fn unavailable() -> ApplicationError {
    PortError::new("변경할 배부 기록이 없거나 이미 취소·복구됐습니다. 이력을 다시 확인하세요.")
        .into()
}
pub fn change_delivery_history<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: DeliveryHistoryRequest,
) -> Result<DeliveryHistoryChange, ApplicationError> {
    let record = repo
        .load_person(&request.person_id)?
        .filter(|r| r.person.status != PersonStatus::Archived)
        .ok_or_else(unavailable)?;
    let operator = repo
        .current_operator()?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)?;
    let mut batch = OperationBatch {
        expected_person: Some(record.person.clone()),
        ..Default::default()
    };
    let now = runtime.clock.now();
    // A restoration has a stable ID so retried requests cannot add the quantity twice.
    let new_id = if request.restore {
        format!("restored:{}", request.record_id)
    } else {
        runtime.ids.next_id()
    };
    let (quantity, issue, entity_type) = match request.kind {
        DeliveryHistoryKind::Distribution => {
            let original = record
                .distributions
                .iter()
                .find(|d| d.id == request.record_id)
                .ok_or_else(unavailable)?;
            if original.reversal_of.is_some() != request.restore
                || record
                    .distributions
                    .iter()
                    .any(|d| d.reversal_of.as_deref() == Some(&original.id) || d.id == new_id)
            {
                return Err(unavailable());
            }
            let changed = Distribution {
                id: new_id.clone(),
                reversal_of: if request.restore {
                    None
                } else {
                    Some(original.id.clone())
                },
                distributed_at: now.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
                note: Some(
                    if request.restore {
                        "배부 이력 복구"
                    } else {
                        "배부 이력 취소"
                    }
                    .into(),
                ),
                ..original.clone()
            };
            changed.validate()?;
            batch.expected_distribution = Some(original.clone());
            batch.distributions.push(changed);
            (original.quantity, original.issue, "distribution")
        }
        DeliveryHistoryKind::Purchase => {
            if !record.person.is_group {
                return Err(unavailable());
            }
            let purchases = repo.list_person_purchases(&request.person_id)?;
            let original = purchases
                .iter()
                .find(|p| p.id == request.record_id && p.is_group_distribution)
                .ok_or_else(unavailable)?;
            if original.reversal_of.is_some() != request.restore
                || purchases
                    .iter()
                    .any(|p| p.reversal_of.as_deref() == Some(&original.id) || p.id == new_id)
            {
                return Err(unavailable());
            }
            let changed = OneTimePurchase {
                id: new_id.clone(),
                reversal_of: if request.restore {
                    None
                } else {
                    Some(original.id.clone())
                },
                correction_of: None,
                purchased_at: now.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
                note: Some(
                    if request.restore {
                        "배부 이력 복구"
                    } else {
                        "배부 이력 취소"
                    }
                    .into(),
                ),
                ..original.clone()
            };
            changed.validate()?;
            batch.expected_purchase = Some(original.clone());
            batch.purchases.push(changed);
            (original.quantity, original.issue, "one_time_purchase")
        }
        DeliveryHistoryKind::PurchaseDelivery => {
            let purchases = repo.list_person_purchases(&request.person_id)?;
            let original = purchases
                .iter()
                .find(|p| {
                    Some(&p.id) == request.purchase_id.as_ref()
                        && !p.is_group_distribution
                        && p.reversal_of.is_none()
                        && !purchases
                            .iter()
                            .any(|r| r.reversal_of.as_deref() == Some(&p.id))
                })
                .ok_or_else(unavailable)?;
            let mut deliveries = original.deliveries();
            let delivery = deliveries
                .iter()
                .find(|d| d.id == request.record_id)
                .cloned()
                .ok_or_else(unavailable)?;
            if delivery.reversal_of.is_some() != request.restore
                || deliveries
                    .iter()
                    .any(|d| d.reversal_of.as_deref() == Some(&delivery.id) || d.id == new_id)
            {
                return Err(unavailable());
            }
            deliveries.push(qt_domain::PurchaseDelivery {
                id: new_id.clone(),
                reversal_of: if request.restore {
                    None
                } else {
                    Some(delivery.id.clone())
                },
                distributed_at: now.clone(),
                ..delivery.clone()
            });
            let mut changed = original.clone();
            changed.delivery_records = Some(deliveries);
            changed.updated_at = now.clone();
            changed.validate()?;
            batch.expected_purchase = Some(original.clone());
            batch.purchases.push(changed);
            (delivery.quantity, delivery.issue, "purchase_delivery")
        }
    };
    batch.changes.push(ChangeLog {
        id: format!("history-change:{new_id}"),
        occurred_at: now,
        operator_name: operator,
        action_type: if request.restore {
            "distribution_restored"
        } else {
            "distribution_reversed"
        }
        .into(),
        entity_type: entity_type.into(),
        entity_id: new_id.clone(),
        summary: format!(
            "배부 이력 {quantity}권 {}",
            if request.restore { "복구" } else { "취소" }
        ),
        before_json: None,
        after_json: None,
    });
    repo.save_operation(&batch)?;
    Ok(DeliveryHistoryChange {
        issue_year: issue.year,
        issue_month: issue.start_month,
        quantity,
        record_id: new_id,
        kind: request.kind,
        purchase_id: request.purchase_id,
    })
}
