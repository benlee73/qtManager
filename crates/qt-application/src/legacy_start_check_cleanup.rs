use qt_domain::{
    ChangeLog, CheckItemStatus, Person, Subscription, SubscriptionSource, normalize_phone,
    normalize_search_text,
};

use crate::{IdGenerator, StateSnapshot};

const START_CHECK_CONTENT: &str = "구독 시작 호 확인";
const PERIOD_CONFLICT_CONTENT: &str = "구독 시작·종료 호 불일치";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyStartCheckSkipReason {
    AmbiguousIdentity,
    SourceStillUnverified,
    CurrentRecordModified,
    SubscriptionMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SkippedLegacyStartCheck {
    pub check_item_id: String,
    pub reason: LegacyStartCheckSkipReason,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LegacyStartCheckCleanupPlan {
    pub removable_check_item_ids: Vec<String>,
    pub skipped: Vec<SkippedLegacyStartCheck>,
}

pub fn plan_legacy_start_check_cleanup(
    current: &StateSnapshot,
    verified: &StateSnapshot,
) -> LegacyStartCheckCleanupPlan {
    let mut plan = LegacyStartCheckCleanupPlan::default();

    for check in current
        .check_items
        .iter()
        .filter(|item| item.content == START_CHECK_CONTENT)
    {
        let Some(current_person_id) = check.person_id.as_deref() else {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::AmbiguousIdentity,
            );
            continue;
        };
        let Some(current_person) = current
            .people
            .iter()
            .find(|person| person.id == current_person_id)
        else {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::AmbiguousIdentity,
            );
            continue;
        };
        let verified_people = verified
            .people
            .iter()
            .filter(|person| same_identity(current_person, person))
            .collect::<Vec<_>>();
        if verified_people.len() != 1 {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::AmbiguousIdentity,
            );
            continue;
        }
        let verified_person = verified_people[0];

        if verified.check_items.iter().any(|item| {
            item.person_id.as_deref() == Some(verified_person.id.as_str())
                && matches!(
                    item.content.as_str(),
                    START_CHECK_CONTENT | PERIOD_CONFLICT_CONTENT
                )
        }) {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::SourceStillUnverified,
            );
            continue;
        }

        let all_current_legacy = current
            .subscriptions
            .iter()
            .filter(|subscription| {
                subscription.person_id == current_person_id
                    && subscription.source == SubscriptionSource::LegacyXlsx
            })
            .collect::<Vec<_>>();
        let current_subscriptions = legacy_subscriptions(current, current_person_id);
        if check.status != CheckItemStatus::NeedsCheck
            || check.checked_at.is_some()
            || check.created_at != check.updated_at
            || all_current_legacy.iter().any(|subscription| {
                subscription.created_at != subscription.updated_at
                    || subscription.archived_at.is_some()
            })
        {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::CurrentRecordModified,
            );
            continue;
        }

        let verified_subscriptions = legacy_subscriptions(verified, &verified_person.id);
        if current_subscriptions.is_empty()
            || verified_subscriptions.is_empty()
            || subscription_signatures(&current_subscriptions)
                != subscription_signatures(&verified_subscriptions)
        {
            skip(
                &mut plan,
                &check.id,
                LegacyStartCheckSkipReason::SubscriptionMismatch,
            );
            continue;
        }

        plan.removable_check_item_ids.push(check.id.clone());
    }

    plan
}

pub fn apply_legacy_start_check_cleanup<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    plan: &LegacyStartCheckCleanupPlan,
    operator_name: &str,
    now: &str,
    ids: &I,
) -> usize {
    let mut removed_ids = Vec::new();
    snapshot.check_items.retain(|item| {
        let remove = plan
            .removable_check_item_ids
            .iter()
            .any(|id| id == &item.id)
            && item.content == START_CHECK_CONTENT;
        if remove {
            removed_ids.push(item.id.clone());
        }
        !remove
    });
    for check_item_id in &removed_ids {
        snapshot.changes.push(ChangeLog {
            id: ids.next_id(),
            occurred_at: now.into(),
            operator_name: operator_name.into(),
            action_type: "legacy_start_check_resolved".into(),
            entity_type: "check_item".into(),
            entity_id: check_item_id.clone(),
            summary: "원본 구독 기간 검증 후 확인할 일 제거".into(),
            before_json: None,
            after_json: None,
        });
    }
    removed_ids.len()
}

fn skip(
    plan: &mut LegacyStartCheckCleanupPlan,
    check_item_id: &str,
    reason: LegacyStartCheckSkipReason,
) {
    plan.skipped.push(SkippedLegacyStartCheck {
        check_item_id: check_item_id.into(),
        reason,
    });
}

fn same_identity(left: &Person, right: &Person) -> bool {
    normalize_search_text(&left.name) == normalize_search_text(&right.name)
        && left.cohort == right.cohort
        && normalized_phone(left) == normalized_phone(right)
}

fn normalized_phone(person: &Person) -> String {
    person
        .normalized_phone
        .clone()
        .unwrap_or_else(|| normalize_phone(person.phone.as_deref().unwrap_or_default()))
}

fn legacy_subscriptions<'a>(snapshot: &'a StateSnapshot, person_id: &str) -> Vec<&'a Subscription> {
    snapshot
        .subscriptions
        .iter()
        .filter(|subscription| {
            subscription.person_id == person_id
                && subscription.source == SubscriptionSource::LegacyXlsx
                && subscription.archived_at.is_none()
        })
        .collect()
}

fn subscription_signatures(subscriptions: &[&Subscription]) -> Vec<(i32, u8, u16, u32)> {
    let mut signatures = subscriptions
        .iter()
        .map(|subscription| {
            (
                subscription.start_issue.year,
                subscription.start_issue.start_month,
                subscription.issue_count,
                subscription.quantity,
            )
        })
        .collect::<Vec<_>>();
    signatures.sort_unstable();
    signatures
}
