use std::collections::HashSet;

use qt_domain::{
    ChangeLog, CheckItemStatus, Issue, SubscriptionSource, normalize_phone, normalize_search_text,
};

use crate::{ApplicationError, IdGenerator, StateSnapshot};

const START_CHECK_CONTENT: &str = "구독 시작 호 확인";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyDuplicateRenewalRequest {
    pub canonical_person_id: String,
    pub duplicate_person_id: String,
    pub renewal_subscription_id: String,
    pub obsolete_subscription_id: String,
    pub expected_renewal_start: Issue,
    pub expected_renewal_source_reference: String,
    pub expected_obsolete_start: Issue,
    pub expected_obsolete_source_reference: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegacyDuplicateRenewalResult {
    pub moved_distributions: usize,
    pub removed_start_checks: usize,
}

pub fn reconcile_legacy_duplicate_renewal<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &LegacyDuplicateRenewalRequest,
    operator_name: &str,
    now: &str,
    ids: &I,
) -> Result<LegacyDuplicateRenewalResult, ApplicationError> {
    let mut candidate = snapshot.clone();
    let result = reconcile_inner(&mut candidate, request, operator_name, now, ids)?;
    *snapshot = candidate;
    Ok(result)
}

fn reconcile_inner<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &LegacyDuplicateRenewalRequest,
    operator_name: &str,
    now: &str,
    ids: &I,
) -> Result<LegacyDuplicateRenewalResult, ApplicationError> {
    if request.canonical_person_id == request.duplicate_person_id {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let canonical_index = snapshot
        .people
        .iter()
        .position(|person| person.id == request.canonical_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let duplicate_index = snapshot
        .people
        .iter()
        .position(|person| person.id == request.duplicate_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let canonical = &snapshot.people[canonical_index];
    let duplicate = &snapshot.people[duplicate_index];
    if canonical.created_at != canonical.updated_at
        || duplicate.created_at != duplicate.updated_at
        || normalize_search_text(&canonical.name) != normalize_search_text(&duplicate.name)
        || (duplicate.cohort.is_some() && duplicate.cohort != canonical.cohort)
        || !phones_compatible(canonical, duplicate)
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let renewal_index = snapshot
        .subscriptions
        .iter()
        .position(|item| item.id == request.renewal_subscription_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let obsolete_index = snapshot
        .subscriptions
        .iter()
        .position(|item| item.id == request.obsolete_subscription_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let renewal = &snapshot.subscriptions[renewal_index];
    let obsolete = &snapshot.subscriptions[obsolete_index];
    if renewal.person_id != request.duplicate_person_id
        || obsolete.person_id != request.canonical_person_id
        || renewal.source != SubscriptionSource::LegacyXlsx
        || obsolete.source != SubscriptionSource::LegacyXlsx
        || renewal.created_at != renewal.updated_at
        || obsolete.created_at != obsolete.updated_at
        || renewal.archived_at.is_some()
        || obsolete.archived_at.is_some()
        || renewal.issue_count != 6
        || obsolete.issue_count != 6
        || renewal.quantity != obsolete.quantity
        || renewal.start_issue != request.expected_renewal_start
        || renewal.source_reference.as_deref()
            != Some(request.expected_renewal_source_reference.as_str())
        || obsolete.start_issue != request.expected_obsolete_start
        || obsolete.source_reference.as_deref()
            != Some(request.expected_obsolete_source_reference.as_str())
        || obsolete.start_issue != renewal.start_issue.advance(1)
        || snapshot.subscriptions.iter().any(|item| {
            item.person_id == request.duplicate_person_id
                && item.id != request.renewal_subscription_id
        })
        || snapshot.subscriptions.iter().any(|item| {
            item.person_id == request.canonical_person_id
                && item.id != request.obsolete_subscription_id
                && item.archived_at.is_none()
                && item.start_issue == renewal.start_issue
                && item.issue_count == renewal.issue_count
                && item.quantity == renewal.quantity
        })
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let renewal_issues = snapshot
        .distributions
        .iter()
        .filter(|item| item.subscription_id == request.renewal_subscription_id)
        .map(|item| item.issue)
        .collect::<HashSet<_>>();
    let obsolete_distributions = snapshot
        .distributions
        .iter()
        .filter(|item| item.subscription_id == request.obsolete_subscription_id)
        .collect::<Vec<_>>();
    if obsolete_distributions.iter().any(|item| {
        item.created_at != item.updated_at
            || renewal_issues.contains(&item.issue)
            || !renewal.includes(item.issue).unwrap_or(false)
    }) || snapshot
        .distributions
        .iter()
        .filter(|item| item.subscription_id == request.renewal_subscription_id)
        .any(|item| item.created_at != item.updated_at)
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let start_checks = snapshot
        .check_items
        .iter()
        .filter(|item| {
            matches!(
                item.person_id.as_deref(),
                Some(id)
                    if id == request.canonical_person_id || id == request.duplicate_person_id
            ) && item.content == START_CHECK_CONTENT
        })
        .collect::<Vec<_>>();
    if start_checks.iter().any(|item| {
        item.status != CheckItemStatus::NeedsCheck
            || item.checked_at.is_some()
            || item.created_at != item.updated_at
    }) {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let duplicate_note = snapshot.people[duplicate_index].person_note.clone();
    merge_note(
        &mut snapshot.people[canonical_index].person_note,
        duplicate_note,
    );
    snapshot.people[canonical_index].updated_at = now.into();
    snapshot.subscriptions[renewal_index].person_id = request.canonical_person_id.clone();
    snapshot.subscriptions[renewal_index].updated_at = now.into();

    let mut moved_distributions = 0;
    for distribution in &mut snapshot.distributions {
        if distribution.subscription_id == request.obsolete_subscription_id {
            distribution.subscription_id = request.renewal_subscription_id.clone();
            distribution.updated_at = now.into();
            moved_distributions += 1;
        }
    }
    snapshot
        .subscriptions
        .retain(|item| item.id != request.obsolete_subscription_id);

    let before_checks = snapshot.check_items.len();
    snapshot.check_items.retain(|item| {
        !(matches!(
            item.person_id.as_deref(),
            Some(id) if id == request.canonical_person_id || id == request.duplicate_person_id
        ) && item.content == START_CHECK_CONTENT)
    });
    let removed_start_checks = before_checks - snapshot.check_items.len();
    for item in &mut snapshot.check_items {
        if item.person_id.as_deref() == Some(request.duplicate_person_id.as_str()) {
            item.person_id = Some(request.canonical_person_id.clone());
            item.updated_at = now.into();
        }
    }
    for purchase in &mut snapshot.purchases {
        if purchase.person_id.as_deref() == Some(request.duplicate_person_id.as_str()) {
            purchase.person_id = Some(request.canonical_person_id.clone());
            purchase.updated_at = now.into();
        }
    }
    snapshot
        .people
        .retain(|person| person.id != request.duplicate_person_id);

    for (action_type, entity_type, entity_id, summary) in [
        (
            "legacy_person_merged",
            "person",
            request.canonical_person_id.as_str(),
            "원본 행 검증 후 중복 신청자 통합",
        ),
        (
            "legacy_subscription_reconciled",
            "subscription",
            request.renewal_subscription_id.as_str(),
            "원본 기간 검증 후 갱신 구독 통합",
        ),
        (
            "legacy_start_checks_resolved",
            "check_item",
            request.canonical_person_id.as_str(),
            "원본 기간 검증 후 시작 호 확인 정리",
        ),
    ] {
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

    Ok(LegacyDuplicateRenewalResult {
        moved_distributions,
        removed_start_checks,
    })
}

fn phones_compatible(left: &qt_domain::Person, right: &qt_domain::Person) -> bool {
    let left = left
        .normalized_phone
        .clone()
        .unwrap_or_else(|| normalize_phone(left.phone.as_deref().unwrap_or_default()));
    let right = right
        .normalized_phone
        .clone()
        .unwrap_or_else(|| normalize_phone(right.phone.as_deref().unwrap_or_default()));
    left.is_empty() || right.is_empty() || left == right
}

fn merge_note(target: &mut Option<String>, incoming: Option<String>) {
    let Some(incoming) = incoming.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    match target {
        Some(current) if !current.contains(&incoming) => {
            current.push_str(" / ");
            current.push_str(&incoming);
        }
        None => *target = Some(incoming),
        _ => {}
    }
}
