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
fn request(person: &str, id: &str, kind: DeliveryHistoryKind) -> DeliveryHistoryRequest {
    DeliveryHistoryRequest {
        person_id: person.into(),
        record_id: id.into(),
        kind,
        purchase_id: None,
        restore: false,
    }
}
#[test]
fn removes_only_the_selected_group_record_and_preserves_originals_through_xlsx() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.sqlite");
    let mut repo = SqliteCoreRepository::open(&path).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상担当").unwrap();
    seed(&mut repo, "group", true);
    let issue = Issue::new(2026, 11).unwrap();
    let first = record_group_distribution(&mut repo, &runtime, "group", issue, 24).unwrap();
    let second = record_group_distribution(&mut repo, &runtime, "group", issue, 24).unwrap();
    change_delivery_history(
        &mut repo,
        &runtime,
        request("group", &first, DeliveryHistoryKind::Purchase),
    )
    .unwrap();
    let detail = load_person_detail(&mut repo, "group", issue).unwrap();
    assert!(
        detail
            .purchases
            .iter()
            .find(|p| p.id == first)
            .unwrap()
            .cancelled
    );
    assert!(
        !detail
            .purchases
            .iter()
            .find(|p| p.id == second)
            .unwrap()
            .cancelled
    );
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, issue, "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        29
    );
    let original = repo.load_person("group").unwrap().unwrap().distributions[0].clone();
    change_delivery_history(
        &mut repo,
        &runtime,
        request("group", &original.id, DeliveryHistoryKind::Distribution),
    )
    .unwrap();
    let detail = load_person_detail(&mut repo, "group", issue).unwrap();
    assert!(
        detail
            .distributions
            .iter()
            .find(|d| d.id == original.id)
            .unwrap()
            .cancelled
    );
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, issue, "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        24
    );
    let state = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    assert!(state.distributions.contains(&original));
    assert_eq!(
        state
            .distributions
            .iter()
            .filter(|d| d.reversal_of.as_deref() == Some(&original.id))
            .count(),
        1
    );
    assert!(
        state
            .changes
            .iter()
            .any(|c| c.action_type == "distribution_reversed")
    );
    let file = dir.path().join("roundtrip.xlsx");
    XlsxStateWorkbook
        .write_state(&file, &state, "0.4.0", &rt.now())
        .unwrap();
    assert_eq!(state, XlsxStateWorkbook.read_state(&file).unwrap().1);
    drop(repo);
    let mut repo = SqliteCoreRepository::open(&path).unwrap();
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, issue, "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        24
    );
}
#[test]
fn rejects_other_owners_wrong_types_cancelled_records_and_repeat_deletion_without_changes() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "group", true);
    seed(&mut repo, "other", true);
    seed(&mut repo, "regular", false);
    let issue = Issue::new(2026, 11).unwrap();
    let id = record_group_distribution(&mut repo, &runtime, "group", issue, 24).unwrap();
    for request in [
        request("other", &id, DeliveryHistoryKind::Purchase),
        request("regular", &id, DeliveryHistoryKind::Purchase),
        request("group", "legacy-other", DeliveryHistoryKind::Distribution),
        request("group", &id, DeliveryHistoryKind::Distribution),
    ] {
        let before = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
        assert!(change_delivery_history(&mut repo, &runtime, request).is_err());
        assert_eq!(
            before,
            SqliteStateTransfer::new(&mut repo).load_state().unwrap()
        );
    }
    for (id, kind) in [
        (id, DeliveryHistoryKind::Purchase),
        ("legacy-group".into(), DeliveryHistoryKind::Distribution),
    ] {
        change_delivery_history(&mut repo, &runtime, request("group", &id, kind)).unwrap();
        let before = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
        assert!(change_delivery_history(&mut repo, &runtime, request("group", &id, kind)).is_err());
        assert_eq!(
            before,
            SqliteStateTransfer::new(&mut repo).load_state().unwrap()
        );
    }
}

#[test]
fn saving_an_old_distribution_snapshot_cannot_add_a_second_reversal() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "group", true);
    let original = repo.load_person("group").unwrap().unwrap().distributions[0].clone();
    let stale_batch = OperationBatch {
        expected_distribution: Some(original.clone()),
        distributions: vec![Distribution {
            id: "stale-reversal".into(),
            reversal_of: Some(original.id.clone()),
            ..original.clone()
        }],
        ..Default::default()
    };
    change_delivery_history(
        &mut repo,
        &runtime,
        request("group", &original.id, DeliveryHistoryKind::Distribution),
    )
    .unwrap();
    let before = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    assert!(repo.save_operation(&stale_batch).is_err());
    assert_eq!(
        before,
        SqliteStateTransfer::new(&mut repo).load_state().unwrap()
    );
}

#[test]
fn deletes_a_past_issue_without_touching_the_current_issue_or_accepting_archived_groups() {
    let dir = tempdir().unwrap();
    let mut repo = SqliteCoreRepository::open(&dir.path().join("state.sqlite")).unwrap();
    repo.migrate_core().unwrap();
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    save_operator(&mut repo, &rt, "가상담당").unwrap();
    seed(&mut repo, "group", true);
    let original = repo.load_person("group").unwrap().unwrap().distributions[0].clone();
    let old = Distribution {
        id: "past-group".into(),
        issue: Issue::new(2026, 9).unwrap(),
        ..original
    };
    repo.save_operation(&OperationBatch {
        distributions: vec![old],
        ..Default::default()
    })
    .unwrap();
    let result = change_delivery_history(
        &mut repo,
        &runtime,
        request("group", "past-group", DeliveryHistoryKind::Distribution),
    )
    .unwrap();
    assert_eq!(
        (result.issue_year, result.issue_month, result.quantity),
        (2026, 9, 5)
    );
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 9).unwrap(), "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        0
    );
    assert_eq!(
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 11).unwrap(), "", true)
            .unwrap()
            .totals
            .distributed_quantity,
        5
    );
    set_person_archived(&mut repo, &runtime, "group", true).unwrap();
    assert!(
        change_delivery_history(
            &mut repo,
            &runtime,
            request("group", "legacy-group", DeliveryHistoryKind::Distribution)
        )
        .is_err()
    );
}
