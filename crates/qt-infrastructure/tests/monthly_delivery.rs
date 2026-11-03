use qt_application::*;
use qt_domain::{
    ChangeLog, Distribution, Issue, Person, PersonStatus, Subscription, SubscriptionSource,
};
use qt_infrastructure::{SqliteCoreRepository, SqliteStateTransfer, XlsxStateWorkbook};
use std::cell::Cell;
use tempfile::tempdir;
struct Runtime(Cell<u32>);
impl Clock for Runtime {
    fn now(&self) -> String {
        "2026-11-03T12:00:00+09:00".into()
    }
    fn today(&self) -> String {
        "2026-11-03".into()
    }
}
impl IdGenerator for Runtime {
    fn next_id(&self) -> String {
        let n = self.0.get() + 1;
        self.0.set(n);
        format!("generated-{n}")
    }
}
fn seed(repo: &mut SqliteCoreRepository, id: &str, group: bool) {
    let now = "2026-11-03T12:00:00+09:00".to_owned();
    let person = Person {
        id: id.into(),
        name: format!("가상{id}"),
        cohort: None,
        cohort_not_applicable: true,
        phone: None,
        normalized_phone: None,
        is_group: group,
        status: PersonStatus::Active,
        person_note: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let sub = Subscription {
        id: format!("sub-{id}"),
        person_id: id.into(),
        start_issue: Issue::new(2026, 11).unwrap(),
        issue_count: 6,
        quantity: 5,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: None,
        memo: None,
        payment_status: None,
        archived_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let change = ChangeLog {
        id: format!("seed-{id}"),
        occurred_at: now.clone(),
        operator_name: "가상담당".into(),
        action_type: "seed".into(),
        entity_type: "person".into(),
        entity_id: id.into(),
        summary: "익명 검증".into(),
        before_json: None,
        after_json: None,
    };
    repo.register_subscription(&person, &sub, &change).unwrap();
    let d = Distribution {
        id: format!("legacy-{id}"),
        subscription_id: sub.id,
        issue: Issue::new(2026, 11).unwrap(),
        quantity: 5,
        distributed_at: now.clone(),
        note: None,
        reversal_of: None,
        created_at: now.clone(),
        updated_at: now,
    };
    repo.record_distribution(
        &d,
        &ChangeLog {
            id: format!("seed-d-{id}"),
            ..change
        },
    )
    .unwrap();
}
#[test]
fn monthly_delivery_cancel_redelivery_correction_and_xlsx_preserve_payment_and_profile() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.sqlite");
    let mut repo = SqliteCoreRepository::open(&path).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "regular", false);
    let person = repo.load_person("regular").unwrap().unwrap().person;
    let issue = Issue::new(2026, 11).unwrap();
    record_purchase(
        &mut repo,
        &runtime,
        RecordPurchaseRequest {
            person_id: Some("regular".into()),
            buyer_name: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 2,
            note: None,
        },
    )
    .unwrap();
    let selected = repo.list_person_purchases("regular").unwrap().remove(0);
    set_payment_confirmed(
        &mut repo,
        &runtime,
        vec![PaymentSelection {
            id: selected.id,
            kind: PaymentKind::Purchase,
        }],
        true,
    )
    .unwrap();
    let p = repo.list_person_purchases("regular").unwrap().remove(0);
    let initial = p.deliveries()[0].clone();
    let delete = change_delivery_history(
        &mut repo,
        &runtime,
        DeliveryHistoryRequest {
            person_id: "regular".into(),
            record_id: initial.id.clone(),
            purchase_id: Some(p.id.clone()),
            kind: DeliveryHistoryKind::PurchaseDelivery,
            restore: false,
        },
    )
    .unwrap();
    let after = repo.list_person_purchases("regular").unwrap().remove(0);
    let desk = load_distribution_desk(&mut repo, &rt, issue, "", true).unwrap();
    let row = desk
        .people
        .iter()
        .find(|v| v.person_id == "regular")
        .unwrap();
    assert_eq!(row.remaining_quantity, 2);
    assert_eq!(row.target_quantity, 7);
    assert_eq!(desk.totals.distributed_quantity, 5);
    assert_eq!(after.payment_status, p.payment_status);
    assert_eq!(after.quantity, 2);
    assert_eq!(after.delivered_quantity(issue), 0);
    assert_eq!(repo.load_person("regular").unwrap().unwrap().person, person);
    assert!(
        change_delivery_history(
            &mut repo,
            &runtime,
            DeliveryHistoryRequest {
                person_id: "regular".into(),
                record_id: initial.id,
                purchase_id: Some(p.id.clone()),
                kind: DeliveryHistoryKind::PurchaseDelivery,
                restore: false
            }
        )
        .is_err()
    );
    let restored = change_delivery_history(
        &mut repo,
        &runtime,
        DeliveryHistoryRequest {
            person_id: "regular".into(),
            record_id: delete.record_id,
            purchase_id: Some(p.id.clone()),
            kind: DeliveryHistoryKind::PurchaseDelivery,
            restore: true,
        },
    )
    .unwrap();
    change_delivery_history(
        &mut repo,
        &runtime,
        DeliveryHistoryRequest {
            person_id: "regular".into(),
            record_id: restored.record_id,
            purchase_id: Some(p.id.clone()),
            kind: DeliveryHistoryKind::PurchaseDelivery,
            restore: false,
        },
    )
    .unwrap();
    record_purchase_delivery(
        &mut repo,
        &runtime,
        PurchaseDeliveryRequest {
            person_id: "regular".into(),
            purchase_id: p.id.clone(),
            issue_year: 2026,
            issue_month: 11,
            quantity: 2,
        },
    )
    .unwrap();
    assert!(
        record_purchase_delivery(
            &mut repo,
            &runtime,
            PurchaseDeliveryRequest {
                person_id: "regular".into(),
                purchase_id: p.id.clone(),
                issue_year: 2026,
                issue_month: 11,
                quantity: 1
            }
        )
        .is_err()
    );
    let after = repo.list_person_purchases("regular").unwrap().remove(0);
    let actual = after.deliveries();
    let mut correction = CorrectPurchaseRequest {
        person_id: "regular".into(),
        purchase_id: p.id,
        expected_revision: serde_json::to_string(&after).unwrap(),
        issue_year: 2027,
        issue_month: 1,
        quantity: 1,
        purchased_at: after.purchased_at.clone(),
        note: None,
        confirm_conflicts: false,
    };
    assert!(
        !preview_purchase_correction(&repo, &correction)
            .unwrap()
            .is_empty()
    );
    assert!(correct_purchase(&mut repo, &runtime, correction.clone()).is_err());
    correction.confirm_conflicts = true;
    correct_purchase(&mut repo, &runtime, correction).unwrap();
    let current = repo
        .list_person_purchases("regular")
        .unwrap()
        .into_iter()
        .find(|v| v.correction_of.is_some())
        .unwrap();
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, issue, "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        7
    );
    assert_eq!(current.deliveries(), actual);
    assert_eq!(current.payment_status, after.payment_status);
    let backup = dir.path().join("backup.xlsx");
    let snapshot = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    XlsxStateWorkbook
        .write_state(&backup, &snapshot, "0.4.0", &rt.now())
        .unwrap();
    let (_, round) = XlsxStateWorkbook.read_state(&backup).unwrap();
    assert_eq!(round.purchases, snapshot.purchases);
    let mut fresh = SqliteCoreRepository::open(&dir.path().join("restored.sqlite")).unwrap();
    fresh.migrate_core().unwrap();
    SqliteStateTransfer::new(&mut fresh)
        .apply_state(
            &round,
            ImportMode::Replace,
            &[],
            &RestorePointView {
                id: "restore-point".into(),
                source_file_name: "backup.xlsx".into(),
                created_at: rt.now(),
                snapshot_path: backup.to_string_lossy().into_owned(),
            },
        )
        .unwrap();
    assert_eq!(
        fresh.list_person_purchases("regular").unwrap(),
        repo.list_person_purchases("regular").unwrap()
    );
    assert_eq!(
        fresh.load_person("regular").unwrap().unwrap().person,
        person
    );

    drop(repo);
    let mut repo = SqliteCoreRepository::open(&path).unwrap();
    repo.migrate_core().unwrap();
    assert_eq!(repo.load_person("regular").unwrap().unwrap().person, person);
    assert_eq!(
        repo.list_person_purchases("regular")
            .unwrap()
            .into_iter()
            .find(|v| v.id == current.id)
            .unwrap()
            .deliveries(),
        actual
    );
}

#[test]
fn cancelling_a_regular_annual_row_restores_only_that_row_and_never_changes_exemption() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "regular", false);
    let before = repo.load_person("regular").unwrap().unwrap().person;
    let mut request = DeliveryHistoryRequest {
        person_id: "regular".into(),
        record_id: "legacy-regular".into(),
        purchase_id: None,
        kind: DeliveryHistoryKind::Distribution,
        restore: false,
    };
    let cancelled = change_delivery_history(&mut repo, &runtime, request.clone()).unwrap();
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 11).unwrap(), "", true)
            .unwrap()
            .people[0]
            .remaining_quantity,
        5
    );
    request.record_id = cancelled.record_id;
    request.restore = true;
    let restored = change_delivery_history(&mut repo, &runtime, request.clone()).unwrap();
    assert!(change_delivery_history(&mut repo, &runtime, request.clone()).is_err());
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 11).unwrap(), "", true)
            .unwrap()
            .people[0]
            .distributed_quantity,
        5
    );
    request.record_id = restored.record_id;
    request.restore = false;
    change_delivery_history(&mut repo, &runtime, request).unwrap();
    assert_eq!(repo.load_person("regular").unwrap().unwrap().person, before);
}

#[test]
fn payment_update_from_an_older_snapshot_does_not_restore_a_cancelled_delivery() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "regular", false);
    record_purchase(
        &mut repo,
        &runtime,
        RecordPurchaseRequest {
            person_id: Some("regular".into()),
            buyer_name: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 1,
            note: None,
        },
    )
    .unwrap();
    let mut stale = repo
        .payment_intakes()
        .unwrap()
        .into_iter()
        .find(|v| matches!(v, PaymentIntake::Purchase(_, _)))
        .unwrap();
    let PaymentIntake::Purchase(_, ref mut p) = stale else {
        unreachable!()
    };
    let purchase_id = p.id.clone();
    let d = p.deliveries()[0].id.clone();
    p.payment_status = Some(qt_domain::PaymentStatus::Confirmed);
    change_delivery_history(
        &mut repo,
        &runtime,
        DeliveryHistoryRequest {
            person_id: "regular".into(),
            record_id: d,
            purchase_id: Some(purchase_id.clone()),
            kind: DeliveryHistoryKind::PurchaseDelivery,
            restore: false,
        },
    )
    .unwrap();
    repo.save_payment_changes(&[(
        stale,
        ChangeLog {
            id: "confirm".into(),
            occurred_at: rt.now(),
            operator_name: "가상담당".into(),
            action_type: "payment_confirmed".into(),
            entity_type: "one_time_purchase".into(),
            entity_id: purchase_id.clone(),
            summary: "입금 확인".into(),
            before_json: Some("payment_status=pending".into()),
            after_json: Some("payment_status=confirmed".into()),
        },
    )])
    .unwrap();
    let current = repo
        .list_person_purchases("regular")
        .unwrap()
        .into_iter()
        .find(|p| p.id == purchase_id)
        .unwrap();
    assert_eq!(
        current.payment_status,
        Some(qt_domain::PaymentStatus::Confirmed)
    );
    assert_eq!(current.delivered_quantity(Issue::new(2026, 11).unwrap()), 0);
}

#[test]
fn correcting_the_purchase_issue_keeps_actual_quantity_in_the_original_issue_totals() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    let person_id = record_purchase_for_new_person(
        &mut repo,
        &runtime,
        RecordPurchasePersonRequest {
            name: "가상모임".into(),
            cohort: None,
            cohort_not_applicable: true,
            phone: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 2,
            note: None,
        },
    )
    .unwrap();
    let p = repo.list_person_purchases(&person_id).unwrap().remove(0);
    correct_purchase(
        &mut repo,
        &runtime,
        CorrectPurchaseRequest {
            person_id: person_id.clone(),
            purchase_id: p.id.clone(),
            expected_revision: serde_json::to_string(&p).unwrap(),
            issue_year: 2027,
            issue_month: 1,
            quantity: 1,
            purchased_at: p.purchased_at.clone(),
            note: p.note.clone(),
            confirm_conflicts: true,
        },
    )
    .unwrap();
    let original =
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 11).unwrap(), "", true).unwrap();
    assert_eq!(original.totals.target_quantity, 0);
    assert_eq!(original.totals.distributed_quantity, 2);
    let future =
        load_distribution_desk(&mut repo, &rt, Issue::new(2027, 1).unwrap(), "", true).unwrap();
    assert_eq!(future.people[0].remaining_quantity, 1);
    assert_eq!(future.totals.distributed_quantity, 0);
}
