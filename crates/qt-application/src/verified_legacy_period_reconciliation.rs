use std::collections::HashSet;

use qt_domain::{ChangeLog, Issue};

use crate::{ApplicationError, IdGenerator, StateSnapshot};

mod validation;

use validation::{
    distribution_issues, distributions_fit, expected_subscription, validate_people,
    validate_start_checks,
};

const START_CHECK_CONTENT: &str = "구독 시작 호 확인";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacySubscriptionExpectation {
    pub subscription_id: String,
    pub owner_person_id: String,
    pub expected_start: Issue,
    pub expected_source_reference: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyPeriodShift {
    pub subscription: LegacySubscriptionExpectation,
    pub corrected_start: Issue,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedLegacyProfile {
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub normalized_phone: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyRenewalMerge {
    pub canonical_person_id: String,
    pub duplicate_person_ids: Vec<String>,
    pub retained_subscription: LegacySubscriptionExpectation,
    pub obsolete_subscriptions: Vec<LegacySubscriptionExpectation>,
    pub corrected_start: Issue,
    pub verified_profile: VerifiedLegacyProfile,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyPeriodCorrection {
    Shift(LegacyPeriodShift),
    Merge(LegacyRenewalMerge),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LegacyPeriodReconciliationResult {
    pub shifted_subscriptions: usize,
    pub removed_subscriptions: usize,
    pub removed_people: usize,
    pub moved_distributions: usize,
    pub removed_start_checks: usize,
}

pub fn reconcile_verified_legacy_periods<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    corrections: &[LegacyPeriodCorrection],
    operator_name: &str,
    now: &str,
    ids: &I,
) -> Result<LegacyPeriodReconciliationResult, ApplicationError> {
    let mut candidate = snapshot.clone();
    let mut result = LegacyPeriodReconciliationResult::default();
    for correction in corrections {
        match correction {
            LegacyPeriodCorrection::Shift(request) => {
                apply_shift(
                    &mut candidate,
                    request,
                    operator_name,
                    now,
                    ids,
                    &mut result,
                )?;
            }
            LegacyPeriodCorrection::Merge(request) => {
                apply_merge(
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

fn apply_shift<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &LegacyPeriodShift,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut LegacyPeriodReconciliationResult,
) -> Result<(), ApplicationError> {
    let subscription = expected_subscription(snapshot, &request.subscription)?;
    if request.corrected_start.advance(1) != request.subscription.expected_start
        || snapshot.subscriptions.iter().any(|item| {
            item.id != subscription.id
                && item.person_id == subscription.person_id
                && item.archived_at.is_none()
                && item.start_issue == request.corrected_start
                && item.issue_count == subscription.issue_count
                && item.quantity == subscription.quantity
        })
        || !distributions_fit(
            snapshot,
            &[subscription.id.as_str()],
            request.corrected_start,
        )
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    validate_start_checks(snapshot, &[request.subscription.owner_person_id.as_str()])?;

    let subscription = snapshot
        .subscriptions
        .iter_mut()
        .find(|item| item.id == request.subscription.subscription_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    subscription.start_issue = request.corrected_start;
    subscription.updated_at = now.into();
    result.shifted_subscriptions += 1;
    result.removed_start_checks +=
        remove_start_checks(snapshot, &[request.subscription.owner_person_id.as_str()]);
    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_subscription_period_corrected",
        "subscription",
        &request.subscription.subscription_id,
        "원본 기간 검증 후 구독 시작 호 교정",
    );
    Ok(())
}

fn apply_merge<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &LegacyRenewalMerge,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut LegacyPeriodReconciliationResult,
) -> Result<(), ApplicationError> {
    let duplicate_ids = request
        .duplicate_person_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if duplicate_ids.is_empty()
        || duplicate_ids.len() != request.duplicate_person_ids.len()
        || duplicate_ids.contains(request.canonical_person_id.as_str())
        || request.obsolete_subscriptions.is_empty()
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    validate_people(snapshot, request, &duplicate_ids)?;

    let retained = expected_subscription(snapshot, &request.retained_subscription)?;
    if retained.start_issue != request.corrected_start {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let obsolete = request
        .obsolete_subscriptions
        .iter()
        .map(|expected| expected_subscription(snapshot, expected))
        .collect::<Result<Vec<_>, _>>()?;
    if obsolete.iter().any(|item| {
        item.start_issue != request.corrected_start.advance(1)
            || item.issue_count != retained.issue_count
            || item.quantity != retained.quantity
    }) {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let retained_id = retained.id.clone();
    let retained_quantity = retained.quantity;
    let allowed_subscription_ids =
        std::iter::once(request.retained_subscription.subscription_id.as_str())
            .chain(
                request
                    .obsolete_subscriptions
                    .iter()
                    .map(|item| item.subscription_id.as_str()),
            )
            .collect::<HashSet<_>>();
    if snapshot.subscriptions.iter().any(|item| {
        duplicate_ids.contains(item.person_id.as_str())
            && !allowed_subscription_ids.contains(item.id.as_str())
    }) || snapshot.subscriptions.iter().any(|item| {
        item.person_id == request.canonical_person_id
            && item.id != retained_id
            && !allowed_subscription_ids.contains(item.id.as_str())
            && item.archived_at.is_none()
            && item.start_issue == request.corrected_start
            && item.issue_count == 6
            && item.quantity == retained_quantity
    }) {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    let obsolete_ids = request
        .obsolete_subscriptions
        .iter()
        .map(|item| item.subscription_id.as_str())
        .collect::<Vec<_>>();
    if !distributions_fit(snapshot, &[retained_id.as_str()], request.corrected_start)
        || !distributions_fit(snapshot, &obsolete_ids, request.corrected_start)
        || distribution_issues(snapshot, &[retained_id.as_str()])
            .intersection(&distribution_issues(snapshot, &obsolete_ids))
            .next()
            .is_some()
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let involved_people = std::iter::once(request.canonical_person_id.as_str())
        .chain(duplicate_ids.iter().copied())
        .collect::<Vec<_>>();
    validate_start_checks(snapshot, &involved_people)?;

    let canonical_index = snapshot
        .people
        .iter()
        .position(|person| person.id == request.canonical_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    let notes = snapshot
        .people
        .iter()
        .filter(|person| duplicate_ids.contains(person.id.as_str()))
        .filter_map(|person| person.person_note.clone())
        .collect::<Vec<_>>();
    for note in notes {
        merge_note(
            &mut snapshot.people[canonical_index].person_note,
            Some(note),
        );
    }
    let canonical = &mut snapshot.people[canonical_index];
    canonical.name = request.verified_profile.name.clone();
    canonical.cohort = request.verified_profile.cohort.clone();
    canonical.phone = request.verified_profile.phone.clone();
    canonical.normalized_phone = request.verified_profile.normalized_phone.clone();
    canonical.updated_at = now.into();

    let retained = snapshot
        .subscriptions
        .iter_mut()
        .find(|item| item.id == retained_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    retained.person_id = request.canonical_person_id.clone();
    retained.updated_at = now.into();

    for distribution in &mut snapshot.distributions {
        if obsolete_ids.contains(&distribution.subscription_id.as_str()) {
            distribution.subscription_id = retained_id.clone();
            distribution.updated_at = now.into();
            result.moved_distributions += 1;
        }
    }
    let before_subscriptions = snapshot.subscriptions.len();
    snapshot
        .subscriptions
        .retain(|item| !obsolete_ids.contains(&item.id.as_str()));
    result.removed_subscriptions += before_subscriptions - snapshot.subscriptions.len();

    result.removed_start_checks += remove_start_checks(snapshot, &involved_people);
    for item in &mut snapshot.check_items {
        if item
            .person_id
            .as_deref()
            .is_some_and(|id| duplicate_ids.contains(id))
        {
            item.person_id = Some(request.canonical_person_id.clone());
            item.updated_at = now.into();
        }
    }
    for purchase in &mut snapshot.purchases {
        if purchase
            .person_id
            .as_deref()
            .is_some_and(|id| duplicate_ids.contains(id))
        {
            purchase.person_id = Some(request.canonical_person_id.clone());
            purchase.updated_at = now.into();
        }
    }
    let before_people = snapshot.people.len();
    snapshot
        .people
        .retain(|person| !duplicate_ids.contains(person.id.as_str()));
    result.removed_people += before_people - snapshot.people.len();

    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_people_reconciled",
        "person",
        &request.canonical_person_id,
        "원본 행 검증 후 중복 신청자 통합",
    );
    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_renewal_reconciled",
        "subscription",
        &retained_id,
        "원본 기간 검증 후 갱신 구독 통합",
    );
    Ok(())
}

fn remove_start_checks(snapshot: &mut StateSnapshot, person_ids: &[&str]) -> usize {
    let before = snapshot.check_items.len();
    snapshot.check_items.retain(|item| {
        !(item
            .person_id
            .as_deref()
            .is_some_and(|id| person_ids.contains(&id))
            && item.content == START_CHECK_CONTENT)
    });
    before - snapshot.check_items.len()
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
