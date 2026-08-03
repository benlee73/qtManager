use std::cell::Cell;

use qt_application::{
    Clock, IdGenerator, PeopleManagementRepository, RegisterPersonRequest,
    RenewSubscriptionRequest, RuntimeServices, UpdatePersonRequest, load_people_management,
    load_person_detail, register_person, renew_subscription, set_person_archived, update_person,
};
use qt_domain::Issue;
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
