use qt_application::{
    ApplicationError, IdGenerator, LegacyPeriodCorrection, LegacyPeriodShift, LegacyRenewalMerge,
    LegacySubscriptionExpectation, StateSnapshot, VerifiedLegacyProfile,
    reconcile_verified_legacy_periods,
};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, Issue, Person, PersonStatus, Subscription,
    SubscriptionSource,
};

const IMPORTED_AT: &str = "2026-07-27T09:23:07Z";
const FIXED_AT: &str = "2026-08-03T18:00:00+09:00";

struct SequentialIds(std::cell::Cell<u32>);

impl IdGenerator for SequentialIds {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("change-{next}")
    }
}

fn person(id: &str, name: &str, cohort: Option<&str>, phone: Option<&str>) -> Person {
    Person {
        is_group: false,
        id: id.into(),
        name: name.into(),
        cohort: cohort.map(str::to_owned),
        phone: phone.map(str::to_owned),
        normalized_phone: phone.map(|value| value.replace('-', "")),
        status: PersonStatus::Active,
        person_note: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

fn subscription(id: &str, person_id: &str, year: i32, month: u8, quantity: u32) -> Subscription {
    Subscription {
        payment_status: None,
        id: id.into(),
        person_id: person_id.into(),
        start_issue: Issue::new(year, month).unwrap(),
        issue_count: 6,
        quantity,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: Some(format!("source-{id}")),
        memo: Some("익명 기존 자료 이전".into()),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        archived_at: None,
    }
}

fn distribution(
    id: &str,
    subscription_id: &str,
    year: i32,
    month: u8,
    reversal_of: Option<&str>,
) -> Distribution {
    Distribution {
        id: id.into(),
        subscription_id: subscription_id.into(),
        issue: Issue::new(year, month).unwrap(),
        quantity: 1,
        distributed_at: IMPORTED_AT.into(),
        note: Some("익명 기존 배부 이전".into()),
        reversal_of: reversal_of.map(str::to_owned),
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

fn expectation(id: &str, owner: &str, year: i32, month: u8) -> LegacySubscriptionExpectation {
    LegacySubscriptionExpectation {
        subscription_id: id.into(),
        owner_person_id: owner.into(),
        expected_start: Issue::new(year, month).unwrap(),
        expected_source_reference: format!("source-{id}"),
    }
}

#[test]
fn shifts_one_issue_late_subscription_and_preserves_distribution_reversal_history() {
    let mut snapshot = StateSnapshot {
        people: vec![person(
            "person",
            "가상 신청자",
            Some("00"),
            Some("010-0000-0000"),
        )],
        subscriptions: vec![subscription("late", "person", 2026, 5, 1)],
        distributions: vec![
            distribution("received", "late", 2026, 7, None),
            distribution("reversed", "late", 2026, 7, Some("received")),
        ],
        check_items: vec![start_warning("warning", "person")],
        ..StateSnapshot::default()
    };

    let result = reconcile_verified_legacy_periods(
        &mut snapshot,
        &[LegacyPeriodCorrection::Shift(LegacyPeriodShift {
            subscription: expectation("late", "person", 2026, 5),
            corrected_start: Issue::new(2026, 3).unwrap(),
        })],
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(
        snapshot.subscriptions[0].start_issue,
        Issue::new(2026, 3).unwrap()
    );
    assert_eq!(
        snapshot.subscriptions[0].last_issue().unwrap(),
        Issue::new(2027, 1).unwrap()
    );
    assert_eq!(snapshot.distributions.len(), 2);
    assert_eq!(
        snapshot.distributions[1].reversal_of.as_deref(),
        Some("received")
    );
    assert!(snapshot.check_items.is_empty());
    assert_eq!(result.shifted_subscriptions, 1);
    assert_eq!(result.removed_subscriptions, 0);
    assert_eq!(result.removed_people, 0);
    assert_eq!(result.removed_start_checks, 1);
}

#[test]
fn merges_multiple_legacy_people_into_one_renewal_and_keeps_independent_subscription() {
    let mut snapshot = StateSnapshot {
        people: vec![
            person(
                "canonical",
                "가상 신청자",
                Some("00"),
                Some("010-0000-0000"),
            ),
            person("renewal-owner", "가상 신청자", None, None),
            person(
                "late-owner",
                "가상 신청자(추가)",
                Some("00"),
                Some("010-1111-1111"),
            ),
        ],
        subscriptions: vec![
            subscription("independent", "canonical", 2026, 3, 1),
            subscription("renewal", "renewal-owner", 2026, 5, 3),
            subscription("late", "late-owner", 2026, 7, 3),
        ],
        distributions: vec![
            distribution("independent-may", "independent", 2026, 5, None),
            distribution("renewal-may", "renewal", 2026, 5, None),
            distribution("late-july", "late", 2026, 7, None),
            distribution("late-july-reversal", "late", 2026, 7, Some("late-july")),
        ],
        check_items: vec![
            start_warning("canonical-warning", "canonical"),
            start_warning("renewal-warning", "renewal-owner"),
            start_warning("late-warning", "late-owner"),
        ],
        changes: vec![ChangeLog {
            id: "identity-change".into(),
            occurred_at: "2026-07-27T12:46:01Z".into(),
            operator_name: "가상 담당자".into(),
            action_type: "identity_normalized".into(),
            entity_type: "person".into(),
            entity_id: "late-owner".into(),
            summary: "기존 자료의 붙어 있는 또래와 이름을 분리함".into(),
            before_json: None,
            after_json: None,
        }],
        ..StateSnapshot::default()
    };
    snapshot
        .people
        .iter_mut()
        .find(|item| item.id == "late-owner")
        .unwrap()
        .updated_at = "2026-07-27T12:46:01Z".into();

    let result = reconcile_verified_legacy_periods(
        &mut snapshot,
        &[LegacyPeriodCorrection::Merge(LegacyRenewalMerge {
            canonical_person_id: "canonical".into(),
            duplicate_person_ids: vec!["renewal-owner".into(), "late-owner".into()],
            retained_subscription: expectation("renewal", "renewal-owner", 2026, 5),
            obsolete_subscriptions: vec![expectation("late", "late-owner", 2026, 7)],
            corrected_start: Issue::new(2026, 5).unwrap(),
            verified_profile: VerifiedLegacyProfile {
                name: "가상 신청자".into(),
                cohort: Some("00".into()),
                phone: Some("010-1111-1111".into()),
                normalized_phone: Some("01011111111".into()),
            },
        })],
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.people.len(), 1);
    assert_eq!(snapshot.people[0].id, "canonical");
    assert_eq!(snapshot.people[0].phone.as_deref(), Some("010-1111-1111"));
    assert_eq!(snapshot.subscriptions.len(), 2);
    assert_eq!(
        snapshot
            .subscriptions
            .iter()
            .find(|item| item.id == "renewal")
            .unwrap()
            .person_id,
        "canonical"
    );
    assert_eq!(
        snapshot
            .distributions
            .iter()
            .filter(|item| item.subscription_id == "renewal")
            .count(),
        3
    );
    assert_eq!(
        snapshot
            .distributions
            .iter()
            .find(|item| item.id == "late-july-reversal")
            .unwrap()
            .reversal_of
            .as_deref(),
        Some("late-july")
    );
    assert!(snapshot.check_items.is_empty());
    assert_eq!(result.shifted_subscriptions, 0);
    assert_eq!(result.removed_subscriptions, 1);
    assert_eq!(result.removed_people, 2);
    assert_eq!(result.moved_distributions, 2);
    assert_eq!(result.removed_start_checks, 3);
}

#[test]
fn rejects_any_modified_record_without_partially_applying_an_earlier_correction() {
    let mut snapshot = StateSnapshot {
        people: vec![
            person("first", "첫 신청자", Some("00"), None),
            person("second", "둘째 신청자", Some("01"), None),
        ],
        subscriptions: vec![
            subscription("first-late", "first", 2026, 5, 1),
            subscription("second-late", "second", 2026, 7, 1),
        ],
        check_items: vec![
            start_warning("first-warning", "first"),
            start_warning("second-warning", "second"),
        ],
        ..StateSnapshot::default()
    };
    snapshot.subscriptions[1].updated_at = FIXED_AT.into();
    let before = snapshot.clone();

    let result = reconcile_verified_legacy_periods(
        &mut snapshot,
        &[
            LegacyPeriodCorrection::Shift(LegacyPeriodShift {
                subscription: expectation("first-late", "first", 2026, 5),
                corrected_start: Issue::new(2026, 3).unwrap(),
            }),
            LegacyPeriodCorrection::Shift(LegacyPeriodShift {
                subscription: expectation("second-late", "second", 2026, 7),
                corrected_start: Issue::new(2026, 5).unwrap(),
            }),
        ],
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
