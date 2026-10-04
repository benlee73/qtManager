use qt_application::{
    ApplicationError, IdGenerator, LegacyDuplicateRenewalRequest,
    reconcile_legacy_duplicate_renewal,
};
use qt_domain::{
    CheckItem, CheckItemStatus, Distribution, Issue, Person, PersonStatus, Subscription,
    SubscriptionSource,
};

use qt_application::StateSnapshot;

const IMPORTED_AT: &str = "2026-07-27T09:23:07Z";
const FIXED_AT: &str = "2026-08-03T15:00:00+09:00";

struct SequentialIds(std::cell::Cell<u32>);

impl IdGenerator for SequentialIds {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("change-{next}")
    }
}

fn person(id: &str, cohort: Option<&str>) -> Person {
    Person {
        is_group: false,
        id: id.into(),
        name: "가상 신청자".into(),
        cohort: cohort.map(str::to_owned),
        phone: cohort.map(|_| "010-0000-0000".into()),
        normalized_phone: cohort.map(|_| "01000000000".into()),
        status: PersonStatus::Active,
        person_note: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

fn subscription(id: &str, person_id: &str, year: i32, month: u8) -> Subscription {
    Subscription {
        payment_status: None,
        id: id.into(),
        person_id: person_id.into(),
        start_issue: Issue::new(year, month).unwrap(),
        issue_count: 6,
        quantity: 1,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: Some(format!("source-{id}")),
        memo: Some("2026년 기존 배부현황 최초 이전".into()),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        archived_at: None,
    }
}

fn distribution(id: &str, subscription_id: &str, year: i32, month: u8) -> Distribution {
    Distribution {
        id: id.into(),
        subscription_id: subscription_id.into(),
        issue: Issue::new(year, month).unwrap(),
        quantity: 1,
        distributed_at: IMPORTED_AT.into(),
        note: Some("기존 배부 이전".into()),
        reversal_of: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

fn start_warning(id: &str, person_id: &str) -> CheckItem {
    CheckItem {
        id: id.into(),
        person_id: Some(person_id.into()),
        content: "구독 시작 호 확인".into(),
        status: CheckItemStatus::NeedsCheck,
        operator_name: "가상 담당자".into(),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        checked_at: None,
    }
}

fn duplicated_snapshot() -> StateSnapshot {
    StateSnapshot {
        people: vec![
            person("canonical-person", Some("00")),
            person("duplicate-person", None),
        ],
        subscriptions: vec![
            subscription("past-subscription", "canonical-person", 2025, 5),
            subscription("renewal-subscription", "duplicate-person", 2026, 5),
            subscription("obsolete-subscription", "canonical-person", 2026, 7),
        ],
        distributions: vec![
            distribution("past-march", "past-subscription", 2026, 3),
            distribution("renewal-may", "renewal-subscription", 2026, 5),
            distribution("obsolete-july", "obsolete-subscription", 2026, 7),
        ],
        check_items: vec![
            start_warning("canonical-warning", "canonical-person"),
            start_warning("duplicate-warning", "duplicate-person"),
            CheckItem {
                id: "other-check".into(),
                person_id: Some("duplicate-person".into()),
                content: "별도 확인".into(),
                ..start_warning("unused", "duplicate-person")
            },
        ],
        ..StateSnapshot::default()
    }
}

fn request() -> LegacyDuplicateRenewalRequest {
    LegacyDuplicateRenewalRequest {
        canonical_person_id: "canonical-person".into(),
        duplicate_person_id: "duplicate-person".into(),
        renewal_subscription_id: "renewal-subscription".into(),
        obsolete_subscription_id: "obsolete-subscription".into(),
        expected_renewal_start: Issue::new(2026, 5).unwrap(),
        expected_renewal_source_reference: "source-renewal-subscription".into(),
        expected_obsolete_start: Issue::new(2026, 7).unwrap(),
        expected_obsolete_source_reference: "source-obsolete-subscription".into(),
    }
}

#[test]
fn merges_duplicate_person_into_one_verified_renewal_without_losing_distributions() {
    let mut snapshot = duplicated_snapshot();

    let result = reconcile_legacy_duplicate_renewal(
        &mut snapshot,
        &request(),
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.people.len(), 1);
    assert_eq!(snapshot.people[0].id, "canonical-person");
    assert_eq!(snapshot.subscriptions.len(), 2);
    let renewal = snapshot
        .subscriptions
        .iter()
        .find(|item| item.id == "renewal-subscription")
        .unwrap();
    assert_eq!(renewal.person_id, "canonical-person");
    assert_eq!(renewal.start_issue, Issue::new(2026, 5).unwrap());
    assert_eq!(renewal.last_issue().unwrap(), Issue::new(2027, 3).unwrap());
    assert_eq!(
        snapshot
            .distributions
            .iter()
            .filter(|item| item.subscription_id == renewal.id)
            .map(|item| item.issue)
            .collect::<Vec<_>>(),
        vec![Issue::new(2026, 5).unwrap(), Issue::new(2026, 7).unwrap()]
    );
    assert_eq!(result.moved_distributions, 1);
    assert_eq!(result.removed_start_checks, 2);
    assert!(
        snapshot
            .check_items
            .iter()
            .all(|item| item.content != "구독 시작 호 확인")
    );
    assert_eq!(
        snapshot.check_items[0].person_id.as_deref(),
        Some("canonical-person")
    );
    assert_eq!(snapshot.changes.len(), 3);
    assert!(snapshot.changes.iter().all(|change| {
        change.before_json.is_none()
            && change.after_json.is_none()
            && !change.summary.contains("가상 신청자")
    }));
}

#[test]
fn rejects_modified_or_structurally_different_records_without_partial_changes() {
    let mut snapshot = duplicated_snapshot();
    snapshot.subscriptions[1].updated_at = FIXED_AT.into();
    let before = snapshot.clone();

    let result = reconcile_legacy_duplicate_renewal(
        &mut snapshot,
        &request(),
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    );

    assert!(matches!(
        result,
        Err(ApplicationError::UnsafeLegacyReconciliation)
    ));
    assert_eq!(snapshot, before);
}
