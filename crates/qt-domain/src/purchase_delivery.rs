//! Purchase/payment and actual handover have independent histories.
use crate::{DomainError, Issue, OneTimePurchase};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseDelivery {
    pub id: String,
    pub issue: Issue,
    pub quantity: u32,
    pub distributed_at: String,
    pub reversal_of: Option<String>,
}
impl OneTimePurchase {
    /// Missing ledger is the pre-v5 immediate-handover contract, not zero deliveries.
    pub fn deliveries(&self) -> Vec<PurchaseDelivery> {
        if self.is_group_distribution || self.reversal_of.is_some() {
            return Vec::new();
        }
        self.delivery_records.clone().unwrap_or_else(|| {
            vec![PurchaseDelivery {
                id: format!("initial-delivery:{}", self.id),
                issue: self.issue,
                quantity: self.quantity,
                distributed_at: self.purchased_at.clone(),
                reversal_of: None,
            }]
        })
    }
    pub fn delivered_quantity(&self, issue: Issue) -> u32 {
        self.deliveries()
            .iter()
            .filter(|d| d.issue == issue)
            .map(|d| {
                if d.reversal_of.is_some() {
                    -(d.quantity as i64)
                } else {
                    d.quantity as i64
                }
            })
            .sum::<i64>()
            .max(0) as u32
    }
}
pub(crate) fn validate_deliveries(records: &[PurchaseDelivery]) -> Result<(), DomainError> {
    let mut ids = std::collections::HashSet::new();
    let mut reversed = std::collections::HashSet::new();
    for d in records {
        crate::records::required_id(&d.id, "purchase_delivery_id")?;
        crate::records::timestamp(&d.distributed_at, "distributed_at")?;
        Issue::new(d.issue.year, d.issue.start_month)?;
        if d.quantity == 0 || !ids.insert(&d.id) {
            return Err(DomainError::InvalidDistributionHistory);
        }
        if let Some(id) = &d.reversal_of
            && (!reversed.insert(id)
                || !records.iter().any(|o| {
                    &o.id == id
                        && o.reversal_of.is_none()
                        && o.quantity == d.quantity
                        && o.issue == d.issue
                }))
        {
            return Err(DomainError::InvalidDistributionHistory);
        }
    }
    Ok(())
}
