use qt_application::*;
use qt_domain::{Distribution, Issue, Person, PersonStatus};
use qt_infrastructure::{SqliteCoreRepository, SqliteStateTransfer, XlsxStateWorkbook};
use std::cell::Cell;
use tempfile::tempdir;
struct Runtime(Cell<u32>);
impl Clock for Runtime {
    fn now(&self) -> String {
        let n = self.0.get() + 1;
        self.0.set(n);
        format!("2026-10-19T12:00:{:02}+09:00", n % 60)
    }
    fn today(&self) -> String {
        "2026-10-19".into()
    }
}
impl IdGenerator for Runtime {
    fn next_id(&self) -> String {
        let n = self.0.get() + 1;
        self.0.set(n);
        format!("generated-{n}")
    }
}
fn request() -> AnnualIntakeRequest {
    AnnualIntakeRequest {
        request_id: None,
        person_id: None,
        name: "가상모임".into(),
        cohort: None,
        cohort_not_applicable: true,
        phone: None,
        issue_year: 2026,
        issue_month: 11,
        desk_year: 2026,
        desk_month: 11,
        quantity: 2,
        memo: None,
        applied_at: None,
        confirm_overlap: false,
        distribute: true,
        confirmed_memo_revisions: vec![],
    }
}
fn setup(path: &std::path::Path) -> SqliteCoreRepository {
    let mut repo = SqliteCoreRepository::open(path).unwrap();
    repo.migrate_core().unwrap();
    save_operator(&mut repo, &Runtime(Cell::new(0)), "가상담당").unwrap();
    repo
}
#[test]
fn annual_registration_delivery_and_exemption_survive_reopen_and_xlsx_roundtrip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.sqlite");
    let mut repo = setup(&path);
    let rt = Runtime(Cell::new(0));
    let outcome = annual_intake(
        &mut repo,
        &RuntimeServices {
            clock: &rt,
            ids: &rt,
        },
        request(),
    )
    .unwrap();
    let desk =
        load_distribution_desk(&mut repo, &rt, Issue::new(2026, 11).unwrap(), "", true).unwrap();
    assert_eq!(
        (
            desk.totals.target_quantity,
            desk.totals.distributed_quantity
        ),
        (2, 2)
    );
    assert!(
        !repo
            .find_person(&outcome.person_id)
            .unwrap()
            .unwrap()
            .needs_profile_completion()
    );
    drop(repo);
    let mut repo = setup(&path);
    let mut transfer = SqliteStateTransfer::new(&mut repo);
    let state = transfer.load_state().unwrap();
    let file = dir.path().join("backup.xlsx");
    XlsxStateWorkbook
        .write_state(&file, &state, "0.2.0", "2026-10-19")
        .unwrap();
    let (metadata, restored) = XlsxStateWorkbook.read_state(&file).unwrap();
    assert_eq!(metadata.format_version, 4);
    assert_eq!(state, restored);
}
#[test]
fn future_start_cannot_distribute_current_issue_or_partially_register() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let mut input = request();
    input.issue_year = 2027;
    input.issue_month = 1;
    assert!(annual_intake(&mut repo, &runtime, input.clone()).is_err());
    assert!(repo.list_people("", true).unwrap().is_empty());
    input.distribute = false;
    let result = annual_intake(&mut repo, &runtime, input).unwrap();
    let person = repo.load_person(&result.person_id).unwrap().unwrap();
    assert!(person.distributions.is_empty());
    assert_eq!(
        person.subscriptions[0].last_issue().unwrap(),
        Issue::new(2027, 11).unwrap()
    );
}
#[test]
fn memo_confirmation_and_overlap_are_enforced_before_atomic_registration() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let first = annual_intake(&mut repo, &runtime, request()).unwrap();
    let memo = create_memo(
        &mut repo,
        &runtime,
        CreateMemoRequest {
            person_id: Some(first.person_id.clone()),
            content: "가상 확인 메모".into(),
        },
    )
    .unwrap();
    let mut input = request();
    input.person_id = Some(first.person_id.clone());
    assert!(annual_intake(&mut repo, &runtime, input.clone()).is_err());
    input.confirm_overlap = true;
    assert!(annual_intake(&mut repo, &runtime, input.clone()).is_err());
    assert_eq!(
        repo.load_person(&first.person_id)
            .unwrap()
            .unwrap()
            .subscriptions
            .len(),
        1
    );
    input.confirmed_memo_revisions = vec![
        repo.list_person_memos(&first.person_id)
            .unwrap()
            .iter()
            .find(|m| m.id == memo)
            .map(|m| format!("{}:{}", m.id, m.updated_at))
            .unwrap(),
    ];
    annual_intake(&mut repo, &runtime, input).unwrap();
    assert_eq!(
        repo.load_person(&first.person_id)
            .unwrap()
            .unwrap()
            .subscriptions
            .len(),
        2
    );
}
#[test]
fn annual_correction_requires_conflict_ack_and_preserves_actual_delivery_and_revision() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let first = annual_intake(&mut repo, &runtime, request()).unwrap();
    let record = repo.load_person(&first.person_id).unwrap().unwrap();
    let mut input = CorrectSubscriptionRequest {
        person_id: first.person_id.clone(),
        subscription_id: first.subscription_id.clone(),
        expected_revision: serde_json::to_string(&record.subscriptions[0]).unwrap(),
        issue_year: 2027,
        issue_month: 1,
        quantity: 1,
        applied_at: None,
        memo: Some("가상 정정".into()),
        confirm_conflicts: false,
    };
    assert_eq!(
        preview_subscription_correction(&repo, &input)
            .unwrap()
            .len(),
        1
    );
    assert!(correct_subscription(&mut repo, &runtime, input.clone()).is_err());
    input.confirm_conflicts = true;
    correct_subscription(&mut repo, &runtime, input.clone()).unwrap();
    let after = repo.load_person(&first.person_id).unwrap().unwrap();
    assert_eq!(after.distributions, record.distributions);
    assert_eq!(after.subscriptions[0].quantity, 1);
    assert!(correct_subscription(&mut repo, &runtime, input).is_err());
}
#[test]
fn purchase_correction_keeps_original_and_payment_without_double_counting_and_roundtrips() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let person = annual_intake(&mut repo, &runtime, request())
        .unwrap()
        .person_id;
    record_purchase(
        &mut repo,
        &runtime,
        RecordPurchaseRequest {
            person_id: Some(person.clone()),
            buyer_name: None,
            issue_year: 2026,
            issue_month: 11,
            quantity: 1,
            note: None,
        },
    )
    .unwrap();
    let original = repo.list_person_purchases(&person).unwrap()[0].clone();
    let input = CorrectPurchaseRequest {
        person_id: person.clone(),
        purchase_id: original.id.clone(),
        expected_revision: serde_json::to_string(&original).unwrap(),
        issue_year: 2026,
        issue_month: 11,
        quantity: 3,
        purchased_at: original.purchased_at.clone(),
        note: Some("정정".into()),
    };
    correct_purchase(&mut repo, &runtime, input.clone()).unwrap();
    assert!(correct_purchase(&mut repo, &runtime, input).is_err());
    let purchases = repo.list_person_purchases(&person).unwrap();
    assert_eq!(purchases.len(), 3);
    assert!(purchases.contains(&original));
    let edited = purchases
        .iter()
        .find(|p| p.correction_of.is_some())
        .unwrap();
    assert_eq!(edited.payment_status, original.payment_status);
    let payments = load_payments(&repo).unwrap();
    assert!(
        payments
            .iter()
            .any(|p| p.id == edited.id && p.quantity == 3)
    );
    assert!(!payments.iter().any(|p| p.id == original.id));
    let state = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    let file = dir.path().join("corrected.xlsx");
    XlsxStateWorkbook
        .write_state(&file, &state, "0.2.0", "2026-10-19")
        .unwrap();
    assert_eq!(state, XlsxStateWorkbook.read_state(&file).unwrap().1);
}
#[test]
fn failed_batch_rolls_back_person_and_never_leaves_half_an_intake() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let person = Person {
        id: "rollback".into(),
        name: "가상".into(),
        cohort: None,
        cohort_not_applicable: true,
        phone: None,
        normalized_phone: None,
        status: PersonStatus::Active,
        is_group: false,
        person_note: None,
        created_at: "2026-10-19".into(),
        updated_at: "2026-10-19".into(),
    };
    let batch = OperationBatch {
        people: vec![person],
        distributions: vec![Distribution {
            id: "invalid".into(),
            subscription_id: "missing-subscription".into(),
            issue: Issue::new(2026, 11).unwrap(),
            quantity: 1,
            distributed_at: "2026-10-19".into(),
            note: None,
            reversal_of: None,
            created_at: "2026-10-19".into(),
            updated_at: "2026-10-19".into(),
        }],
        ..Default::default()
    };
    assert!(repo.save_operation(&batch).is_err());
    assert!(repo.find_person("rollback").unwrap().is_none());
}

#[test]
fn deleting_the_last_memo_never_resurrects_legacy_records_in_backups() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let person = annual_intake(&mut repo, &runtime, request())
        .unwrap()
        .person_id;
    create_check_item(
        &mut repo,
        &runtime,
        CreateCheckItemRequest {
            person_id: Some(person.clone()),
            content: "이전 형식의 원본".into(),
        },
    )
    .unwrap();
    let memo = create_memo(
        &mut repo,
        &runtime,
        CreateMemoRequest {
            person_id: Some(person),
            content: "변환된 메모".into(),
        },
    )
    .unwrap();
    delete_memo(&mut repo, &runtime, &memo).unwrap();
    assert_eq!(repo.list_check_items().unwrap().len(), 1);
    let state = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    assert!(state.check_items.is_empty());
    assert!(state.pinned_notes.is_empty());
    assert!(state.people.iter().all(|p| p.person_note.is_none()));
}

#[test]
fn repeating_the_same_annual_submission_cannot_create_another_person_or_distribution() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let mut input = request();
    input.request_id = Some("single-gesture".into());
    let first = annual_intake(&mut repo, &runtime, input.clone()).unwrap();
    assert!(annual_intake(&mut repo, &runtime, input).is_err());
    assert_eq!(repo.list_people("", true).unwrap().len(), 1);
    let record = repo.load_person(&first.person_id).unwrap().unwrap();
    assert_eq!(record.subscriptions.len(), 1);
    assert_eq!(record.distributions.len(), 1);
}

#[test]
fn archived_legacy_memo_keeps_identity_status_authorship_and_provenance_through_transfer() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("state.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    let person = annual_intake(&mut repo, &runtime, request())
        .unwrap()
        .person_id;
    let id = create_memo(
        &mut repo,
        &runtime,
        CreateMemoRequest {
            person_id: Some(person),
            content: "원문\n둘째 줄".into(),
        },
    )
    .unwrap();
    let mut memo = repo
        .list_memos()
        .unwrap()
        .into_iter()
        .find(|m| m.id == id)
        .unwrap();
    memo.status = qt_domain::MemoStatus::Archived;
    memo.archived_at = Some(rt.now());
    memo.legacy_source = Some("person_note".into());
    memo.legacy_title = Some("보존할 원본 제목".into());
    let change = qt_domain::ChangeLog {
        id: rt.next_id(),
        occurred_at: rt.now(),
        operator_name: "가상담당".into(),
        action_type: "memo_archived".into(),
        entity_type: "memo".into(),
        entity_id: id,
        summary: "익명 검증".into(),
        before_json: None,
        after_json: None,
    };
    repo.save_memo(&memo, &change).unwrap();
    let state = SqliteStateTransfer::new(&mut repo).load_state().unwrap();
    assert_eq!(state.memos.as_ref().unwrap(), &vec![memo.clone()]);
    let file = dir.path().join("memo.xlsx");
    XlsxStateWorkbook
        .write_state(&file, &state, "0.2.0", "2026-10-19")
        .unwrap();
    let (_, imported) = XlsxStateWorkbook.read_state(&file).unwrap();
    assert_eq!(imported.memos.as_ref().unwrap(), &vec![memo.clone()]);
    let mut target = setup(&dir.path().join("target.sqlite"));
    SqliteStateTransfer::new(&mut target)
        .apply_state(
            &imported,
            ImportMode::Replace,
            &[],
            &RestorePointView {
                id: "restore".into(),
                source_file_name: "anonymous.xlsx".into(),
                created_at: "2026-10-19".into(),
                snapshot_path: "local-scratch".into(),
            },
        )
        .unwrap();
    assert!(target.list_memos().unwrap().is_empty());
    assert_eq!(target.list_archived_memos().unwrap(), vec![memo]);
}

#[test]
fn exact_name_search_precedes_partial_matches_in_desk_and_management() {
    let dir = tempdir().unwrap();
    let mut repo = setup(&dir.path().join("search.sqlite"));
    let rt = Runtime(Cell::new(0));
    let runtime = RuntimeServices {
        clock: &rt,
        ids: &rt,
    };
    for name in ["가가상원", "가상원"] {
        let mut input = request();
        input.name = name.into();
        input.distribute = false;
        annual_intake(&mut repo, &runtime, input).unwrap();
    }
    let desk = load_distribution_desk(
        &mut repo,
        &rt,
        Issue::new(2026, 11).unwrap(),
        "가상원",
        true,
    )
    .unwrap();
    assert_eq!(desk.people[0].name, "가상원");
    assert_eq!(
        repo.list_people("가상원", false).unwrap()[0].person.name,
        "가상원"
    );
}
