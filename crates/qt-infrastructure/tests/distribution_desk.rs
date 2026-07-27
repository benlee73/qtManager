use std::cell::Cell;

use qt_application::{
    Clock, CreateCheckItemRequest, CreateDraftRequest, CreatePinnedNoteRequest,
    DistributionDeskRepository, IdGenerator, RecordDistributionRequest, RecordPurchaseRequest,
    RuntimeServices, UndoDistributionRequest, UpdateCheckItemStatusRequest, create_check_item,
    create_draft, create_pinned_note, load_distribution_desk, record_distribution, record_purchase,
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
        load_distribution_desk(&mut reopened, &FixedClock, issue, "12345678", false).unwrap();
    assert_eq!(restored.people[0].distribution_status, "일부 배부");
    assert_eq!(restored.people[0].remaining_quantity, 1);
    assert!(restored.people[0].has_check_item);
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
}
