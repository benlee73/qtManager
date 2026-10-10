use std::cell::Cell;

use qt_application::{
    Clock, CoreRepository, CreateCheckItemRequest, CreateDraftRequest, CreateMemoRequest,
    CreatePinnedNoteRequest, DistributionDeskRepository, IdGenerator, RecordDistributionRequest,
    RecordPurchaseRequest, RuntimeServices, UndoDistributionRequest, UpdateCheckItemStatusRequest,
    create_check_item, create_draft, create_memo, create_pinned_note, delete_check_item,
    delete_pinned_note, load_distribution_desk, record_distribution, record_purchase,
    save_operator, undo_last_distribution, update_check_item_status,
};
use qt_domain::{CheckItemStatus, Issue};
use qt_infrastructure::SqliteCoreRepository;
use tempfile::tempdir;

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> String {
        "2026-07-24T10:00:00+09:00".into()
    }

    fn today(&self) -> String {
        "2026-07-24".into()
    }
}

#[test]
fn search_prioritizes_linked_memos_without_hiding_or_modifying_other_memos() {
    struct AdvancingClock(Cell<u32>);
    impl Clock for AdvancingClock {
        fn now(&self) -> String {
            let second = self.0.get() + 1;
            self.0.set(second);
            format!("2026-07-24T10:00:{second:02}+09:00")
        }
        fn today(&self) -> String {
            "2026-07-24".into()
        }
    }

    let directory = tempdir().unwrap();
    let mut repository =
        SqliteCoreRepository::open(&directory.path().join("memos.sqlite")).unwrap();
    repository.migrate().unwrap();
    save_operator(&mut repository, &FixedClock, "가상담당자").unwrap();
    let clock = AdvancingClock(Cell::new(0));
    let ids = SequenceIds(Cell::new(0));
    let services = RuntimeServices {
        clock: &clock,
        ids: &ids,
    };
    let issue = Issue::new(2026, 7).unwrap();
    let mut person_ids = Vec::new();
    for (name, cohort) in [("가상하나", "94"), ("가상하나", "95"), ("가상둘", "94")] {
        create_draft(
            &mut repository,
            &services,
            CreateDraftRequest {
                name: name.into(),
                cohort: Some(cohort.into()),
                phone: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                memo: None,
            },
        )
        .unwrap();
        let found = load_distribution_desk(
            &mut repository,
            &clock,
            issue,
            &format!("{cohort}{name}"),
            true,
        )
        .unwrap();
        person_ids.push(found.people[0].person_id.clone());
    }
    let mut memo_ids = Vec::new();
    for person_id in [
        Some(&person_ids[0]),
        Some(&person_ids[1]),
        Some(&person_ids[0]),
        Some(&person_ids[2]),
        None,
    ] {
        memo_ids.push(
            create_memo(
                &mut repository,
                &services,
                CreateMemoRequest {
                    person_id: person_id.cloned(),
                    content: "가상하나가 본문에 있어도 연결 ID로 구분".into(),
                },
            )
            .unwrap(),
        );
    }
    let original = repository.list_memos().unwrap();
    let original_changes = repository.list_changes().unwrap();
    for (query, order) in [
        ("94 가상 하나", vec![2, 0, 4, 3, 1]),
        ("하나", vec![2, 1, 0, 4, 3]),
        ("95", vec![1, 4, 3, 2, 0]),
        ("없는이름", vec![4, 3, 2, 1, 0]),
        ("", vec![4, 3, 2, 1, 0]),
        ("   ", vec![4, 3, 2, 1, 0]),
    ] {
        let desk = load_distribution_desk(&mut repository, &clock, issue, query, true).unwrap();
        assert_eq!(
            desk.memos.iter().map(|memo| &memo.id).collect::<Vec<_>>(),
            order
                .iter()
                .map(|index| &memo_ids[*index])
                .collect::<Vec<_>>(),
            "query: {query}"
        );
    }
    assert_eq!(repository.list_memos().unwrap(), original);
    assert_eq!(repository.list_changes().unwrap(), original_changes);

    // A different issue can hide a person from distribution without hiding their memos.
    let desk = load_distribution_desk(
        &mut repository,
        &clock,
        Issue::new(2026, 5).unwrap(),
        "95가상하나",
        true,
    )
    .unwrap();
    assert!(desk.people.is_empty());
    assert_eq!(desk.memos[0].id, memo_ids[1]);
}

struct SequenceIds(Cell<u32>);

impl IdGenerator for SequenceIds {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("phase2-integration-{next}")
    }
}

#[test]
fn persists_and_searches_complete_distribution_desk_flow_after_reopen() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("distribution-desk.sqlite");
    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    repository.migrate().unwrap();
    save_operator(&mut repository, &FixedClock, "가상담당자").unwrap();
    let ids = SequenceIds(Cell::new(0));
    let services = RuntimeServices {
        clock: &FixedClock,
        ids: &ids,
    };
    let issue = Issue::new(2026, 7).unwrap();

    create_draft(
        &mut repository,
        &services,
        CreateDraftRequest {
            name: "가상 홍길동".into(),
            cohort: Some("94".into()),
            phone: Some("010-1234-5678".into()),
            issue_year: 2026,
            issue_month: 7,
            quantity: 2,
            memo: None,
        },
    )
    .unwrap();
    let found =
        load_distribution_desk(&mut repository, &FixedClock, issue, "94가상", false).unwrap();
    assert_eq!(found.people.len(), 1);
    assert_eq!(found.people[0].phone.as_deref(), Some("010-1234-5678"));
    let subscription_id = found.people[0].subscription_id.clone().unwrap();

    record_distribution(
        &mut repository,
        &services,
        RecordDistributionRequest {
            issue_year: 2026,
            issue_month: 7,
            subscription_id,
            quantity: Some(1),
            note: None,
        },
    )
    .unwrap();
    create_check_item(
        &mut repository,
        &services,
        CreateCheckItemRequest {
            person_id: Some(found.people[0].person_id.clone()),
            content: "가상 확인 필요".into(),
        },
    )
    .unwrap();
    create_pinned_note(
        &mut repository,
        &services,
        CreatePinnedNoteRequest {
            title: "가상 보관 위치".into(),
            content: "가상 예배당 뒤".into(),
            is_pinned: true,
        },
    )
    .unwrap();
    record_purchase(
        &mut repository,
        &services,
        RecordPurchaseRequest {
            person_id: None,
            buyer_name: Some("가상 구매자".into()),
            issue_year: 2026,
            issue_month: 7,
            quantity: 1,
            note: None,
        },
    )
    .unwrap();
    drop(repository);

    let mut reopened = SqliteCoreRepository::open(&path).unwrap();
    let restored =
        load_distribution_desk(&mut reopened, &FixedClock, issue, "94가상", false).unwrap();
    assert_eq!(restored.people[0].distribution_status, "일부 배부");
    assert_eq!(restored.people[0].remaining_quantity, 1);
    assert!(restored.people[0].has_memo);
    assert_eq!(restored.check_items.len(), 1);
    assert_eq!(
        restored.check_items[0].person_name.as_deref(),
        Some("가상 홍길동")
    );
    assert_eq!(restored.pinned_notes.len(), 1);
    assert_eq!(
        (restored.purchase_count, restored.purchased_quantity),
        (1, 1)
    );
    assert_eq!(restored.operator_name.as_deref(), Some("가상담당자"));

    let phone_search =
        load_distribution_desk(&mut reopened, &FixedClock, issue, "12345678", false).unwrap();
    assert!(phone_search.people.is_empty());

    update_check_item_status(
        &mut reopened,
        &services,
        UpdateCheckItemStatusRequest {
            id: restored.check_items[0].id.clone(),
            status: CheckItemStatus::Checked,
        },
    )
    .unwrap();
    undo_last_distribution(
        &mut reopened,
        &services,
        UndoDistributionRequest {
            issue_year: 2026,
            issue_month: 7,
            subscription_id: None,
        },
    )
    .unwrap();
    let after_undo =
        load_distribution_desk(&mut reopened, &FixedClock, issue, "가상", false).unwrap();
    assert_eq!(after_undo.people[0].distribution_status, "미배부");
    assert_eq!(after_undo.check_items[0].status, "확인 완료");

    delete_check_item(&mut reopened, &services, &restored.check_items[0].id).unwrap();
    delete_pinned_note(&mut reopened, &services, &restored.pinned_notes[0].id).unwrap();
    let after_delete = load_distribution_desk(&mut reopened, &FixedClock, issue, "", true).unwrap();
    assert!(after_delete.check_items.is_empty());
    assert!(after_delete.pinned_notes.is_empty());
}
