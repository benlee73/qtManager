//! Explicit corrections and atomic registration keep actual delivery history auditable.
use crate::{
    ApplicationError, Clock, CoreRepository, IdGenerator, PeopleManagementRepository, PortError,
    RuntimeServices,
};
use qt_domain::{
    ChangeLog, Distribution, Issue, OneTimePurchase, PaymentStatus, Person, PersonStatus,
    Subscription, SubscriptionSource, format_phone, normalize_phone,
};
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct OperationBatch {
    pub people: Vec<Person>,
    pub subscriptions: Vec<Subscription>,
    pub distributions: Vec<Distribution>,
    pub purchases: Vec<OneTimePurchase>,
    pub changes: Vec<ChangeLog>,
    pub expected_person: Option<Person>,
    pub expected_subscription: Option<Subscription>,
    pub expected_purchase: Option<OneTimePurchase>,
    pub expected_distribution: Option<Distribution>,
    pub confirmed_memos: Option<(String, Vec<String>)>,
}
pub trait OperationsRepository: CoreRepository + PeopleManagementRepository {
    fn save_operation(&mut self, batch: &OperationBatch) -> Result<(), PortError>;
}
fn reject(message: &str) -> ApplicationError {
    PortError::new(message).into()
}
fn json(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("domain records serialize")
}
fn clean(value: Option<String>) -> Option<String> {
    value.and_then(|v| (!v.trim().is_empty()).then(|| v.trim().to_owned()))
}
fn validate_changed_date(value: Option<&str>) -> Result<(), ApplicationError> {
    if let Some(value) = value.filter(|v| !v.is_empty()) {
        let day = value
            .get(..10)
            .ok_or_else(|| reject("날짜는 YYYY-MM-DD 형식으로 입력하세요."))?;
        crate::issue_containing_date(day)
            .map_err(|_| reject("올바른 날짜를 입력하세요. 예: 2026-11-01"))?;
        if value.len() != 10
            && time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                .is_err()
        {
            return Err(reject(
                "날짜는 YYYY-MM-DD 또는 시간대가 포함된 시각으로 입력하세요.",
            ));
        }
    }
    Ok(())
}
fn operator<R: PeopleManagementRepository>(repo: &R) -> Result<String, ApplicationError> {
    repo.current_operator()?
        .filter(|v| !v.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)
}
fn change<C: Clock, I: IdGenerator>(
    runtime: &RuntimeServices<C, I>,
    operator: &str,
    action: &str,
    kind: &str,
    id: &str,
    before: Option<String>,
    after: Option<String>,
) -> ChangeLog {
    ChangeLog {
        id: runtime.ids.next_id(),
        occurred_at: runtime.clock.now(),
        operator_name: operator.into(),
        action_type: action.into(),
        entity_type: kind.into(),
        entity_id: id.into(),
        summary: match action {
            "subscription_corrected" => "구독 내용 정정",
            "purchase_corrected" => "1달 구독 정정·배부 기록 보존",
            "distribution_recorded" => "구독 신청과 함께 배부",
            "person_created" => "현장 신청자 등록",
            _ => "연간 구독 추가",
        }
        .into(),
        before_json: before,
        after_json: after,
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualIntakeRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    pub person_id: Option<String>,
    pub name: String,
    pub cohort: Option<String>,
    #[serde(default)]
    pub cohort_not_applicable: bool,
    pub phone: Option<String>,
    pub issue_year: i32,
    pub issue_month: u8,
    pub desk_year: i32,
    pub desk_month: u8,
    pub quantity: u32,
    pub memo: Option<String>,
    #[serde(default)]
    pub applied_at: Option<String>,
    #[serde(default)]
    pub confirm_overlap: bool,
    #[serde(default)]
    pub distribute: bool,
    #[serde(default)]
    pub confirmed_memo_revisions: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualIntakeResult {
    pub person_id: String,
    pub subscription_id: String,
    pub distributed: bool,
}
pub fn annual_intake<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: AnnualIntakeRequest,
) -> Result<AnnualIntakeResult, ApplicationError> {
    repo.migrate_core()?;
    let operator = operator(repo)?;
    let now = runtime.clock.now();
    validate_changed_date(request.applied_at.as_deref())?;
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    let desk = Issue::new(request.desk_year, request.desk_month)?;
    if request.distribute && issue != desk {
        return Err(reject(
            "시작 호가 현재 배부 호와 다르면 신청만 저장할 수 있습니다.",
        ));
    }
    let record = request
        .person_id
        .as_deref()
        .map(|id| repo.load_person(id))
        .transpose()?
        .flatten();
    if request.person_id.is_some() && record.is_none() {
        return Err(ApplicationError::MissingDeskRecord);
    }
    let mut batch = OperationBatch::default();
    let person = if let Some(record) = &record {
        if record.person.status == PersonStatus::Archived || record.person.is_group {
            return Err(reject(
                "보관된 신청자나 군지체에는 이 방식으로 구독을 추가할 수 없습니다.",
            ));
        }
        batch.expected_person = Some(record.person.clone());
        record.person.clone()
    } else {
        let phone = format_phone(request.phone.as_deref().unwrap_or_default())?;
        let person = Person {
            id: runtime.ids.next_id(),
            name: request.name.trim().into(),
            cohort: if request.cohort_not_applicable {
                None
            } else {
                clean(request.cohort)
            },
            cohort_not_applicable: request.cohort_not_applicable,
            phone: phone.clone(),
            normalized_phone: phone.as_deref().map(normalize_phone),
            status: PersonStatus::Active,
            is_group: false,
            person_note: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        person.validate()?;
        if person.needs_profile_completion() {
            return Err(qt_domain::DomainError::AnnualCohortRequired.into());
        }
        batch.people.push(person.clone());
        batch.changes.push(change(
            runtime,
            &operator,
            "person_created",
            "person",
            &person.id,
            None,
            Some(json(&person)),
        ));
        person
    };
    let subscription = Subscription {
        id: request
            .request_id
            .as_ref()
            .map(|id| format!("annual-intake-{id}"))
            .unwrap_or_else(|| runtime.ids.next_id()),
        person_id: person.id.clone(),
        start_issue: issue,
        issue_count: 6,
        quantity: request.quantity,
        applied_at: clean(request.applied_at).or_else(|| Some(now.clone())),
        source: SubscriptionSource::OnSite,
        source_reference: None,
        memo: clean(request.memo),
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
        payment_status: Some(PaymentStatus::Pending),
    };
    subscription.validate()?;
    if let Some(record) = &record {
        for previous in &record.subscriptions {
            if previous.overlaps(&subscription)? && !request.confirm_overlap {
                return Err(ApplicationError::OverlappingSubscriptionConfirmationRequired);
            }
        }
    }
    if request.distribute {
        let mut ids: Vec<_> = repo
            .list_person_memos(&person.id)?
            .into_iter()
            .filter(|m| m.is_active())
            .map(|m| format!("{}:{}", m.id, m.updated_at))
            .collect();
        ids.sort();
        let mut confirmed = request.confirmed_memo_revisions;
        confirmed.sort();
        confirmed.dedup();
        if ids != confirmed {
            return Err(reject("활성 메모를 다시 확인한 뒤 배부하세요."));
        }
        batch.confirmed_memos = Some((person.id.clone(), ids));
        let distribution = Distribution {
            id: runtime.ids.next_id(),
            subscription_id: subscription.id.clone(),
            issue,
            quantity: subscription.quantity,
            distributed_at: now.clone(),
            note: None,
            reversal_of: None,
            created_at: now.clone(),
            updated_at: now,
        };
        distribution.validate()?;
        batch.changes.push(change(
            runtime,
            &operator,
            "distribution_recorded",
            "distribution",
            &distribution.id,
            None,
            Some(json(&distribution)),
        ));
        batch.distributions.push(distribution);
    }
    batch.changes.push(change(
        runtime,
        &operator,
        "subscription_created",
        "subscription",
        &subscription.id,
        None,
        Some(json(&subscription)),
    ));
    let result = AnnualIntakeResult {
        person_id: person.id,
        subscription_id: subscription.id.clone(),
        distributed: request.distribute,
    };
    batch.subscriptions.push(subscription);
    repo.save_operation(&batch)?;
    Ok(result)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectSubscriptionRequest {
    pub person_id: String,
    pub subscription_id: String,
    pub expected_revision: String,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub applied_at: Option<String>,
    pub memo: Option<String>,
    #[serde(default)]
    pub confirm_conflicts: bool,
}
fn edited_subscription<R: OperationsRepository>(
    repo: &R,
    request: &CorrectSubscriptionRequest,
) -> Result<(Subscription, Subscription, Vec<String>), ApplicationError> {
    let record = repo
        .load_person(&request.person_id)?
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let original = record
        .subscriptions
        .into_iter()
        .find(|s| s.id == request.subscription_id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    if json(&original) != request.expected_revision {
        return Err(reject(
            "다른 변경이 반영되었습니다. 이력을 다시 열어 수정하세요.",
        ));
    }
    let mut edited = original.clone();
    edited.start_issue = Issue::new(request.issue_year, request.issue_month)?;
    edited.quantity = request.quantity;
    if request.applied_at != original.applied_at {
        validate_changed_date(request.applied_at.as_deref())?;
    }
    // A reduced correction form returns hidden metadata unchanged, including
    // historical formatting imported from older workbooks.
    if request.applied_at != original.applied_at {
        edited.applied_at = clean(request.applied_at.clone());
    }
    if request.memo != original.memo {
        edited.memo = clean(request.memo.clone());
    }
    edited.validate()?;
    let conflicts = subscription_delivery_conflicts(&edited, &record.distributions)?;
    Ok((original, edited, conflicts))
}
pub(crate) fn subscription_delivery_conflicts(
    edited: &Subscription,
    distributions: &[Distribution],
) -> Result<Vec<String>, ApplicationError> {
    let mut totals = std::collections::BTreeMap::<Issue, i64>::new();
    for d in distributions
        .iter()
        .filter(|d| d.subscription_id == edited.id)
    {
        *totals.entry(d.issue).or_default() += if d.reversal_of.is_some() {
            -i64::from(d.quantity)
        } else {
            i64::from(d.quantity)
        };
    }
    let mut conflicts = Vec::new();
    for (issue, quantity) in totals {
        if quantity > 0 && (!edited.includes(issue)? || quantity > i64::from(edited.quantity)) {
            conflicts.push(format!(
                "{}: 실제 {}권 배부 — 수정한 기간 또는 매 호 {}권과 불일치",
                issue.display_name(),
                quantity,
                edited.quantity
            ));
        }
    }
    Ok(conflicts)
}
pub fn preview_subscription_correction<R: OperationsRepository>(
    repo: &R,
    request: &CorrectSubscriptionRequest,
) -> Result<Vec<String>, ApplicationError> {
    Ok(edited_subscription(repo, request)?.2)
}
pub fn correct_subscription<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: CorrectSubscriptionRequest,
) -> Result<(), ApplicationError> {
    let operator = operator(repo)?;
    let (original, mut edited, conflicts) = edited_subscription(repo, &request)?;
    if !conflicts.is_empty() && !request.confirm_conflicts {
        return Err(reject("실제 배부와의 불일치를 확인하세요."));
    }
    edited.updated_at = runtime.clock.now();
    let mut batch = OperationBatch {
        expected_subscription: Some(original.clone()),
        ..Default::default()
    };
    batch.changes.push(change(
        runtime,
        &operator,
        "subscription_corrected",
        "subscription",
        &edited.id,
        Some(json(&original)),
        Some(json(&edited)),
    ));
    batch.subscriptions.push(edited);
    repo.save_operation(&batch)?;
    Ok(())
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectPurchaseRequest {
    #[serde(default)]
    pub confirm_conflicts: bool,
    pub person_id: String,
    pub purchase_id: String,
    pub expected_revision: String,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub purchased_at: String,
    pub note: Option<String>,
}
pub fn preview_purchase_correction<R: OperationsRepository>(
    repo: &R,
    request: &CorrectPurchaseRequest,
) -> Result<Vec<String>, ApplicationError> {
    let purchases = repo.list_person_purchases(&request.person_id)?;
    let original = purchases
        .iter()
        .find(|p| {
            p.id == request.purchase_id
                && p.reversal_of.is_none()
                && !p.is_group_distribution
                && !purchases
                    .iter()
                    .any(|r| r.reversal_of.as_deref() == Some(&p.id))
        })
        .ok_or(ApplicationError::MissingDeskRecord)?;
    if json(original) != request.expected_revision {
        return Err(reject(
            "다른 변경이 반영되었습니다. 이력을 다시 열어 수정하세요.",
        ));
    }
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    if request.quantity == 0 {
        return Err(qt_domain::DomainError::InvalidQuantity.into());
    }
    let records = original.deliveries();
    let valid = records
        .iter()
        .filter(|d| {
            d.reversal_of.is_none()
                && !records
                    .iter()
                    .any(|r| r.reversal_of.as_deref() == Some(&d.id))
        })
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    for d in valid.iter().filter(|d| d.issue != issue) {
        let warning = format!(
            "{}에 실제 배부한 {}권은 변경하지 않습니다.",
            d.issue.display_name(),
            d.quantity
        );
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }
    let delivered = valid
        .iter()
        .filter(|d| d.issue == issue)
        .map(|d| d.quantity)
        .sum::<u32>();
    if delivered > request.quantity {
        warnings.push(format!(
            "실제 배부 {delivered}권이 정정 수량 {}권보다 많습니다.",
            request.quantity
        ));
    }
    Ok(warnings)
}
pub fn correct_purchase<R: OperationsRepository, C: Clock, I: IdGenerator>(
    repo: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: CorrectPurchaseRequest,
) -> Result<(), ApplicationError> {
    let operator = operator(repo)?;
    let warnings = preview_purchase_correction(repo, &request)?;
    if !warnings.is_empty() && !request.confirm_conflicts {
        return Err(reject("배부 이력과 불일치합니다. 확인 후 정정하세요."));
    }
    let purchases = repo.list_person_purchases(&request.person_id)?;
    let original = purchases
        .iter()
        .find(|p| p.id == request.purchase_id)
        .ok_or(ApplicationError::MissingDeskRecord)?
        .clone();
    if original.reversal_of.is_some()
        || original.is_group_distribution
        || purchases
            .iter()
            .any(|p| p.reversal_of.as_deref() == Some(&original.id))
    {
        return Err(reject(
            "취소·정정 전 기록은 수정할 수 없습니다. 유효한 최신 기록을 선택하세요.",
        ));
    }
    if json(&original) != request.expected_revision {
        return Err(reject(
            "다른 변경이 반영되었습니다. 이력을 다시 열어 수정하세요.",
        ));
    }
    if request.purchased_at != original.purchased_at {
        validate_changed_date(Some(&request.purchased_at))?;
    }
    let now = runtime.clock.now();
    let reversal = OneTimePurchase {
        id: runtime.ids.next_id(),
        reversal_of: Some(original.id.clone()),
        correction_of: None,
        payment_status: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        purchased_at: now.clone(),
        ..original.clone()
    };
    let edited = OneTimePurchase {
        delivery_records: Some(original.deliveries()),
        id: runtime.ids.next_id(),
        reversal_of: None,
        correction_of: Some(original.id.clone()),
        issue: Issue::new(request.issue_year, request.issue_month)?,
        quantity: request.quantity,
        purchased_at: request.purchased_at,
        note: if request.note == original.note {
            original.note.clone()
        } else {
            clean(request.note)
        },
        created_at: now.clone(),
        updated_at: now,
        ..original.clone()
    };
    edited.validate()?;
    reversal.validate()?;
    let mut batch = OperationBatch {
        expected_purchase: Some(original.clone()),
        ..Default::default()
    };
    batch.changes.push(change(
        runtime,
        &operator,
        "purchase_corrected",
        "one_time_purchase",
        &edited.id,
        Some(json(&original)),
        Some(json(&edited)),
    ));
    batch.purchases = vec![reversal, edited];
    repo.save_operation(&batch)?;
    Ok(())
}
