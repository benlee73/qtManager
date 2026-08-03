use std::collections::HashSet;

use qt_domain::{
    ChangeLog, CheckItemStatus, Issue, Subscription, SubscriptionSource, normalize_search_text,
};

use crate::{ApplicationError, IdGenerator, LegacySubscriptionExpectation, StateSnapshot};

const START_CHECK_CONTENT: &str = "구독 시작 호 확인";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfirmedLegacyCheckDetail {
    pub check_item_id: String,
    pub person_id: String,
    pub expected_content: String,
    pub replacement_content: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfirmedLegacySubscriptionConsolidation {
    pub canonical_person_id: String,
    pub duplicate_person_id: String,
    pub retained_subscription: LegacySubscriptionExpectation,
    pub obsolete_subscription: LegacySubscriptionExpectation,
    pub expected_last_issue: Issue,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConfirmedLegacyFollowup {
    CheckDetail(ConfirmedLegacyCheckDetail),
    SubscriptionConsolidation(ConfirmedLegacySubscriptionConsolidation),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ConfirmedLegacyFollowupReconciliationResult {
    pub updated_check_items: usize,
    pub consolidated_subscriptions: usize,
    pub moved_distributions: usize,
    pub removed_subscriptions: usize,
    pub removed_people: usize,
    pub removed_start_checks: usize,
}

pub fn reconcile_confirmed_legacy_followups<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    followups: &[ConfirmedLegacyFollowup],
    operator_name: &str,
    now: &str,
    ids: &I,
) -> Result<ConfirmedLegacyFollowupReconciliationResult, ApplicationError> {
    let mut candidate = snapshot.clone();
    let mut result = ConfirmedLegacyFollowupReconciliationResult::default();
    for followup in followups {
        match followup {
            ConfirmedLegacyFollowup::CheckDetail(request) => {
                apply_check_detail(
                    &mut candidate,
                    request,
                    operator_name,
                    now,
                    ids,
                    &mut result,
                )?;
            }
            ConfirmedLegacyFollowup::SubscriptionConsolidation(request) => {
                apply_consolidation(
                    &mut candidate,
                    request,
                    operator_name,
                    now,
                    ids,
                    &mut result,
                )?;
            }
        }
    }
    *snapshot = candidate;
    Ok(result)
}

fn apply_check_detail<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &ConfirmedLegacyCheckDetail,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut ConfirmedLegacyFollowupReconciliationResult,
) -> Result<(), ApplicationError> {
    if request.replacement_content.trim().is_empty()
        || !snapshot
            .people
            .iter()
            .any(|item| item.id == request.person_id)
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let check = snapshot
        .check_items
        .iter_mut()
        .find(|item| item.id == request.check_item_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    if check.person_id.as_deref() != Some(request.person_id.as_str())
        || check.content != request.expected_content
        || check.status != CheckItemStatus::NeedsCheck
        || check.checked_at.is_some()
        || check.created_at != check.updated_at
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    check.content = request.replacement_content.clone();
    check.operator_name = operator_name.into();
    check.updated_at = now.into();
    result.updated_check_items += 1;
    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_check_detail_updated",
        "check_item",
        &request.check_item_id,
        "사용자 확인을 근거로 확인할 일 내용을 구체화",
    );
    Ok(())
}

fn apply_consolidation<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &ConfirmedLegacySubscriptionConsolidation,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut ConfirmedLegacyFollowupReconciliationResult,
) -> Result<(), ApplicationError> {
    validate_people(snapshot, request)?;
    let retained = expected_subscription(snapshot, &request.retained_subscription)?;
    let obsolete = expected_subscription(snapshot, &request.obsolete_subscription)?;
    if request.retained_subscription.owner_person_id != request.canonical_person_id
        || request.obsolete_subscription.owner_person_id != request.duplicate_person_id
        || retained.quantity != obsolete.quantity
        || retained.last_issue()? != request.expected_last_issue
        || snapshot.subscriptions.iter().any(|item| {
            item.person_id == request.duplicate_person_id
                && item.id != request.obsolete_subscription.subscription_id
        })
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    validate_distributions(snapshot, request, retained)?;
    validate_duplicate_relations(snapshot, request)?;

    merge_person_note(
        snapshot,
        &request.canonical_person_id,
        &request.duplicate_person_id,
        now,
    )?;
    for distribution in &mut snapshot.distributions {
        if distribution.subscription_id == request.obsolete_subscription.subscription_id {
            distribution.subscription_id = request.retained_subscription.subscription_id.clone();
            distribution.updated_at = now.into();
            result.moved_distributions += 1;
        }
    }
    snapshot
        .subscriptions
        .retain(|item| item.id != request.obsolete_subscription.subscription_id);
    result.removed_subscriptions += 1;
    snapshot.check_items.retain(|item| {
        !(item.person_id.as_deref() == Some(request.duplicate_person_id.as_str())
            && item.content == START_CHECK_CONTENT)
    });
    result.removed_start_checks += 1;
    snapshot
        .people
        .retain(|item| item.id != request.duplicate_person_id);
    result.removed_people += 1;
    result.consolidated_subscriptions += 1;

    for (action_type, entity_type, entity_id, summary) in [
        (
            "legacy_confirmed_person_reconciled",
            "person",
            request.canonical_person_id.as_str(),
            "사용자 확인을 근거로 중복 신청자 통합",
        ),
        (
            "legacy_confirmed_subscription_consolidated",
            "subscription",
            request.retained_subscription.subscription_id.as_str(),
            "사용자 확인 종료 호에 맞춰 중복 구독 통합",
        ),
        (
            "legacy_start_check_resolved",
            "check_item",
            request.canonical_person_id.as_str(),
            "사용자 확인을 근거로 구독 확인 항목 정리",
        ),
    ] {
        add_change(
            snapshot,
            ids,
            operator_name,
            now,
            action_type,
            entity_type,
            entity_id,
            summary,
        );
    }
    Ok(())
}

fn validate_people(
    snapshot: &StateSnapshot,
    request: &ConfirmedLegacySubscriptionConsolidation,
) -> Result<(), ApplicationError> {
    if request.canonical_person_id == request.duplicate_person_id {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let canonical = snapshot
        .people
        .iter()
        .find(|item| item.id == request.canonical_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let duplicate = snapshot
        .people
        .iter()
        .find(|item| item.id == request.duplicate_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    if canonical.created_at != canonical.updated_at
        || duplicate.created_at != duplicate.updated_at
        || normalize_search_text(&canonical.name) != normalize_search_text(&duplicate.name)
        || (duplicate.cohort.is_some() && duplicate.cohort != canonical.cohort)
        || (duplicate.normalized_phone.is_some()
            && duplicate.normalized_phone != canonical.normalized_phone)
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(())
}

fn expected_subscription<'a>(
    snapshot: &'a StateSnapshot,
    expected: &LegacySubscriptionExpectation,
) -> Result<&'a Subscription, ApplicationError> {
    let subscription = snapshot
        .subscriptions
        .iter()
        .find(|item| item.id == expected.subscription_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    if subscription.person_id != expected.owner_person_id
        || subscription.start_issue != expected.expected_start
        || subscription.issue_count != 6
        || subscription.source != SubscriptionSource::LegacyXlsx
        || subscription.source_reference.as_deref()
            != Some(expected.expected_source_reference.as_str())
        || subscription.archived_at.is_some()
        || subscription.created_at != subscription.updated_at
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(subscription)
}

fn validate_distributions(
    snapshot: &StateSnapshot,
    request: &ConfirmedLegacySubscriptionConsolidation,
    retained: &Subscription,
) -> Result<(), ApplicationError> {
    let retained_issues = snapshot
        .distributions
        .iter()
        .filter(|item| item.subscription_id == request.retained_subscription.subscription_id)
        .map(|item| item.issue)
        .collect::<HashSet<_>>();
    if snapshot
        .distributions
        .iter()
        .filter(|item| {
            matches!(
                item.subscription_id.as_str(),
                id if id == request.retained_subscription.subscription_id
                    || id == request.obsolete_subscription.subscription_id
            )
        })
        .any(|item| item.created_at != item.updated_at)
        || snapshot
            .distributions
            .iter()
            .filter(|item| item.subscription_id == request.obsolete_subscription.subscription_id)
            .any(|item| {
                retained_issues.contains(&item.issue)
                    || !retained.includes(item.issue).unwrap_or(false)
            })
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(())
}

fn validate_duplicate_relations(
    snapshot: &StateSnapshot,
    request: &ConfirmedLegacySubscriptionConsolidation,
) -> Result<(), ApplicationError> {
    let checks = snapshot
        .check_items
        .iter()
        .filter(|item| item.person_id.as_deref() == Some(request.duplicate_person_id.as_str()))
        .collect::<Vec<_>>();
    if checks.len() != 1
        || checks[0].content != START_CHECK_CONTENT
        || checks[0].status != CheckItemStatus::NeedsCheck
        || checks[0].checked_at.is_some()
        || checks[0].created_at != checks[0].updated_at
        || snapshot
            .purchases
            .iter()
            .any(|item| item.person_id.as_deref() == Some(request.duplicate_person_id.as_str()))
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(())
}

fn merge_person_note(
    snapshot: &mut StateSnapshot,
    canonical_id: &str,
    duplicate_id: &str,
    now: &str,
) -> Result<(), ApplicationError> {
    let incoming = snapshot
        .people
        .iter()
        .find(|item| item.id == duplicate_id)
        .and_then(|item| item.person_note.clone());
    let canonical = snapshot
        .people
        .iter_mut()
        .find(|item| item.id == canonical_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    if let Some(incoming) = incoming.filter(|value| !value.trim().is_empty()) {
        match &mut canonical.person_note {
            Some(current) if !current.contains(&incoming) => {
                current.push_str(" / ");
                current.push_str(&incoming);
            }
            None => canonical.person_note = Some(incoming),
            _ => {}
        }
    }
    canonical.updated_at = now.into();
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_change<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    ids: &I,
    operator_name: &str,
    now: &str,
    action_type: &str,
    entity_type: &str,
    entity_id: &str,
    summary: &str,
) {
    snapshot.changes.push(ChangeLog {
        id: ids.next_id(),
        occurred_at: now.into(),
        operator_name: operator_name.into(),
        action_type: action_type.into(),
        entity_type: entity_type.into(),
        entity_id: entity_id.into(),
        summary: summary.into(),
        before_json: None,
        after_json: None,
    });
}
