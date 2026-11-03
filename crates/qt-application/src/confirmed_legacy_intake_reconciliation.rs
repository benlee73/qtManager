use qt_domain::{
    ChangeLog, CheckItemStatus, OneTimePurchase, Subscription, SubscriptionSource,
    normalize_search_text,
};

use crate::{ApplicationError, IdGenerator, LegacySubscriptionExpectation, StateSnapshot};

const START_CHECK_CONTENT: &str = "구독 시작 호 확인";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfirmedAnnualIntake {
    pub subscription: LegacySubscriptionExpectation,
    pub canonical_person_id: Option<String>,
    pub confirmed_quantity: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfirmedOneTimeIntake {
    pub subscription: LegacySubscriptionExpectation,
    pub canonical_person_id: Option<String>,
    pub issue: qt_domain::Issue,
    pub confirmed_quantity: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConfirmedLegacyIntakeCorrection {
    Annual(ConfirmedAnnualIntake),
    OneTime(ConfirmedOneTimeIntake),
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ConfirmedLegacyIntakeReconciliationResult {
    pub confirmed_annual_subscriptions: usize,
    pub converted_one_time_purchases: usize,
    pub removed_subscriptions: usize,
    pub removed_people: usize,
    pub removed_start_checks: usize,
}

pub fn reconcile_confirmed_legacy_intakes<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    corrections: &[ConfirmedLegacyIntakeCorrection],
    operator_name: &str,
    now: &str,
    ids: &I,
) -> Result<ConfirmedLegacyIntakeReconciliationResult, ApplicationError> {
    let mut candidate = snapshot.clone();
    let mut result = ConfirmedLegacyIntakeReconciliationResult::default();
    for correction in corrections {
        match correction {
            ConfirmedLegacyIntakeCorrection::Annual(request) => {
                apply_annual(
                    &mut candidate,
                    request,
                    operator_name,
                    now,
                    ids,
                    &mut result,
                )?;
            }
            ConfirmedLegacyIntakeCorrection::OneTime(request) => {
                apply_one_time(
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

fn apply_annual<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &ConfirmedAnnualIntake,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut ConfirmedLegacyIntakeReconciliationResult,
) -> Result<(), ApplicationError> {
    let subscription = expected_subscription(snapshot, &request.subscription)?;
    if request.confirmed_quantity == 0 || subscription.quantity != request.confirmed_quantity {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    validate_owner(
        snapshot,
        &request.subscription,
        request.canonical_person_id.as_deref(),
    )?;
    remove_exact_start_warning(snapshot, &request.subscription.owner_person_id, result)?;

    if let Some(canonical_id) = request.canonical_person_id.as_deref() {
        merge_person_note(
            snapshot,
            canonical_id,
            &request.subscription.owner_person_id,
            now,
        )?;
        snapshot
            .subscriptions
            .iter_mut()
            .find(|item| item.id == request.subscription.subscription_id)
            .ok_or(ApplicationError::UnsafeLegacyReconciliation)
            .map(|item| {
                item.person_id = canonical_id.into();
                item.updated_at = now.into();
            })?;
        remove_duplicate_person(snapshot, &request.subscription.owner_person_id, result);
        add_change(
            snapshot,
            ids,
            operator_name,
            now,
            "legacy_confirmed_person_reconciled",
            "person",
            canonical_id,
            "사용자 확인을 근거로 기존 신청자와 현장 신청을 통합",
        );
    }
    result.confirmed_annual_subscriptions += 1;
    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_annual_intake_confirmed",
        "subscription",
        &request.subscription.subscription_id,
        "사용자 확인을 근거로 연간 구독 확정",
    );
    Ok(())
}

fn apply_one_time<I: IdGenerator>(
    snapshot: &mut StateSnapshot,
    request: &ConfirmedOneTimeIntake,
    operator_name: &str,
    now: &str,
    ids: &I,
    result: &mut ConfirmedLegacyIntakeReconciliationResult,
) -> Result<(), ApplicationError> {
    let subscription = expected_subscription(snapshot, &request.subscription)?;
    if request.confirmed_quantity == 0
        || subscription.quantity != request.confirmed_quantity
        || subscription.start_issue != request.issue
        || snapshot
            .distributions
            .iter()
            .any(|item| item.subscription_id == subscription.id)
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let purchased_at = subscription.created_at.clone();
    validate_owner(
        snapshot,
        &request.subscription,
        request.canonical_person_id.as_deref(),
    )?;
    remove_exact_start_warning(snapshot, &request.subscription.owner_person_id, result)?;

    let purchase_owner = request
        .canonical_person_id
        .as_deref()
        .unwrap_or(&request.subscription.owner_person_id)
        .to_owned();
    if let Some(canonical_id) = request.canonical_person_id.as_deref() {
        merge_person_note(
            snapshot,
            canonical_id,
            &request.subscription.owner_person_id,
            now,
        )?;
    }
    snapshot
        .subscriptions
        .retain(|item| item.id != request.subscription.subscription_id);
    result.removed_subscriptions += 1;
    if let Some(canonical_id) = request.canonical_person_id.as_deref() {
        remove_duplicate_person(snapshot, &request.subscription.owner_person_id, result);
        add_change(
            snapshot,
            ids,
            operator_name,
            now,
            "legacy_confirmed_person_reconciled",
            "person",
            canonical_id,
            "사용자 확인을 근거로 기존 신청자와 현장 신청을 통합",
        );
    }

    let purchase_id = ids.next_id();
    snapshot.purchases.push(OneTimePurchase {
        delivery_records: None,
        correction_of: None,
        payment_status: None,
        is_group_distribution: false,
        id: purchase_id.clone(),
        person_id: Some(purchase_owner),
        buyer_name: None,
        issue: request.issue,
        quantity: request.confirmed_quantity,
        purchased_at,
        note: Some("2026년 기존 자료 사용자 확인 개별 구매 전환".into()),
        reversal_of: None,
        created_at: now.into(),
        updated_at: now.into(),
    });
    result.converted_one_time_purchases += 1;
    add_change(
        snapshot,
        ids,
        operator_name,
        now,
        "legacy_one_time_intake_reclassified",
        "one_time_purchase",
        &purchase_id,
        "사용자 확인을 근거로 현장 개별 구매 전환",
    );
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

fn validate_owner(
    snapshot: &StateSnapshot,
    subscription: &LegacySubscriptionExpectation,
    canonical_person_id: Option<&str>,
) -> Result<(), ApplicationError> {
    let owner = snapshot
        .people
        .iter()
        .find(|item| item.id == subscription.owner_person_id)
        .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
    if owner.created_at != owner.updated_at {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let owner_subscriptions = snapshot
        .subscriptions
        .iter()
        .filter(|item| item.person_id == owner.id)
        .count();
    if canonical_person_id.is_some() && owner_subscriptions != 1 {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    let owner_checks = snapshot
        .check_items
        .iter()
        .filter(|item| item.person_id.as_deref() == Some(owner.id.as_str()))
        .collect::<Vec<_>>();
    if owner_checks.len() != 1
        || owner_checks[0].content != START_CHECK_CONTENT
        || owner_checks[0].status != CheckItemStatus::NeedsCheck
        || owner_checks[0].checked_at.is_some()
        || owner_checks[0].created_at != owner_checks[0].updated_at
        || snapshot
            .purchases
            .iter()
            .any(|item| item.person_id.as_deref() == Some(owner.id.as_str()))
    {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }

    if let Some(canonical_id) = canonical_person_id {
        let canonical = snapshot
            .people
            .iter()
            .find(|item| item.id == canonical_id)
            .ok_or(ApplicationError::UnsafeLegacyReconciliation)?;
        if canonical.id == owner.id
            || normalize_search_text(&canonical.name) != normalize_search_text(&owner.name)
            || snapshot.subscriptions.iter().any(|item| {
                item.person_id == canonical.id
                    && item.archived_at.is_none()
                    && item.start_issue == subscription.expected_start
                    && item.quantity
                        == snapshot
                            .subscriptions
                            .iter()
                            .find(|candidate| candidate.id == subscription.subscription_id)
                            .map_or(0, |candidate| candidate.quantity)
            })
        {
            return Err(ApplicationError::UnsafeLegacyReconciliation);
        }
    }
    Ok(())
}

fn remove_exact_start_warning(
    snapshot: &mut StateSnapshot,
    person_id: &str,
    result: &mut ConfirmedLegacyIntakeReconciliationResult,
) -> Result<(), ApplicationError> {
    let before = snapshot.check_items.len();
    snapshot.check_items.retain(|item| {
        !(item.person_id.as_deref() == Some(person_id) && item.content == START_CHECK_CONTENT)
    });
    if before - snapshot.check_items.len() != 1 {
        return Err(ApplicationError::UnsafeLegacyReconciliation);
    }
    result.removed_start_checks += 1;
    Ok(())
}

fn remove_duplicate_person(
    snapshot: &mut StateSnapshot,
    person_id: &str,
    result: &mut ConfirmedLegacyIntakeReconciliationResult,
) {
    snapshot.people.retain(|item| item.id != person_id);
    result.removed_people += 1;
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
        canonical.updated_at = now.into();
    }
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
