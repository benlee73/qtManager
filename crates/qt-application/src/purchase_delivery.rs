use crate::{
    ApplicationError, Clock, IdGenerator, OperationBatch, OperationsRepository, PortError,
    RuntimeServices,
};
use qt_domain::{ChangeLog, Issue, PersonStatus, PurchaseDelivery};
use serde::Deserialize;
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseDeliveryRequest {
    pub person_id: String,
    pub purchase_id: String,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
}
pub fn record_purchase_delivery<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: PurchaseDeliveryRequest,
) -> Result<String, ApplicationError> {
    let person = repo
        .load_person(&request.person_id)?
        .filter(|r| !r.person.is_group && r.person.status != PersonStatus::Archived)
        .ok_or(ApplicationError::MissingDeskRecord)?
        .person;
    let purchases = repo.list_person_purchases(&request.person_id)?;
    let original = purchases
        .iter()
        .find(|p| {
            p.id == request.purchase_id
                && !p.is_group_distribution
                && p.reversal_of.is_none()
                && !purchases
                    .iter()
                    .any(|r| r.reversal_of.as_deref() == Some(&p.id))
        })
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    if original.issue != issue {
        return Err(qt_domain::DomainError::DistributionNotEligible.into());
    }
    let remaining = original
        .quantity
        .saturating_sub(original.delivered_quantity(issue));
    if request.quantity == 0 || request.quantity > remaining {
        return Err(qt_domain::DomainError::DistributionExceedsRemaining {
            requested: request.quantity,
            remaining,
        }
        .into());
    }
    let operator = repo
        .current_operator()?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)?;
    let now = runtime.clock.now();
    let id = runtime.ids.next_id();
    let mut deliveries = original.deliveries();
    deliveries.push(PurchaseDelivery {
        id: id.clone(),
        issue,
        quantity: request.quantity,
        distributed_at: now.clone(),
        reversal_of: None,
    });
    let mut edited = original.clone();
    edited.delivery_records = Some(deliveries);
    edited.updated_at = now.clone();
    edited
        .validate()
        .map_err(|e| PortError::new(e.to_string()))?;
    repo.save_operation(&OperationBatch {
        expected_person: Some(person),
        expected_purchase: Some(original.clone()),
        purchases: vec![edited],
        changes: vec![ChangeLog {
            id: runtime.ids.next_id(),
            occurred_at: now,
            operator_name: operator,
            action_type: "purchase_delivery_recorded".into(),
            entity_type: "purchase_delivery".into(),
            entity_id: id.clone(),
            summary: format!("1달 구독 {}권 배부", request.quantity),
            before_json: None,
            after_json: None,
        }],
        ..Default::default()
    })?;
    Ok(id)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoPurchaseDeliveryRequest {
    pub person_id: String,
    pub purchase_id: String,
    pub issue_year: i32,
    pub issue_month: u8,
}
pub fn undo_purchase_delivery<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: UndoPurchaseDeliveryRequest,
) -> Result<crate::DeliveryHistoryChange, ApplicationError> {
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    let purchases = repo.list_person_purchases(&request.person_id)?;
    let purchase = purchases
        .iter()
        .find(|p| p.id == request.purchase_id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let records = purchase.deliveries();
    let delivery = records
        .iter()
        .rev()
        .find(|d| {
            d.issue == issue
                && d.reversal_of.is_none()
                && !records
                    .iter()
                    .any(|r| r.reversal_of.as_deref() == Some(&d.id))
        })
        .ok_or(ApplicationError::MissingDeskRecord)?;
    crate::change_delivery_history(
        repo,
        runtime,
        crate::DeliveryHistoryRequest {
            person_id: request.person_id,
            purchase_id: Some(request.purchase_id),
            record_id: delivery.id.clone(),
            kind: crate::DeliveryHistoryKind::PurchaseDelivery,
            restore: false,
        },
    )
}
