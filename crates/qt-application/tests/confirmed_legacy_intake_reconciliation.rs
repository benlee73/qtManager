use qt_application::{
    ApplicationError, ConfirmedAnnualIntake, ConfirmedLegacyIntakeCorrection,
    ConfirmedOneTimeIntake, IdGenerator, LegacySubscriptionExpectation, StateSnapshot,
    reconcile_confirmed_legacy_intakes,
};
use qt_domain::{
    CheckItem, CheckItemStatus, Distribution, Issue, Person, PersonStatus, Subscription,
    SubscriptionSource,
};

const IMPORTED_AT: &str = "2026-07-27T09:23:07Z";
const FIXED_AT: &str = "2026-08-03T20:00:00+09:00";

struct SequentialIds(std::cell::Cell<u32>);

impl IdGenerator for SequentialIds {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("generated-{next}")
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

fn subscription(id: &str, owner: &str, year: i32, month: u8, quantity: u32) -> Subscription {
    Subscription {
        payment_status: None,
        id: id.into(),
        person_id: owner.into(),
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
        note: None,
        reversal_of: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

#[test]
fn confirms_direct_and_merged_annual_intakes_without_losing_history() {
    let mut snapshot = StateSnapshot {
        people: vec![
            person("direct", None),
            person("canonical", Some("00")),
            person("renewal-owner", None),
        ],
        subscriptions: vec![
            subscription("direct-renewal", "direct", 2026, 7, 1),
            subscription("historic", "canonical", 2025, 7, 2),
            subscription("merged-renewal", "renewal-owner", 2026, 7, 2),
        ],
        distributions: vec![distribution("historic-july", "historic", 2026, 1)],
        check_items: vec![
            warning("direct-warning", "direct"),
            warning("renewal-warning", "renewal-owner"),
        ],
        ..StateSnapshot::default()
    };
    snapshot
        .people
        .iter_mut()
        .find(|item| item.id == "renewal-owner")
        .unwrap()
        .person_note = Some("익명 장기 참고".into());

    let result = reconcile_confirmed_legacy_intakes(
        &mut snapshot,
        &[
            ConfirmedLegacyIntakeCorrection::Annual(ConfirmedAnnualIntake {
                subscription: expectation("direct-renewal", "direct", 2026, 7),
                canonical_person_id: None,
                confirmed_quantity: 1,
            }),
            ConfirmedLegacyIntakeCorrection::Annual(ConfirmedAnnualIntake {
                subscription: expectation("merged-renewal", "renewal-owner", 2026, 7),
                canonical_person_id: Some("canonical".into()),
                confirmed_quantity: 2,
            }),
        ],
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.people.len(), 2);
    assert_eq!(
        snapshot
            .people
            .iter()
            .find(|item| item.id == "canonical")
            .unwrap()
            .person_note
            .as_deref(),
        Some("익명 장기 참고")
    );
    assert_eq!(snapshot.subscriptions.len(), 3);
    assert_eq!(
        snapshot
            .subscriptions
            .iter()
            .find(|item| item.id == "merged-renewal")
            .unwrap()
            .person_id,
        "canonical"
    );
    assert_eq!(snapshot.distributions[0].subscription_id, "historic");
    assert!(snapshot.check_items.is_empty());
    assert_eq!(result.confirmed_annual_subscriptions, 2);
    assert_eq!(result.removed_people, 1);
    assert_eq!(result.removed_start_checks, 2);
}

#[test]
fn converts_confirmed_single_issue_intakes_to_purchases_and_keeps_existing_annual() {
    let mut snapshot = StateSnapshot {
        people: vec![
            person("single", None),
            person("canonical", Some("00")),
            person("extra-owner", None),
        ],
        subscriptions: vec![
            subscription("single-wrong", "single", 2026, 7, 1),
            subscription("annual", "canonical", 2026, 1, 1),
            subscription("extra-wrong", "extra-owner", 2026, 7, 6),
        ],
        distributions: vec![distribution("annual-july", "annual", 2026, 7)],
        check_items: vec![
            warning("single-warning", "single"),
            warning("extra-warning", "extra-owner"),
        ],
        ..StateSnapshot::default()
    };

    let result = reconcile_confirmed_legacy_intakes(
        &mut snapshot,
        &[
            ConfirmedLegacyIntakeCorrection::OneTime(ConfirmedOneTimeIntake {
                subscription: expectation("single-wrong", "single", 2026, 7),
                canonical_person_id: None,
                issue: Issue::new(2026, 7).unwrap(),
                confirmed_quantity: 1,
            }),
            ConfirmedLegacyIntakeCorrection::OneTime(ConfirmedOneTimeIntake {
                subscription: expectation("extra-wrong", "extra-owner", 2026, 7),
                canonical_person_id: Some("canonical".into()),
                issue: Issue::new(2026, 7).unwrap(),
                confirmed_quantity: 6,
            }),
        ],
        "가상 담당자",
        FIXED_AT,
        &SequentialIds(std::cell::Cell::new(0)),
    )
    .unwrap();

    assert_eq!(snapshot.people.len(), 2);
    assert_eq!(snapshot.subscriptions.len(), 1);
    assert_eq!(snapshot.subscriptions[0].id, "annual");
    assert_eq!(snapshot.distributions.len(), 1);
    assert_eq!(snapshot.distributions[0].subscription_id, "annual");
    assert_eq!(snapshot.purchases.len(), 2);
    assert_eq!(snapshot.purchases[0].person_id.as_deref(), Some("single"));
    assert_eq!(snapshot.purchases[0].quantity, 1);
    assert_eq!(
        snapshot.purchases[1].person_id.as_deref(),
        Some("canonical")
    );
    assert_eq!(snapshot.purchases[1].quantity, 6);
    assert!(snapshot.check_items.is_empty());
    assert_eq!(result.converted_one_time_purchases, 2);
    assert_eq!(result.removed_subscriptions, 2);
    assert_eq!(result.removed_people, 1);
    assert_eq!(
        snapshot
            .changes
            .iter()
            .filter(|item| item.action_type == "legacy_confirmed_person_reconciled")
            .count(),
        1
    );
}

#[test]
fn rejects_modified_input_without_partially_applying_confirmations() {
    let mut snapshot = StateSnapshot {
        people: vec![person("first", None), person("second", None)],
        subscriptions: vec![
            subscription("first-renewal", "first", 2026, 7, 1),
            subscription("second-renewal", "second", 2026, 7, 1),
        ],
        check_items: vec![
            warning("first-warning", "first"),
            warning("second-warning", "second"),
        ],
        ..StateSnapshot::default()
    };
    snapshot.subscriptions[1].updated_at = FIXED_AT.into();
    let before = snapshot.clone();

    let result = reconcile_confirmed_legacy_intakes(
        &mut snapshot,
        &[
            ConfirmedLegacyIntakeCorrection::Annual(ConfirmedAnnualIntake {
                subscription: expectation("first-renewal", "first", 2026, 7),
                canonical_person_id: None,
                confirmed_quantity: 1,
            }),
            ConfirmedLegacyIntakeCorrection::Annual(ConfirmedAnnualIntake {
                subscription: expectation("second-renewal", "second", 2026, 7),
                canonical_person_id: None,
                confirmed_quantity: 1,
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
