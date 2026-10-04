use qt_application::{
    Clock, CoreRepository, CreateDraftRequest, DistributionDeskRepository, IdGenerator,
    PaymentKind, PaymentSelection, RecordPurchasePersonRequest, RecordPurchaseRequest,
    RuntimeServices, StateTransferRepository, StateWorkbookV1, cancel_group_distribution,
    cancel_latest_purchase, create_draft, load_distribution_desk, load_payments,
    record_group_distribution, record_purchase, record_purchase_for_new_person, save_operator,
    set_payment_confirmed,
};
use qt_domain::{
    ChangeLog, Issue, PaymentStatus, Person, PersonStatus, Subscription, SubscriptionSource,
};
use qt_infrastructure::{SqliteCoreRepository, SqliteStateTransfer, XlsxStateWorkbook};
use std::cell::Cell;
use tempfile::tempdir;

struct Runtime(Cell<u32>);
impl Clock for Runtime {
    fn now(&self) -> String {
        "2026-10-04T12:00:00+09:00".into()
    }
    fn today(&self) -> String {
        "2026-10-04".into()
    }
}
impl IdGenerator for Runtime {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("new-{next:06}")
    }
}

#[test]
fn new_intakes_are_pending_and_confirmation_is_independent_of_distribution_and_cancellation() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("payment.sqlite")).unwrap();
    repo.migrate().unwrap();
    let runtime = Runtime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };
    save_operator(&mut repo, &runtime, "가상담당자").unwrap();
    create_draft(
        &mut repo,
        &services,
        CreateDraftRequest {
            name: "가상연간".into(),
            cohort: None,
            phone: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 2,
        },
    )
    .unwrap();
    let buyer = record_purchase_for_new_person(
        &mut repo,
        &services,
        RecordPurchasePersonRequest {
            name: "가상구매".into(),
            cohort: None,
            phone: Some("01000000000".into()),
            issue_year: 2026,
            issue_month: 11,
            quantity: 1,
            note: None,
        },
    )
    .unwrap();
    let rows = load_payments(&repo).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.status == PaymentStatus::Pending));
    let purchase = rows
        .iter()
        .find(|row| row.kind == PaymentKind::Purchase)
        .unwrap();
    assert_eq!(purchase.person_id.as_deref(), Some(buyer.as_str()));
    let selections = rows
        .iter()
        .map(|row| PaymentSelection {
            id: row.id.clone(),
            kind: row.kind,
        })
        .collect();
    set_payment_confirmed(&mut repo, &services, selections, true).unwrap();
    assert!(
        load_payments(&repo)
            .unwrap()
            .iter()
            .all(|row| row.status == PaymentStatus::Confirmed)
    );
    let desk = load_distribution_desk(
        &mut repo,
        &runtime,
        Issue::new(2026, 11).unwrap(),
        "가상연간",
        true,
    )
    .unwrap();
    assert_eq!(desk.people[0].remaining_quantity, 2);
    set_payment_confirmed(
        &mut repo,
        &services,
        vec![PaymentSelection {
            id: purchase.id.clone(),
            kind: PaymentKind::Purchase,
        }],
        false,
    )
    .unwrap();
    cancel_latest_purchase(&mut repo, &services, Issue::new(2026, 11).unwrap()).unwrap();
    assert_eq!(load_payments(&repo).unwrap().len(), 1);
    assert!(
        repo.list_changes()
            .unwrap()
            .iter()
            .any(|change| change.action_type == "payment_confirmation_reverted")
    );
    let snapshot = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    let path = dir.path().join("payment-confirmed.xlsx");
    XlsxStateWorkbook
        .write_state(&path, &snapshot, "0.1.0", &runtime.now())
        .unwrap();
    let (_, restored) = XlsxStateWorkbook.read_state(&path).unwrap();
    assert_eq!(restored.subscriptions, snapshot.subscriptions);
    assert_eq!(restored.purchases, snapshot.purchases);
    // Anonymous purchases still have a queue entry rather than silently losing payment work.
    record_purchase(
        &mut repo,
        &services,
        RecordPurchaseRequest {
            person_id: None,
            buyer_name: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 1,
            note: None,
        },
    )
    .unwrap();
    assert!(
        load_payments(&repo)
            .unwrap()
            .iter()
            .any(|row| row.name == "익명 구매")
    );
    let before = load_payments(&repo).unwrap();
    let invalid = vec![
        PaymentSelection {
            id: before[0].id.clone(),
            kind: before[0].kind,
        },
        PaymentSelection {
            id: "missing".into(),
            kind: PaymentKind::Purchase,
        },
    ];
    assert!(set_payment_confirmed(&mut repo, &services, invalid, false).is_err());
    assert_eq!(load_payments(&repo).unwrap()[0].status, before[0].status);
}

#[test]
fn groups_record_variable_quantities_without_subscription_targets_or_payments_and_round_trip() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("group.sqlite")).unwrap();
    repo.migrate().unwrap();
    let runtime = Runtime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };
    save_operator(&mut repo, &runtime, "가상담당자").unwrap();
    let now = runtime.now();
    let group = Person {
        id: "group".into(),
        name: "군지체".into(),
        is_group: true,
        cohort: None,
        phone: None,
        normalized_phone: None,
        status: PersonStatus::Active,
        person_note: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let old_subscription = Subscription {
        id: "old".into(),
        person_id: group.id.clone(),
        start_issue: Issue::new(2025, 1).unwrap(),
        issue_count: 6,
        quantity: 99,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: None,
        memo: None,
        payment_status: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
    };
    let log = ChangeLog {
        id: "seed".into(),
        entity_id: group.id.clone(),
        entity_type: "person".into(),
        action_type: "seed".into(),
        summary: "익명 그룹 fixture".into(),
        operator_name: "가상담당자".into(),
        occurred_at: now.clone(),
        before_json: None,
        after_json: None,
    };
    repo.register_subscription(&group, &old_subscription, &log)
        .unwrap();
    assert!(!group.needs_profile_completion());
    let issue = Issue::new(2026, 11).unwrap();
    assert!(record_group_distribution(&mut repo, &services, "group", issue, 0).is_err());
    let first = record_group_distribution(&mut repo, &services, "group", issue, 7).unwrap();
    let second = record_group_distribution(&mut repo, &services, "group", issue, 13).unwrap();
    let desk = load_distribution_desk(&mut repo, &runtime, issue, "", false).unwrap();
    assert_eq!(desk.people[0].distributed_quantity, 20);
    assert!(desk.people[0].can_distribute);
    assert_eq!(desk.totals.target_people, 0);
    assert_eq!(desk.totals.remaining_people, 0);
    assert_eq!(desk.totals.target_quantity, 0);
    assert_eq!(desk.totals.distributed_quantity, 20);
    assert_eq!(desk.purchased_quantity, 0);
    assert!(load_payments(&repo).unwrap().is_empty());
    cancel_group_distribution(&mut repo, &services, "group", issue, &second).unwrap();
    assert!(cancel_group_distribution(&mut repo, &services, "group", issue, &second).is_err());
    let desk = load_distribution_desk(&mut repo, &runtime, issue, "", false).unwrap();
    assert_eq!(desk.people[0].distributed_quantity, 7);
    assert_eq!(
        desk.people[0].latest_group_distribution_id.as_deref(),
        Some(first.as_str())
    );
    let mut transfer = SqliteStateTransfer::new(&mut repo);
    let snapshot = transfer.load_state().unwrap();
    let path = dir.path().join("round-trip.xlsx");
    XlsxStateWorkbook
        .write_state(&path, &snapshot, "0.1.0", &now)
        .unwrap();
    let (metadata, restored) = XlsxStateWorkbook.read_state(&path).unwrap();
    assert_eq!(metadata.format_version, 3);
    assert_eq!(restored.people, snapshot.people);
    assert_eq!(restored.purchases, snapshot.purchases);
    assert_eq!(restored.subscriptions, snapshot.subscriptions);
}
