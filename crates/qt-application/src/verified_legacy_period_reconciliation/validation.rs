use std::collections::HashSet;

use qt_domain::{
    CheckItemStatus, Issue, Subscription, SubscriptionSource, normalize_phone,
    normalize_search_text,
};

use crate::{ApplicationError, StateSnapshot};

use super::{LegacyRenewalMerge, LegacySubscriptionExpectation, START_CHECK_CONTENT};

pub(super) fn expected_subscription<'a>(
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
        || subscription.source != SubscriptionSource::LegacyXlsx
        || subscription.source_reference.as_deref()
            != Some(expected.expected_source_reference.as_str())
        || subscription.issue_count != 6
        || subscription.archived_at.is_some()
        || subscription.created_at != subscription.updated_at
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(subscription)
}

pub(super) fn validate_people(
    snapshot: &StateSnapshot,
    request: &LegacyRenewalMerge,
    duplicate_ids: &HashSet<&str>,
) -> Result<(), ApplicationError> {
    let canonical = snapshot
        .people
        .iter()
        .find(|person| person.id == request.canonical_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let expected_name = base_name(&request.verified_profile.name);
    if !person_is_untouched_or_identity_normalized(snapshot, canonical)
        || base_name(&canonical.name) != expected_name
        || canonical
            .cohort
            .as_ref()
            .zip(request.verified_profile.cohort.as_ref())
            .is_some_and(|(left, right)| left != right)
        || request.verified_profile.normalized_phone
            != request
                .verified_profile
                .phone
                .as_deref()
                .map(normalize_phone)
                .filter(|value| !value.is_empty())
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let duplicates = snapshot
        .people
        .iter()
        .filter(|person| duplicate_ids.contains(person.id.as_str()))
        .collect::<Vec<_>>();
    if duplicates.len() != duplicate_ids.len()
        || duplicates.iter().any(|person| {
            !person_is_untouched_or_identity_normalized(snapshot, person)
                || base_name(&person.name) != expected_name
                || person
                    .cohort
                    .as_ref()
                    .zip(request.verified_profile.cohort.as_ref())
                    .is_some_and(|(left, right)| left != right)
        })
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(())
}

fn person_is_untouched_or_identity_normalized(
    snapshot: &StateSnapshot,
    person: &qt_domain::Person,
) -> bool {
    if person.created_at == person.updated_at {
        return true;
    }
    let later_changes = snapshot
        .changes
        .iter()
        .filter(|change| {
            change.entity_type == "person"
                && change.entity_id == person.id
                && change.action_type != "legacy_2026_migrated"
        })
        .collect::<Vec<_>>();
    later_changes.len() == 1
        && later_changes[0].action_type == "identity_normalized"
        && later_changes[0].occurred_at == person.updated_at
        && later_changes[0].before_json.is_none()
        && later_changes[0].after_json.is_none()
}

fn base_name(value: &str) -> String {
    let normalized = normalize_search_text(value);
    normalized
        .strip_suffix("(추가)")
        .unwrap_or(&normalized)
        .to_string()
}

pub(super) fn distributions_fit(
    snapshot: &StateSnapshot,
    subscription_ids: &[&str],
    start: Issue,
) -> bool {
    snapshot
        .distributions
        .iter()
        .filter(|item| subscription_ids.contains(&item.subscription_id.as_str()))
        .all(|item| {
            item.created_at == item.updated_at
                && (0..6).any(|offset| start.advance(offset) == item.issue)
        })
}

pub(super) fn distribution_issues(
    snapshot: &StateSnapshot,
    subscription_ids: &[&str],
) -> HashSet<Issue> {
    snapshot
        .distributions
        .iter()
        .filter(|item| subscription_ids.contains(&item.subscription_id.as_str()))
        .map(|item| item.issue)
        .collect()
}

pub(super) fn validate_start_checks(
    snapshot: &StateSnapshot,
    person_ids: &[&str],
) -> Result<(), ApplicationError> {
    if snapshot.check_items.iter().any(|item| {
        item.person_id
            .as_deref()
            .is_some_and(|id| person_ids.contains(&id))
            && item.content == START_CHECK_CONTENT
            && (item.status != CheckItemStatus::NeedsCheck
                || item.checked_at.is_some()
                || item.created_at != item.updated_at)
    }) {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    Ok(())
}
