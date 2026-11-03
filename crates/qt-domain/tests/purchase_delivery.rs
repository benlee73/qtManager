use qt_domain::{Issue, OneTimePurchase, PurchaseDelivery};
fn purchase() -> OneTimePurchase {
    serde_json::from_value(serde_json::json!({"id":"purchase", "personId":"person", "buyerName":null,"issue":{"year":2026,"startMonth":11}, "quantity":2,"purchasedAt":"2026-11-01T10:00:00+09:00", "note":null,"reversalOf":null,"createdAt":"2026-11-01","updatedAt":"2026-11-01"})).unwrap()
}
#[test]
fn legacy_purchase_has_one_stable_delivery_and_cancellation_never_changes_purchase() {
    let mut p = purchase();
    let initial = p.deliveries();
    assert_eq!(initial.len(), 1);
    assert_eq!(initial, p.deliveries());
    assert_eq!(p.delivered_quantity(p.issue), 2);
    p.delivery_records = Some(vec![
        initial[0].clone(),
        PurchaseDelivery {
            id: "cancel".into(),
            reversal_of: Some(initial[0].id.clone()),
            ..initial[0].clone()
        },
    ]);
    assert_eq!(p.delivered_quantity(p.issue), 0);
    assert_eq!(p.quantity, 2);
    p.validate().unwrap();
    let restored: OneTimePurchase =
        serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
    assert_eq!(restored.deliveries(), p.deliveries());
}
#[test]
fn corrected_issue_and_quantity_do_not_rewrite_actual_delivery() {
    let mut p = purchase();
    p.delivery_records = Some(p.deliveries());
    let original = p.deliveries();
    p.issue = Issue::new(2027, 1).unwrap();
    p.quantity = 1;
    assert_eq!(p.deliveries(), original);
    assert_eq!(p.delivered_quantity(Issue::new(2026, 11).unwrap()), 2);
    assert_eq!(p.delivered_quantity(p.issue), 0);
}
#[test]
fn malformed_duplicate_or_mismatched_reversals_are_rejected() {
    let mut p = purchase();
    let original = p.deliveries()[0].clone();
    p.delivery_records = Some(vec![original.clone(), original.clone()]);
    assert!(p.validate().is_err());
    p.delivery_records = Some(vec![
        original.clone(),
        PurchaseDelivery {
            id: "reverse".into(),
            quantity: 1,
            reversal_of: Some(original.id.clone()),
            ..original.clone()
        },
    ]);
    assert!(p.validate().is_err());
    p.delivery_records = Some(vec![
        original.clone(),
        PurchaseDelivery {
            id: "reverse".into(),
            reversal_of: Some("missing".into()),
            ..original
        },
    ]);
    assert!(p.validate().is_err());
}
#[test]
fn group_and_financial_reversal_are_not_implicit_monthly_deliveries() {
    let mut p = purchase();
    p.is_group_distribution = true;
    assert!(p.deliveries().is_empty());
    p.is_group_distribution = false;
    p.reversal_of = Some("other".into());
    assert!(p.deliveries().is_empty());
}
