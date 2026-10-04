use qt_application::{
    ApplicationError, ConfirmedLegacyCheckDetail, ConfirmedLegacyFollowup,
    ConfirmedLegacySubscriptionConsolidation, IdGenerator, LegacySubscriptionExpectation,
    StateSnapshot, reconcile_confirmed_legacy_followups,
};
use qt_domain::{
    CheckItem, CheckItemStatus, Distribution, Issue, Person, PersonStatus, Subscription,
    SubscriptionSource,
};

const IMPORTED_AT: &str = "2026-07-27T09:23:07Z";
const FIXED_AT: &str = "2026-08-03T21:00:00+09:00";

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

fn subscription(id: &str, owner: &str, year: i32, month: u8) -> Subscription {
    Subscription {
        payment_status: None,
        id: id.into(),
        person_id: owner.into(),
        start_issue: Issue::new(year, month).unwrap(),
        issue_count: 6,
        quantity: 1,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: Some(format!("source-{id}")),
        memo: Some("익명 기존 자료 이전".into()),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        archived_at: None,
    }
}

fn expectation(id: &str, owner: &str, year: i32, month: u8) -> LegacySubscriptionExpectation {
    LegacySubscriptionExpectation {
        subscription_id: id.into(),
        owner_person_id: owner.into(),
        expected_start: Issue::new(year, month).unwrap(),
        expected_source_reference: format!("source-{id}"),
    }
}

fn warning(id: &str, owner: &str) -> CheckItem {
    CheckItem {
        id: id.into(),
        person_id: Some(owner.into()),
        content: "구독 시작 호 확인".into(),
        status: CheckItemStatus::NeedsCheck,
        operator_name: "가상 담당자".into(),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        checked_at: None,
    }
}

fn distribution(id: &str, subscription_id: &str, year: i32, month: u8) -> Distribution {
    Distribution {
        id: id.into(),
        subscription_id: subscription_id.into(),
        issue: Issue::new(year, month).unwrap(),
        quantity: 1,
        distributed_at: IMPORTED_AT.into(),
        note: Some("익명 배부 이력".into()),
        reversal_of: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

#[test]
fn replaces_generic_check_with_actionable_detail_without_logging_its_content() {
    let mut snapshot = StateSnapshot {
        people: vec![person("person", None)],
        check_items: vec![warning("check", "person")],
        ..StateSnapshot::default()
    };

    let result = reconcile_confirmed_legacy_followups(
        &mut snapshot,
        &[ConfirmedLegacyFollowup::CheckDetail(
            ConfirmedLegacyCheckDetail {
                check_item_id: "check".into(),
                person_id: "person".into(),
                expected_content: "구독 시작 호 확인".into(),
                replacement_content: "익명 신청 수량 확인 필요".into(),
            },
        )],
        "새 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.check_items[0].content, "익명 신청 수량 확인 필요");
    assert_eq!(snapshot.check_items[0].operator_name, "새 담당자");
    assert_eq!(snapshot.check_items[0].updated_at, FIXED_AT);
    assert_eq!(result.updated_check_items, 1);
    assert_eq!(snapshot.changes.len(), 1);
    assert_eq!(
        snapshot.changes[0].action_type,
        "legacy_check_detail_updated"
    );
    assert!(!snapshot.changes[0].summary.contains("신청 수량"));
    assert!(snapshot.changes[0].before_json.is_none());
    assert!(snapshot.changes[0].after_json.is_none());
}

#[test]
fn consolidates_confirmed_expiry_into_one_person_and_subscription_with_all_receipts() {
    let mut snapshot = StateSnapshot {
        people: vec![person("canonical", Some("00")), person("duplicate", None)],
        subscriptions: vec![
            subscription("retained", "canonical", 2025, 11),
            subscription("obsolete", "duplicate", 2026, 5),
        ],
        distributions: vec![
            distribution("january", "retained", 2026, 1),
            distribution("march", "retained", 2026, 3),
            distribution("may", "obsolete", 2026, 5),
            distribution("july", "retained", 2026, 7),
        ],
        check_items: vec![warning("warning", "duplicate")],
        ..StateSnapshot::default()
    };

    let result = reconcile_confirmed_legacy_followups(
        &mut snapshot,
        &[ConfirmedLegacyFollowup::SubscriptionConsolidation(
            ConfirmedLegacySubscriptionConsolidation {
                canonical_person_id: "canonical".into(),
                duplicate_person_id: "duplicate".into(),
                retained_subscription: expectation("retained", "canonical", 2025, 11),
                obsolete_subscription: expectation("obsolete", "duplicate", 2026, 5),
                expected_last_issue: Issue::new(2026, 9).unwrap(),
            },
        )],
        "새 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.people.len(), 1);
    assert_eq!(snapshot.people[0].id, "canonical");
    assert_eq!(snapshot.subscriptions.len(), 1);
    assert_eq!(snapshot.subscriptions[0].id, "retained");
    assert_eq!(
        snapshot.subscriptions[0].last_issue().unwrap(),
        Issue::new(2026, 9).unwrap()
    );
    assert_eq!(snapshot.distributions.len(), 4);
    assert!(
        snapshot
            .distributions
            .iter()
            .all(|item| item.subscription_id == "retained")
    );
    assert!(snapshot.check_items.is_empty());
    assert_eq!(result.consolidated_subscriptions, 1);
    assert_eq!(result.moved_distributions, 1);
    assert_eq!(result.removed_people, 1);
    assert_eq!(result.removed_subscriptions, 1);
    assert_eq!(result.removed_start_checks, 1);
}

#[test]
fn rejects_a_modified_later_followup_without_partially_updating_an_earlier_check() {
    let mut snapshot = StateSnapshot {
        people: vec![person("first", None), person("second", None)],
        check_items: vec![
            warning("first-check", "first"),
            warning("second-check", "second"),
        ],
        ..StateSnapshot::default()
    };
    snapshot.check_items[1].updated_at = FIXED_AT.into();
    let before = snapshot.clone();

    let result = reconcile_confirmed_legacy_followups(
        &mut snapshot,
        &[
            ConfirmedLegacyFollowup::CheckDetail(ConfirmedLegacyCheckDetail {
                check_item_id: "first-check".into(),
                person_id: "first".into(),
                expected_content: "구독 시작 호 확인".into(),
                replacement_content: "첫 상세 확인".into(),
            }),
            ConfirmedLegacyFollowup::CheckDetail(ConfirmedLegacyCheckDetail {
                check_item_id: "second-check".into(),
                person_id: "second".into(),
                expected_content: "구독 시작 호 확인".into(),
                replacement_content: "둘째 상세 확인".into(),
            }),
        ],
        "새 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    );

    assert!(matches!(
        result,
        Err(ApplicationError::UnsafeLegacyReconciliation)
    ));
    assert_eq!(snapshot, before);
}
