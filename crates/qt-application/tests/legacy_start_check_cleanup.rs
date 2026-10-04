use qt_application::{
    IdGenerator, LegacyStartCheckSkipReason, StateSnapshot, apply_legacy_start_check_cleanup,
    plan_legacy_start_check_cleanup,
};
use qt_domain::{
    CheckItem, CheckItemStatus, Issue, Person, PersonStatus, Subscription, SubscriptionSource,
};

const IMPORTED_AT: &str = "2026-07-27T09:23:07Z";

fn person(id: &str) -> Person {
    Person {
        is_group: false,
        id: id.into(),
        name: "가상 신청자".into(),
        cohort: Some("00".into()),
        phone: Some("010-0000-0000".into()),
        normalized_phone: Some("01000000000".into()),
        status: PersonStatus::Active,
        person_note: None,
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
    }
}

fn subscription(id: &str, person_id: &str, start_month: u8) -> Subscription {
    Subscription {
        payment_status: None,
        id: id.into(),
        person_id: person_id.into(),
        start_issue: Issue::new(2026, start_month).unwrap(),
        issue_count: 6,
        quantity: 1,
        applied_at: None,
        source: SubscriptionSource::LegacyXlsx,
        source_reference: Some("2026:1,2월:row-2".into()),
        memo: Some("2026년 기존 배부현황 최초 이전".into()),
        created_at: IMPORTED_AT.into(),
        updated_at: IMPORTED_AT.into(),
        archived_at: None,
    }
}

fn warning(id: &str, person_id: &str) -> CheckItem {
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

fn matching_snapshots() -> (StateSnapshot, StateSnapshot) {
    let current_person = person("current-person");
    let verified_person = person("verified-person");
    (
        StateSnapshot {
            people: vec![current_person],
            subscriptions: vec![subscription("current-subscription", "current-person", 1)],
            check_items: vec![warning("warning-1", "current-person")],
            ..StateSnapshot::default()
        },
        StateSnapshot {
            people: vec![verified_person],
            subscriptions: vec![subscription("verified-subscription", "verified-person", 1)],
            ..StateSnapshot::default()
        },
    )
}

#[test]
fn removes_only_untouched_warning_when_verified_subscription_matches_exactly() {
    let (current, verified) = matching_snapshots();

    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    assert_eq!(plan.removable_check_item_ids, vec!["warning-1"]);
    assert!(plan.skipped.is_empty());
}

#[test]
fn keeps_warning_when_verified_workbook_still_cannot_determine_start_issue() {
    let (current, mut verified) = matching_snapshots();
    verified
        .check_items
        .push(warning("verified-warning", "verified-person"));

    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    assert!(plan.removable_check_item_ids.is_empty());
    assert_eq!(
        plan.skipped[0].reason,
        LegacyStartCheckSkipReason::SourceStillUnverified
    );
}

#[test]
fn keeps_warning_when_current_subscription_differs_from_verified_workbook() {
    let (current, mut verified) = matching_snapshots();
    verified.subscriptions[0].start_issue = Issue::new(2026, 3).unwrap();

    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    assert!(plan.removable_check_item_ids.is_empty());
    assert_eq!(
        plan.skipped[0].reason,
        LegacyStartCheckSkipReason::SubscriptionMismatch
    );
}

#[test]
fn keeps_warning_when_no_verified_legacy_subscription_exists() {
    let (mut current, mut verified) = matching_snapshots();
    current.subscriptions.clear();
    verified.subscriptions.clear();

    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    assert!(plan.removable_check_item_ids.is_empty());
    assert_eq!(
        plan.skipped[0].reason,
        LegacyStartCheckSkipReason::SubscriptionMismatch
    );
}

#[test]
fn keeps_warning_when_subscription_or_warning_was_changed_after_import() {
    let (mut subscription_changed, verified) = matching_snapshots();
    subscription_changed.subscriptions[0].updated_at = "2026-08-03T10:00:00+09:00".into();
    let subscription_plan = plan_legacy_start_check_cleanup(&subscription_changed, &verified);
    assert_eq!(
        subscription_plan.skipped[0].reason,
        LegacyStartCheckSkipReason::CurrentRecordModified
    );

    let (mut warning_changed, verified) = matching_snapshots();
    warning_changed.check_items[0].updated_at = "2026-08-03T10:00:00+09:00".into();
    let warning_plan = plan_legacy_start_check_cleanup(&warning_changed, &verified);
    assert_eq!(
        warning_plan.skipped[0].reason,
        LegacyStartCheckSkipReason::CurrentRecordModified
    );

    let (mut archived_subscription, verified) = matching_snapshots();
    archived_subscription.subscriptions[0].archived_at = Some("2026-08-03T10:00:00+09:00".into());
    let archived_plan = plan_legacy_start_check_cleanup(&archived_subscription, &verified);
    assert_eq!(
        archived_plan.skipped[0].reason,
        LegacyStartCheckSkipReason::CurrentRecordModified
    );
}

struct FixedIds;

impl IdGenerator for FixedIds {
    fn next_id(&self) -> String {
        "cleanup-change-1".into()
    }
}

#[test]
fn applying_verified_plan_removes_warning_and_records_non_personal_change_log() {
    let (mut current, verified) = matching_snapshots();
    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    let removed = apply_legacy_start_check_cleanup(
        &mut current,
        &plan,
        "가상 담당자",
        "2026-08-03T14:00:00+09:00",
        &FixedIds,
    );

    assert_eq!(removed, 1);
    assert!(current.check_items.is_empty());
    assert_eq!(current.changes.len(), 1);
    assert_eq!(
        current.changes[0].action_type,
        "legacy_start_check_resolved"
    );
    assert_eq!(current.changes[0].entity_type, "check_item");
    assert_eq!(current.changes[0].entity_id, "warning-1");
    assert_eq!(
        current.changes[0].summary,
        "원본 구독 기간 검증 후 확인할 일 제거"
    );
    assert!(current.changes[0].before_json.is_none());
    assert!(current.changes[0].after_json.is_none());
}
