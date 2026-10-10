use std::cell::Cell;

use qt_application::{
    Clock, DistributionDeskRepository, IdGenerator, PeopleManagementRepository,
    RecordDistributionRequest, RegisterPersonRequest, RenewSubscriptionRequest, RuntimeServices,
    UpdatePersonRequest, load_people_management, load_person_detail, record_distribution,
    register_person, renew_subscription, set_person_archived, update_person,
};
use qt_domain::{ChangeLog, CheckItem, CheckItemStatus, Issue};
use qt_infrastructure::SqliteCoreRepository;
use tempfile::tempdir;

struct FixedRuntime(Cell<u32>);

impl Clock for FixedRuntime {
    fn now(&self) -> String {
        "2026-07-26T10:00:00+09:00".into()
    }

    fn today(&self) -> String {
        "2026-07-26".into()
    }
}

impl IdGenerator for FixedRuntime {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("phase3-{next}")
    }
}

#[test]
fn persists_registration_profile_completion_renewal_archive_and_history_across_restart() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("management.sqlite");
    let runtime = FixedRuntime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };

    let person_id = {
        let mut repository = SqliteCoreRepository::open(&path).unwrap();
        PeopleManagementRepository::migrate(&mut repository).unwrap();
        qt_application::DistributionDeskRepository::save_operator(
            &mut repository,
            "가상담당자",
            &runtime.now(),
        )
        .unwrap();
        register_person(
            &mut repository,
            &services,
            RegisterPersonRequest {
                name: "가상관리".into(),
                cohort: Some("00".into()),
                phone: Some("010-0000-1234".into()),
                person_note: Some("연락은 문자".into()),
                issue_year: 2026,
                issue_month: 7,
                quantity: 2,
                applied_at: Some("2026-07-26".into()),
                memo: Some("직접 등록".into()),
                confirm_duplicate: false,
            },
        )
        .unwrap()
    };

    {
        let mut repository = SqliteCoreRepository::open(&path).unwrap();
        let detail =
            load_person_detail(&mut repository, &person_id, Issue::new(2026, 7).unwrap()).unwrap();
        assert_eq!(detail.name, "가상관리");
        assert_eq!(detail.subscriptions[0].last_issue, "2027년 5~6월호");

        update_person(
            &mut repository,
            &services,
            UpdatePersonRequest {
                person_id: person_id.clone(),
                name: "가상관리수정".into(),
                cohort: Some("00".into()),
                phone: Some("010-0000-9999".into()),
                person_note: Some("두 권 수령".into()),
                confirm_duplicate: false,
            },
        )
        .unwrap();
        renew_subscription(
            &mut repository,
            &services,
            RenewSubscriptionRequest {
                person_id: person_id.clone(),
                issue_year: 2027,
                issue_month: 7,
                quantity: 1,
                applied_at: Some("2026-07-26".into()),
                memo: None,
                confirm_overlap: false,
            },
        )
        .unwrap();
        set_person_archived(&mut repository, &services, &person_id, true).unwrap();
    }

    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    let hidden = load_people_management(&mut repository, "", false).unwrap();
    assert!(hidden.people.is_empty());
    let visible = load_people_management(&mut repository, "9999", true).unwrap();
    assert_eq!(visible.people.len(), 1);
    assert_eq!(visible.people[0].status, "보관됨");
    assert_eq!(visible.people[0].phone.as_deref(), Some("010-0000-9999"));
    let detail =
        load_person_detail(&mut repository, &person_id, Issue::new(2028, 1).unwrap()).unwrap();
    assert_eq!(detail.subscriptions.len(), 2);
    assert_eq!(
        detail.subscriptions[0].start_issue,
        Issue::new(2027, 7).unwrap().display_name()
    );
}

#[test]
fn orders_distribution_history_by_issue_when_imported_times_match() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("management.sqlite");
    let runtime = FixedRuntime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };

    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    PeopleManagementRepository::migrate(&mut repository).unwrap();
    qt_application::DistributionDeskRepository::save_operator(
        &mut repository,
        "가상담당자",
        &runtime.now(),
    )
    .unwrap();
    let person_id = register_person(
        &mut repository,
        &services,
        RegisterPersonRequest {
            name: "가상이력".into(),
            cohort: Some("00".into()),
            phone: None,
            person_note: None,
            issue_year: 2026,
            issue_month: 1,
            quantity: 1,
            applied_at: None,
            memo: None,
            confirm_duplicate: false,
        },
    )
    .unwrap();
    let subscription_id =
        load_person_detail(&mut repository, &person_id, Issue::new(2026, 1).unwrap())
            .unwrap()
            .subscriptions[0]
            .id
            .clone();

    for issue_month in [1, 3, 5, 7] {
        record_distribution(
            &mut repository,
            &services,
            RecordDistributionRequest {
                issue_year: 2026,
                issue_month,
                subscription_id: subscription_id.clone(),
                quantity: Some(1),
                note: None,
            },
        )
        .unwrap();
    }

    let detail =
        load_person_detail(&mut repository, &person_id, Issue::new(2026, 7).unwrap()).unwrap();
    assert_eq!(
        detail
            .distributions
            .iter()
            .map(|item| item.issue.as_str())
            .collect::<Vec<_>>(),
        vec![
            "2026년 7~8월호",
            "2026년 5~6월호",
            "2026년 3~4월호",
            "2026년 1~2월호",
        ],
    );
}

#[test]
fn loads_non_archived_linked_check_items_in_latest_update_order_across_restart() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("management.sqlite");
    let runtime = FixedRuntime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };

    let person_id = {
        let mut repository = SqliteCoreRepository::open(&path).unwrap();
        PeopleManagementRepository::migrate(&mut repository).unwrap();
        qt_application::DistributionDeskRepository::save_operator(
            &mut repository,
            "가상담당자",
            &runtime.now(),
        )
        .unwrap();
        let person_id = register_person(
            &mut repository,
            &services,
            RegisterPersonRequest {
                name: "가상신청자".into(),
                cohort: Some("00".into()),
                phone: Some("010-0000-1234".into()),
                person_note: Some("연락은 문자".into()),
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                applied_at: None,
                memo: None,
                confirm_duplicate: false,
            },
        )
        .unwrap();
        let other_person_id = register_person(
            &mut repository,
            &services,
            RegisterPersonRequest {
                name: "다른가상신청자".into(),
                cohort: Some("01".into()),
                phone: Some("010-0000-5678".into()),
                person_note: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                applied_at: None,
                memo: None,
                confirm_duplicate: false,
            },
        )
        .unwrap();
        for item in [
            check_item(
                "linked-needs-check",
                Some(&person_id),
                "가상 수량 확인",
                CheckItemStatus::NeedsCheck,
                "2026-07-26T10:01:00+09:00",
                None,
            ),
            check_item(
                "linked-checked",
                Some(&person_id),
                "가상 연락 확인",
                CheckItemStatus::Checked,
                "2026-07-26T10:02:00+09:00",
                Some("2026-07-26T10:02:00+09:00"),
            ),
            check_item(
                "linked-archived",
                Some(&person_id),
                "가상 보관 확인",
                CheckItemStatus::Archived,
                "2026-07-26T10:03:00+09:00",
                None,
            ),
            check_item(
                "other-person-check",
                Some(&other_person_id),
                "다른 가상 신청자 확인",
                CheckItemStatus::NeedsCheck,
                "2026-07-26T10:04:00+09:00",
                None,
            ),
        ] {
            DistributionDeskRepository::save_check_item(
                &mut repository,
                &item,
                &check_item_change(&item),
            )
            .unwrap();
        }
        person_id
    };

    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    let detail =
        load_person_detail(&mut repository, &person_id, Issue::new(2026, 7).unwrap()).unwrap();
    assert_eq!(detail.person_note.as_deref(), Some("연락은 문자"));
    assert_eq!(
        detail
            .check_items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec!["linked-checked", "linked-needs-check"]
    );
    assert_eq!(
        detail
            .check_items
            .iter()
            .map(|item| (item.summary.as_str(), item.status.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("가상 연락 확인", "확인 완료"),
            ("가상 수량 확인", "확인 필요"),
        ]
    );
}

fn check_item(
    id: &str,
    person_id: Option<&str>,
    content: &str,
    status: CheckItemStatus,
    updated_at: &str,
    checked_at: Option<&str>,
) -> CheckItem {
    CheckItem {
        id: id.into(),
        person_id: person_id.map(str::to_owned),
        content: content.into(),
        status,
        operator_name: "가상담당자".into(),
        created_at: "2026-07-26T10:00:00+09:00".into(),
        updated_at: updated_at.into(),
        checked_at: checked_at.map(str::to_owned),
    }
}

fn check_item_change(item: &CheckItem) -> ChangeLog {
    ChangeLog {
        id: format!("change-{}", item.id),
        occurred_at: item.updated_at.clone(),
        operator_name: item.operator_name.clone(),
        action_type: "check_item_saved".into(),
        entity_type: "check_item".into(),
        entity_id: item.id.clone(),
        summary: "가상 확인 항목 저장".into(),
        before_json: None,
        after_json: None,
    }
}

#[test]
fn orders_actual_missing_cohort_first_without_draft_or_group_priority() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("sorting.sqlite");
    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    PeopleManagementRepository::migrate(&mut repository).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    let people = [
        ("complete-draft", "다완료", Some("00"), "draft", false),
        ("complete-active", "가완료", Some("01"), "active", false),
        ("missing-draft", "나누락", None, "draft", false),
        ("missing-active", "가누락", None, "active", false),
        ("group", "나군지체", None, "active", true),
        ("archived", "가보관", None, "archived", false),
    ];
    for (id, name, cohort, status, group) in people {
        connection.execute(
            "INSERT INTO people(id,name,cohort,status,is_group,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'2026-10-08','2026-10-08')",
            rusqlite::params![id, name, cohort, status, group],
        ).unwrap();
    }
    let rows = repository.list_people("", false).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| row.person.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "missing-active",
            "missing-draft",
            "complete-active",
            "group",
            "complete-draft"
        ]
    );
    let with_archived = repository.list_people("", true).unwrap();
    assert_eq!(
        with_archived
            .iter()
            .map(|row| row.person.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "missing-active",
            "missing-draft",
            "archived",
            "complete-active",
            "group",
            "complete-draft"
        ]
    );
}
