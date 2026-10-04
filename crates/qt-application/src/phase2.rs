use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, DistributionStatus, Issue, Memo,
    MemoStatus, OneTimePurchase, Person, PersonStatus, PinnedNote, PinnedNoteStatus, Subscription,
    SubscriptionSource, SubscriptionStatus, assess_distribution, format_phone, plan_distribution,
};
use serde::{Deserialize, Serialize};

use crate::{ApplicationError, PortError};

pub trait Clock {
    fn now(&self) -> String;
    fn today(&self) -> String;
}

pub trait IdGenerator {
    fn next_id(&self) -> String;
}

pub struct RuntimeServices<'a, C, I> {
    pub clock: &'a C,
    pub ids: &'a I,
}

#[derive(Clone, Debug)]
pub struct DeskRecord {
    pub person: Person,
    pub subscriptions: Vec<Subscription>,
    pub distributions: Vec<Distribution>,
    pub has_memo: bool,
}

pub trait DistributionDeskRepository {
    fn migrate(&mut self) -> Result<(), PortError>;
    fn current_operator(&self) -> Result<Option<String>, PortError>;
    fn save_operator(&mut self, name: &str, now: &str) -> Result<(), PortError>;
    fn list_desk_records(&self, query: &str, issue: Issue) -> Result<Vec<DeskRecord>, PortError>;
    fn save_distribution(
        &mut self,
        distribution: &Distribution,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
    fn latest_reversible_distribution(
        &self,
        issue: Issue,
    ) -> Result<Option<Distribution>, PortError>;
    fn latest_reversible_distribution_for_subscription(
        &self,
        issue: Issue,
        subscription_id: &str,
    ) -> Result<Option<Distribution>, PortError> {
        Ok(self
            .latest_reversible_distribution(issue)?
            .filter(|item| item.subscription_id == subscription_id))
    }
    fn save_draft(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
    fn list_check_items(&self) -> Result<Vec<CheckItem>, PortError>;
    fn list_archived_check_items(&self) -> Result<Vec<CheckItem>, PortError> {
        Ok(Vec::new())
    }
    fn save_check_item(&mut self, item: &CheckItem, change: &ChangeLog) -> Result<(), PortError>;
    fn delete_check_item(&mut self, id: &str, change: &ChangeLog) -> Result<(), PortError>;
    fn list_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError>;
    fn list_archived_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError> {
        Ok(Vec::new())
    }
    fn save_pinned_note(&mut self, note: &PinnedNote, change: &ChangeLog) -> Result<(), PortError>;
    fn delete_pinned_note(&mut self, id: &str, change: &ChangeLog) -> Result<(), PortError>;
    /// 새 메모 API. 기존 확인할 일·고정 메모 포트는 구버전 데이터와 이전
    /// reconciliation을 읽기 위한 호환 경계로 남겨 둔다.
    fn list_memos(&self) -> Result<Vec<Memo>, PortError> {
        Ok(Vec::new())
    }
    fn list_archived_memos(&self) -> Result<Vec<Memo>, PortError> {
        Ok(Vec::new())
    }
    fn save_memo(&mut self, _memo: &Memo, _change: &ChangeLog) -> Result<(), PortError> {
        Err(PortError::new("메모 저장 포트가 구현되지 않았습니다."))
    }
    fn delete_memo(&mut self, _id: &str, _change: &ChangeLog) -> Result<(), PortError> {
        Err(PortError::new("메모 삭제 포트가 구현되지 않았습니다."))
    }
    fn save_purchase(
        &mut self,
        purchase: &OneTimePurchase,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
    /// 구매 전용 인원을 신청자와 구매 기록으로 함께 저장한다.
    /// 기존 어댑터는 이 선택적 기능을 구현하지 않으면 명시적 오류를 반환한다.
    fn save_person_and_purchase(
        &mut self,
        _person: &Person,
        _purchase: &OneTimePurchase,
        _changes: &[ChangeLog],
    ) -> Result<(), PortError> {
        Err(PortError::new(
            "개별 구매 인원 저장 포트가 구현되지 않았습니다.",
        ))
    }
    fn latest_reversible_purchase(
        &self,
        issue: Issue,
    ) -> Result<Option<OneTimePurchase>, PortError>;
    fn purchase_summary(&self, issue: Issue) -> Result<(u32, u32), PortError>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionDesk {
    pub selected_issue: IssueView,
    pub recommended_issue: IssueView,
    pub operator_name: Option<String>,
    pub totals: DeskTotals,
    pub people: Vec<DeskPerson>,
    pub check_items: Vec<CheckItemView>,
    pub pinned_notes: Vec<PinnedNoteView>,
    pub archived_check_items: Vec<CheckItemView>,
    pub archived_pinned_notes: Vec<PinnedNoteView>,
    pub memos: Vec<MemoView>,
    pub archived_memos: Vec<MemoView>,
    pub purchase_count: u32,
    pub purchased_quantity: u32,
    pub can_undo_distribution: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueView {
    pub year: i32,
    pub start_month: u8,
    pub label: String,
}

impl From<Issue> for IssueView {
    fn from(issue: Issue) -> Self {
        Self {
            year: issue.year,
            start_month: issue.start_month,
            label: issue.display_name(),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskTotals {
    pub target_people: u32,
    pub completed_people: u32,
    pub remaining_people: u32,
    pub target_quantity: u32,
    pub distributed_quantity: u32,
    pub remaining_quantity: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskPerson {
    pub person_id: String,
    pub subscription_id: Option<String>,
    pub distribution_targets: Vec<DistributionTargetView>,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub person_status: String,
    pub subscription_status: String,
    pub distribution_status: String,
    pub target_quantity: u32,
    pub distributed_quantity: u32,
    pub remaining_quantity: u32,
    pub last_issue: Option<String>,
    pub end_date: Option<String>,
    pub is_last_issue: bool,
    #[serde(rename = "hasMemo")]
    pub has_memo: bool,
    pub can_distribute: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionTargetView {
    pub subscription_id: String,
    pub start_issue: String,
    pub last_issue: String,
    pub end_date: String,
    pub target_quantity: u32,
    pub distributed_quantity: u32,
    pub remaining_quantity: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItemView {
    pub id: String,
    pub person_id: Option<String>,
    pub summary: String,
    pub operator_name: String,
    pub updated_at: String,
    pub status: String,
    pub person_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedNoteView {
    pub id: String,
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoView {
    pub id: String,
    pub person_id: Option<String>,
    pub content: String,
    pub operator_name: String,
    pub updated_at: String,
    pub status: String,
    pub person_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDistributionRequest {
    pub issue_year: i32,
    pub issue_month: u8,
    pub subscription_id: String,
    pub quantity: Option<u32>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoDistributionRequest {
    pub issue_year: i32,
    pub issue_month: u8,
    pub subscription_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoDistributionResult {
    pub subscription_id: String,
    pub quantity: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDraftRequest {
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckItemRequest {
    pub person_id: Option<String>,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoRequest {
    pub person_id: Option<String>,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoRequest {
    pub id: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoStatusRequest {
    pub id: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePinnedNoteRequest {
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckItemStatusRequest {
    pub id: String,
    pub status: CheckItemStatus,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckItemRequest {
    pub id: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePinnedNoteRequest {
    pub id: String,
    pub is_pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPurchaseRequest {
    pub person_id: Option<String>,
    pub buyer_name: Option<String>,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPurchasePersonRequest {
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub note: Option<String>,
}

/// Distribution is issue-specific. People whose subscription starts after the
/// selected issue ("예정") and people whose subscription does not cover it
/// ("대상 아님") must not be mixed into the handout queue or its totals.
fn is_distribution_candidate(person: &DeskPerson) -> bool {
    person.subscription_status != "대상 아님" && person.subscription_status != "예정"
}

pub fn load_distribution_desk<R: DistributionDeskRepository, C: Clock>(
    repository: &mut R,
    clock: &C,
    selected_issue: Issue,
    query: &str,
    show_all: bool,
) -> Result<DistributionDesk, ApplicationError> {
    repository.migrate()?;
    let all_records = repository.list_desk_records("", selected_issue)?;
    let all_people = all_records
        .into_iter()
        .map(|record| desk_person(record, selected_issue))
        .collect::<Result<Vec<_>, _>>()?;
    let person_names = all_people
        .iter()
        .map(|person| (person.person_id.clone(), person.name.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let eligible_people = all_people
        .iter()
        .filter(|person| is_distribution_candidate(person))
        .cloned()
        .collect::<Vec<_>>();
    let mut totals = DeskTotals::default();
    for person in &eligible_people {
        if person.subscription_status == "유효" {
            totals.target_people += 1;
            totals.target_quantity += person.target_quantity;
            totals.distributed_quantity += person.distributed_quantity.min(person.target_quantity);
            totals.remaining_quantity += person.remaining_quantity;
            if person.remaining_quantity == 0 {
                totals.completed_people += 1;
            } else {
                totals.remaining_people += 1;
            }
        }
    }
    let mut matching_person_ids = std::collections::HashSet::new();
    let mut people = if query.trim().is_empty() {
        eligible_people
    } else {
        repository
            .list_desk_records(query, selected_issue)?
            .into_iter()
            .inspect(|record| {
                matching_person_ids.insert(record.person.id.clone());
            })
            .map(|record| desk_person(record, selected_issue))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(is_distribution_candidate)
            .collect()
    };
    people.sort_by(|left, right| {
        (!left.can_distribute)
            .cmp(&(!right.can_distribute))
            .then((left.remaining_quantity == 0).cmp(&(right.remaining_quantity == 0)))
            .then(left.name.cmp(&right.name))
    });
    if query.trim().is_empty() && !show_all {
        people.retain(|person| person.can_distribute && person.remaining_quantity > 0);
    }
    let to_check_item_view = |item: CheckItem| CheckItemView {
        id: item.id,
        person_name: item
            .person_id
            .as_ref()
            .and_then(|id| person_names.get(id))
            .cloned(),
        person_id: item.person_id,
        summary: item.content,
        operator_name: item.operator_name,
        updated_at: item.updated_at,
        status: check_item_status_label(item.status).into(),
    };
    let check_items = repository
        .list_check_items()?
        .into_iter()
        .map(&to_check_item_view)
        .collect();
    let to_pinned_note_view = |note: PinnedNote| PinnedNoteView {
        id: note.id,
        title: note.title,
        content: note.content,
        is_pinned: note.is_pinned,
    };
    let pinned_notes = repository
        .list_pinned_notes()?
        .into_iter()
        .filter(PinnedNote::is_visible)
        .map(&to_pinned_note_view)
        .collect();
    let archived_check_items = repository
        .list_archived_check_items()?
        .into_iter()
        .map(&to_check_item_view)
        .collect();
    let archived_pinned_notes = repository
        .list_archived_pinned_notes()?
        .into_iter()
        .map(&to_pinned_note_view)
        .collect();
    let to_memo_view = |memo: Memo| MemoView {
        id: memo.id,
        person_name: memo
            .person_id
            .as_ref()
            .and_then(|id| person_names.get(id))
            .cloned(),
        person_id: memo.person_id,
        content: memo.content,
        operator_name: memo.operator_name,
        updated_at: memo.updated_at,
        status: match memo.status {
            MemoStatus::Active => "활성",
            MemoStatus::Archived => "보관",
        }
        .into(),
    };
    let mut memos = repository
        .list_memos()?
        .into_iter()
        .map(&to_memo_view)
        .collect::<Vec<_>>();
    // Stable sorting preserves the repository's newest-first order in each group.
    memos.sort_by_key(|memo| {
        !memo
            .person_id
            .as_ref()
            .is_some_and(|id| matching_person_ids.contains(id))
    });
    let archived_memos = repository
        .list_archived_memos()?
        .into_iter()
        .map(&to_memo_view)
        .collect();
    let (purchase_count, purchased_quantity) = repository.purchase_summary(selected_issue)?;
    let can_undo_distribution = repository
        .latest_reversible_distribution(selected_issue)?
        .is_some();

    Ok(DistributionDesk {
        selected_issue: selected_issue.into(),
        recommended_issue: recommended_issue(&clock.today())?.into(),
        operator_name: repository.current_operator()?,
        totals,
        people,
        check_items,
        pinned_notes,
        archived_check_items,
        archived_pinned_notes,
        memos,
        archived_memos,
        purchase_count,
        purchased_quantity,
        can_undo_distribution,
    })
}

fn desk_person(record: DeskRecord, issue: Issue) -> Result<DeskPerson, ApplicationError> {
    let active = record
        .subscriptions
        .iter()
        .filter(|subscription| subscription.includes(issue).unwrap_or(false))
        .collect::<Vec<_>>();
    let selected = active.first().copied().or_else(|| {
        record
            .subscriptions
            .iter()
            .filter(|subscription| subscription.start_issue <= issue)
            .max_by_key(|subscription| subscription.start_issue)
            .or_else(|| {
                record
                    .subscriptions
                    .iter()
                    .min_by_key(|subscription| subscription.start_issue)
            })
    });
    let mut view = DeskPerson {
        person_id: record.person.id,
        subscription_id: None,
        distribution_targets: Vec::new(),
        name: record.person.name,
        cohort: record.person.cohort,
        phone: record.person.phone,
        person_status: match record.person.status {
            PersonStatus::Active => "정식 등록",
            PersonStatus::Draft => "정보 보완 필요",
            PersonStatus::Archived => "보관",
        }
        .into(),
        subscription_status: "대상 아님".into(),
        distribution_status: "대상 아님".into(),
        target_quantity: 0,
        distributed_quantity: 0,
        remaining_quantity: 0,
        last_issue: None,
        end_date: None,
        is_last_issue: false,
        has_memo: record.has_memo,
        can_distribute: false,
    };
    let Some(subscription) = selected else {
        return Ok(view);
    };
    if !active.is_empty() {
        let mut targets = active
            .iter()
            .map(|subscription| {
                let subscription_assessment = subscription.assess(issue, false)?;
                let distribution_assessment =
                    assess_distribution(subscription, issue, false, &record.distributions)?;
                Ok(DistributionTargetView {
                    subscription_id: subscription.id.clone(),
                    start_issue: subscription.start_issue.display_name(),
                    last_issue: subscription_assessment.last_issue.display_name(),
                    end_date: subscription_assessment.last_issue.end_date(),
                    target_quantity: distribution_assessment.target_quantity,
                    distributed_quantity: distribution_assessment.distributed_quantity,
                    remaining_quantity: distribution_assessment.remaining_quantity,
                })
            })
            .collect::<Result<Vec<_>, ApplicationError>>()?;
        targets.sort_by(|left, right| {
            left.end_date
                .cmp(&right.end_date)
                .then(left.subscription_id.cmp(&right.subscription_id))
        });
        view.subscription_id = targets.first().map(|target| target.subscription_id.clone());
        view.target_quantity = targets.iter().map(|target| target.target_quantity).sum();
        view.distributed_quantity = targets
            .iter()
            .map(|target| target.distributed_quantity.min(target.target_quantity))
            .sum();
        view.remaining_quantity = targets.iter().map(|target| target.remaining_quantity).sum();
        view.subscription_status = "유효".into();
        view.distribution_status = if view.distributed_quantity == 0 {
            "미배부"
        } else if view.remaining_quantity == 0 {
            "배부 완료"
        } else {
            "일부 배부"
        }
        .into();
        view.last_issue = targets.last().map(|target| target.last_issue.clone());
        view.end_date = targets.last().map(|target| target.end_date.clone());
        view.is_last_issue = targets
            .iter()
            .any(|target| target.last_issue == issue.display_name());
        view.can_distribute = view.remaining_quantity > 0;
        view.distribution_targets = targets;
        return Ok(view);
    }
    let subscription_assessment = subscription.assess(issue, false)?;
    let distribution_assessment =
        assess_distribution(subscription, issue, false, &record.distributions)?;
    view.subscription_id = Some(subscription.id.clone());
    view.subscription_status = subscription_status(subscription_assessment.status).into();
    view.distribution_status = distribution_status(distribution_assessment.status).into();
    view.target_quantity = distribution_assessment.target_quantity;
    view.distributed_quantity = distribution_assessment.distributed_quantity;
    view.remaining_quantity = distribution_assessment.remaining_quantity;
    view.last_issue = Some(subscription_assessment.last_issue.display_name());
    view.end_date = Some(subscription_assessment.last_issue.end_date());
    view.is_last_issue = subscription_assessment.is_last_issue;
    view.can_distribute = subscription_assessment.status == SubscriptionStatus::Active
        && matches!(
            distribution_assessment.status,
            DistributionStatus::Undistributed | DistributionStatus::Partial
        );
    Ok(view)
}

pub fn record_distribution<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: RecordDistributionRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    let records = repository.list_desk_records("", issue)?;
    let (subscription, distributions, conflict) =
        find_subscription(&records, &request.subscription_id)?;
    let planned = plan_distribution(
        subscription,
        issue,
        conflict,
        distributions,
        request.quantity,
    )?;
    let now = services.clock.now();
    let distribution = Distribution {
        id: services.ids.next_id(),
        subscription_id: subscription.id.clone(),
        issue,
        quantity: planned.quantity,
        distributed_at: now.clone(),
        note: clean_optional(request.note),
        reversal_of: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "distribution_recorded",
        "distribution",
        &distribution.id,
        &format!("{}권 배부", distribution.quantity),
    );
    repository.save_distribution(&distribution, &change)?;
    Ok(())
}

pub fn undo_last_distribution<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UndoDistributionRequest,
) -> Result<UndoDistributionResult, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let issue = Issue::new(request.issue_year, request.issue_month)?;
    let original = match request.subscription_id.as_deref() {
        Some(subscription_id) => {
            repository.latest_reversible_distribution_for_subscription(issue, subscription_id)?
        }
        None => repository.latest_reversible_distribution(issue)?,
    }
    .ok_or(ApplicationError::NothingToUndo)?;
    let now = services.clock.now();
    let result = UndoDistributionResult {
        subscription_id: original.subscription_id.clone(),
        quantity: original.quantity,
    };
    let reversal = Distribution {
        id: services.ids.next_id(),
        subscription_id: original.subscription_id,
        issue: original.issue,
        quantity: original.quantity,
        distributed_at: now.clone(),
        note: Some("사용자 되돌리기".into()),
        reversal_of: Some(original.id.clone()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "distribution_reversed",
        "distribution",
        &reversal.id,
        &format!("{}권 배부 되돌리기", reversal.quantity),
    );
    repository.save_distribution(&reversal, &change)?;
    Ok(result)
}

pub fn save_operator<R: DistributionDeskRepository, C: Clock>(
    repository: &mut R,
    clock: &C,
    name: &str,
) -> Result<(), ApplicationError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApplicationError::MissingOperator);
    }
    repository.save_operator(name, &clock.now())?;
    Ok(())
}

pub fn create_draft<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: CreateDraftRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let name = request.name.trim();
    let cohort = clean_optional(request.cohort);
    if name.is_empty() {
        return Err(qt_domain::DomainError::DraftNameRequired.into());
    }
    let now = services.clock.now();
    let person_phone = format_phone(request.phone.as_deref().unwrap_or_default())?;
    let person = Person {
        id: services.ids.next_id(),
        name: name.into(),
        cohort,
        phone: person_phone.clone(),
        normalized_phone: person_phone.as_deref().map(normalize_phone),
        status: PersonStatus::Draft,
        person_note: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    person.validate_draft()?;
    let subscription = Subscription {
        id: services.ids.next_id(),
        person_id: person.id.clone(),
        start_issue: Issue::new(request.issue_year, request.issue_month)?,
        issue_count: 6,
        quantity: request.quantity,
        applied_at: Some(now.clone()),
        source: SubscriptionSource::OnSite,
        source_reference: None,
        memo: Some("현장 간이 등록".into()),
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
    };
    subscription.validate()?;
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "draft_person_created",
        "person",
        &person.id,
        "현장 간이 등록",
    );
    repository.save_draft(&person, &subscription, &change)?;
    Ok(())
}

pub fn create_check_item<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: CreateCheckItemRequest,
) -> Result<String, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let now = services.clock.now();
    let item = CheckItem {
        id: services.ids.next_id(),
        person_id: request.person_id,
        content: request.content.trim().into(),
        status: CheckItemStatus::NeedsCheck,
        operator_name: required_operator(repository)?,
        created_at: now.clone(),
        updated_at: now.clone(),
        checked_at: None,
    };
    item.validate()?;
    let change = change_log(
        services.ids.next_id(),
        &now,
        &item.operator_name,
        "check_item_created",
        "check_item",
        &item.id,
        if item.person_id.is_some() {
            "신청자 연결 확인할 일 추가"
        } else {
            "일반 확인할 일 추가"
        },
    );
    let id = item.id.clone();
    repository.save_check_item(&item, &change)?;
    Ok(id)
}

pub fn create_memo<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: CreateMemoRequest,
) -> Result<String, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let now = services.clock.now();
    let memo = Memo {
        id: services.ids.next_id(),
        person_id: request.person_id,
        content: request.content.trim().into(),
        status: MemoStatus::Active,
        operator_name: required_operator(repository)?,
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
        legacy_source: None,
        legacy_title: None,
    };
    memo.validate()?;
    let id = memo.id.clone();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &memo.operator_name,
        "memo_created",
        "memo",
        &memo.id,
        if memo.person_id.is_some() {
            "신청자 연결 메모 추가"
        } else {
            "메모 추가"
        },
    );
    repository.save_memo(&memo, &change)?;
    Ok(id)
}

pub fn update_memo<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UpdateMemoRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let mut memo = repository
        .list_memos()?
        .into_iter()
        .chain(repository.list_archived_memos()?)
        .find(|memo| memo.id == request.id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    memo.content = request.content.trim().into();
    memo.validate()?;
    let now = services.clock.now();
    memo.updated_at = now.clone();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "memo_updated",
        "memo",
        &memo.id,
        "메모 수정",
    );
    repository.save_memo(&memo, &change)?;
    Ok(())
}

pub fn update_memo_status<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UpdateMemoStatusRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let mut memo = repository
        .list_memos()?
        .into_iter()
        .chain(repository.list_archived_memos()?)
        .find(|memo| memo.id == request.id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let now = services.clock.now();
    memo.status = if request.archived {
        MemoStatus::Archived
    } else {
        MemoStatus::Active
    };
    memo.archived_at = request.archived.then(|| now.clone());
    memo.updated_at = now.clone();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        if request.archived {
            "memo_archived"
        } else {
            "memo_restored"
        },
        "memo",
        &memo.id,
        if request.archived {
            "메모 보관"
        } else {
            "메모 복원"
        },
    );
    repository.save_memo(&memo, &change)?;
    Ok(())
}

pub fn delete_memo<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    id: &str,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let exists = repository
        .list_memos()?
        .into_iter()
        .chain(repository.list_archived_memos()?)
        .any(|memo| memo.id == id);
    if !exists {
        return Err(ApplicationError::MissingDeskRecord);
    }
    let now = services.clock.now();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "memo_deleted",
        "memo",
        id,
        "메모 삭제",
    );
    repository.delete_memo(id, &change)?;
    Ok(())
}

pub fn update_check_item_status<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UpdateCheckItemStatusRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let mut item = repository
        .list_check_items()?
        .into_iter()
        .chain(repository.list_archived_check_items()?)
        .find(|item| item.id == request.id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let now = services.clock.now();
    item.status = request.status;
    item.checked_at = (request.status == CheckItemStatus::Checked).then(|| now.clone());
    item.updated_at = now.clone();
    let (action, summary) = match request.status {
        CheckItemStatus::NeedsCheck => ("check_item_reopened", "확인할 일 확인 필요"),
        CheckItemStatus::Checked => ("check_item_checked", "확인할 일 확인 완료"),
        CheckItemStatus::Archived => ("check_item_archived", "확인할 일 보관"),
    };
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        action,
        "check_item",
        &item.id,
        summary,
    );
    repository.save_check_item(&item, &change)?;
    Ok(())
}

pub fn update_check_item<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UpdateCheckItemRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let mut item = repository
        .list_check_items()?
        .into_iter()
        .chain(repository.list_archived_check_items()?)
        .find(|item| item.id == request.id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    item.content = request.content.trim().into();
    item.validate()?;
    let now = services.clock.now();
    item.updated_at = now.clone();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "check_item_updated",
        "check_item",
        &item.id,
        "확인할 일 수정",
    );
    repository.save_check_item(&item, &change)?;
    Ok(())
}

pub fn delete_check_item<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    id: &str,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let exists = repository
        .list_check_items()?
        .into_iter()
        .chain(repository.list_archived_check_items()?)
        .any(|item| item.id == id);
    if !exists {
        return Err(ApplicationError::MissingDeskRecord);
    }
    let now = services.clock.now();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "check_item_deleted",
        "check_item",
        id,
        "확인할 일 삭제",
    );
    repository.delete_check_item(id, &change)?;
    Ok(())
}

pub fn create_pinned_note<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: CreatePinnedNoteRequest,
) -> Result<String, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let now = services.clock.now();
    let note = PinnedNote {
        id: services.ids.next_id(),
        title: request.title.trim().into(),
        content: request.content.trim().into(),
        is_pinned: request.is_pinned,
        status: PinnedNoteStatus::Active,
        operator_name: required_operator(repository)?,
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
    };
    note.validate()?;
    let change = change_log(
        services.ids.next_id(),
        &now,
        &note.operator_name,
        "pinned_note_created",
        "pinned_note",
        &note.id,
        "고정 메모 추가",
    );
    let id = note.id.clone();
    repository.save_pinned_note(&note, &change)?;
    Ok(id)
}

pub fn update_pinned_note<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: UpdatePinnedNoteRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let mut note = repository
        .list_pinned_notes()?
        .into_iter()
        .chain(repository.list_archived_pinned_notes()?)
        .find(|note| note.id == request.id)
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let now = services.clock.now();
    if let Some(is_pinned) = request.is_pinned {
        note.is_pinned = is_pinned;
    }
    if let Some(archived) = request.archived {
        note.status = if archived {
            PinnedNoteStatus::Archived
        } else {
            PinnedNoteStatus::Active
        };
        note.archived_at = archived.then(|| now.clone());
    }
    note.updated_at = now.clone();
    let summary = if request.archived == Some(true) {
        "고정 메모 보관"
    } else if request.archived == Some(false) {
        "고정 메모 복원"
    } else if note.is_pinned {
        "고정 메모 상단 고정"
    } else {
        "고정 메모 상단 고정 해제"
    };
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "pinned_note_updated",
        "pinned_note",
        &note.id,
        summary,
    );
    repository.save_pinned_note(&note, &change)?;
    Ok(())
}

pub fn delete_pinned_note<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    id: &str,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let exists = repository
        .list_pinned_notes()?
        .into_iter()
        .chain(repository.list_archived_pinned_notes()?)
        .any(|note| note.id == id);
    if !exists {
        return Err(ApplicationError::MissingDeskRecord);
    }
    let now = services.clock.now();
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "pinned_note_deleted",
        "pinned_note",
        id,
        "고정 메모 삭제",
    );
    repository.delete_pinned_note(id, &change)?;
    Ok(())
}

pub fn record_purchase<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: RecordPurchaseRequest,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let now = services.clock.now();
    let purchase = OneTimePurchase {
        id: services.ids.next_id(),
        person_id: request.person_id,
        buyer_name: clean_optional(request.buyer_name),
        issue: Issue::new(request.issue_year, request.issue_month)?,
        quantity: request.quantity,
        purchased_at: now.clone(),
        note: clean_optional(request.note),
        reversal_of: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    purchase.validate()?;
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "one_time_purchase_recorded",
        "one_time_purchase",
        &purchase.id,
        &format!("현장 개별 구매 {}권", purchase.quantity),
    );
    repository.save_purchase(&purchase, &change)?;
    Ok(())
}

/// 현장 개별 구매를 위해 신청자를 새로 만들고, 구독 없이 구매 기록만 연결한다.
/// 이름이 같은 기존 신청자를 자동으로 합치지 않는 것은 잘못된 사람의 이력에
/// 구매를 붙이는 것보다 별도 인원으로 남기는 편이 되돌리기 쉽기 때문이다.
pub fn record_purchase_for_new_person<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    request: RecordPurchasePersonRequest,
) -> Result<String, ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let now = services.clock.now();
    let name = request.name.trim().to_owned();
    let cohort = clean_optional(request.cohort);
    let phone = format_phone(request.phone.as_deref().unwrap_or_default())?;
    let person = Person {
        id: services.ids.next_id(),
        name,
        cohort,
        normalized_phone: phone.as_deref().map(normalize_phone),
        phone,
        status: PersonStatus::Active,
        person_note: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    person.validate()?;

    let purchase = OneTimePurchase {
        id: services.ids.next_id(),
        person_id: Some(person.id.clone()),
        buyer_name: Some(person.name.clone()),
        issue: Issue::new(request.issue_year, request.issue_month)?,
        quantity: request.quantity,
        purchased_at: now.clone(),
        note: clean_optional(request.note),
        reversal_of: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    purchase.validate()?;
    let operator = required_operator(repository)?;
    let person_change = change_log(
        services.ids.next_id(),
        &now,
        &operator,
        "person_created_for_one_time_purchase",
        "person",
        &person.id,
        "개별 구매 인원 추가",
    );
    let purchase_change = change_log(
        services.ids.next_id(),
        &now,
        &operator,
        "one_time_purchase_recorded",
        "one_time_purchase",
        &purchase.id,
        &format!("현장 개별 구매 {}권", purchase.quantity),
    );
    repository.save_person_and_purchase(&person, &purchase, &[person_change, purchase_change])?;
    Ok(person.id)
}

pub fn cancel_latest_purchase<R, C, I>(
    repository: &mut R,
    services: &RuntimeServices<'_, C, I>,
    issue: Issue,
) -> Result<(), ApplicationError>
where
    R: DistributionDeskRepository,
    C: Clock,
    I: IdGenerator,
{
    let original = repository
        .latest_reversible_purchase(issue)?
        .ok_or(ApplicationError::NoPurchaseToCancel)?;
    let now = services.clock.now();
    let reversal = OneTimePurchase {
        id: services.ids.next_id(),
        person_id: original.person_id,
        buyer_name: original.buyer_name,
        issue: original.issue,
        quantity: original.quantity,
        purchased_at: now.clone(),
        note: Some("사용자 구매 취소".into()),
        reversal_of: Some(original.id),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let change = change_log(
        services.ids.next_id(),
        &now,
        &required_operator(repository)?,
        "one_time_purchase_reversed",
        "one_time_purchase",
        &reversal.id,
        &format!("현장 개별 구매 {}권 취소", reversal.quantity),
    );
    repository.save_purchase(&reversal, &change)?;
    Ok(())
}

fn find_subscription<'a>(
    records: &'a [DeskRecord],
    subscription_id: &str,
) -> Result<(&'a Subscription, &'a [Distribution], bool), ApplicationError> {
    for record in records {
        if let Some(subscription) = record
            .subscriptions
            .iter()
            .find(|subscription| subscription.id == subscription_id)
        {
            // 여러 권을 각기 다른 시작 호로 신청할 수 있으므로 서로 다른 구독은
            // 선택 호에 겹쳐도 각 구독의 독립적인 배부 자격으로 처리한다.
            return Ok((subscription, &record.distributions, false));
        }
    }
    Err(ApplicationError::MissingDeskRecord)
}

fn required_operator<R: DistributionDeskRepository>(
    repository: &R,
) -> Result<String, ApplicationError> {
    repository
        .current_operator()?
        .filter(|name| !name.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)
}

fn recommended_issue(today: &str) -> Result<Issue, ApplicationError> {
    let year = today
        .get(0..4)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(2026);
    let month = today
        .get(5..7)
        .and_then(|value| value.parse::<u8>().ok())
        .unwrap_or(1);
    let start_month = match month {
        1 => 1,
        2 => 3,
        value if value % 2 == 0 => value + 1,
        value => value,
    };
    let (year, start_month) = if start_month > 11 {
        (year + 1, 1)
    } else {
        (year, start_month)
    };
    Ok(Issue::new(year, start_month)?)
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn normalize_phone(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>()
}

fn subscription_status(status: SubscriptionStatus) -> &'static str {
    match status {
        SubscriptionStatus::Scheduled => "예정",
        SubscriptionStatus::Active => "유효",
        SubscriptionStatus::Expired => "구독 만료",
        SubscriptionStatus::NeedsReview => "확인 필요",
    }
}

fn check_item_status_label(status: CheckItemStatus) -> &'static str {
    match status {
        CheckItemStatus::NeedsCheck => "확인 필요",
        CheckItemStatus::Checked => "확인 완료",
        CheckItemStatus::Archived => "보관",
    }
}

fn distribution_status(status: DistributionStatus) -> &'static str {
    match status {
        DistributionStatus::NotEligible => "대상 아님",
        DistributionStatus::Undistributed => "미배부",
        DistributionStatus::Partial => "일부 배부",
        DistributionStatus::Complete => "배부 완료",
        DistributionStatus::Overdistributed => "초과 배부",
    }
}

fn change_log(
    id: String,
    now: &str,
    operator: &str,
    action: &str,
    entity: &str,
    entity_id: &str,
    summary: &str,
) -> ChangeLog {
    ChangeLog {
        id,
        occurred_at: now.into(),
        operator_name: operator.into(),
        action_type: action.into(),
        entity_type: entity.into(),
        entity_id: entity_id.into(),
        summary: summary.into(),
        before_json: None,
        after_json: None,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    struct FixedClock;
    impl Clock for FixedClock {
        fn now(&self) -> String {
            "2026-07-24T10:00:00+09:00".into()
        }
        fn today(&self) -> String {
            "2026-07-24".into()
        }
    }

    struct SequenceIds(Cell<u32>);
    impl IdGenerator for SequenceIds {
        fn next_id(&self) -> String {
            let value = self.0.get() + 1;
            self.0.set(value);
            format!("id-{value}")
        }
    }

    #[derive(Default)]
    struct MemoryRepository {
        operator: Option<String>,
        records: Vec<DeskRecord>,
        check_items: Vec<CheckItem>,
        pinned_notes: Vec<PinnedNote>,
        memos: Vec<Memo>,
        distributions: Vec<Distribution>,
        purchases: Vec<OneTimePurchase>,
    }

    impl DistributionDeskRepository for MemoryRepository {
        fn migrate(&mut self) -> Result<(), PortError> {
            Ok(())
        }
        fn current_operator(&self) -> Result<Option<String>, PortError> {
            Ok(self.operator.clone())
        }
        fn save_operator(&mut self, name: &str, _now: &str) -> Result<(), PortError> {
            self.operator = Some(name.into());
            Ok(())
        }
        fn list_desk_records(
            &self,
            query: &str,
            _issue: Issue,
        ) -> Result<Vec<DeskRecord>, PortError> {
            let normalized = qt_domain::normalize_search_text(query);
            let mut records = self
                .records
                .iter()
                .filter(|record| {
                    normalized.is_empty()
                        || qt_domain::normalize_search_text(&record.person.name)
                            .contains(&normalized)
                        || record
                            .person
                            .cohort
                            .as_ref()
                            .is_some_and(|value| value.contains(&normalized))
                })
                .cloned()
                .collect::<Vec<_>>();
            for record in &mut records {
                record.distributions.extend(self.distributions.clone());
            }
            Ok(records)
        }
        fn save_distribution(
            &mut self,
            distribution: &Distribution,
            _change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.distributions.push(distribution.clone());
            Ok(())
        }
        fn latest_reversible_distribution(
            &self,
            issue: Issue,
        ) -> Result<Option<Distribution>, PortError> {
            Ok(self
                .distributions
                .iter()
                .rev()
                .find(|item| {
                    item.issue == issue
                        && item.reversal_of.is_none()
                        && !self
                            .distributions
                            .iter()
                            .any(|candidate| candidate.reversal_of.as_deref() == Some(&item.id))
                })
                .cloned())
        }
        fn save_draft(
            &mut self,
            person: &Person,
            subscription: &Subscription,
            _change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.records.push(DeskRecord {
                person: person.clone(),
                subscriptions: vec![subscription.clone()],
                distributions: vec![],
                has_memo: false,
            });
            Ok(())
        }
        fn list_check_items(&self) -> Result<Vec<CheckItem>, PortError> {
            Ok(self
                .check_items
                .iter()
                .filter(|item| item.status != CheckItemStatus::Archived)
                .cloned()
                .collect())
        }
        fn list_archived_check_items(&self) -> Result<Vec<CheckItem>, PortError> {
            Ok(self
                .check_items
                .iter()
                .filter(|item| item.status == CheckItemStatus::Archived)
                .cloned()
                .collect())
        }
        fn save_check_item(
            &mut self,
            item: &CheckItem,
            _change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.check_items.retain(|current| current.id != item.id);
            self.check_items.push(item.clone());
            Ok(())
        }
        fn delete_check_item(&mut self, id: &str, _change: &ChangeLog) -> Result<(), PortError> {
            self.check_items.retain(|item| item.id != id);
            Ok(())
        }
        fn list_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError> {
            Ok(self
                .pinned_notes
                .iter()
                .filter(|note| note.status == PinnedNoteStatus::Active)
                .cloned()
                .collect())
        }
        fn list_archived_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError> {
            Ok(self
                .pinned_notes
                .iter()
                .filter(|note| note.status == PinnedNoteStatus::Archived)
                .cloned()
                .collect())
        }
        fn save_pinned_note(
            &mut self,
            note: &PinnedNote,
            _change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.pinned_notes.retain(|current| current.id != note.id);
            self.pinned_notes.push(note.clone());
            Ok(())
        }
        fn delete_pinned_note(&mut self, id: &str, _change: &ChangeLog) -> Result<(), PortError> {
            self.pinned_notes.retain(|note| note.id != id);
            Ok(())
        }
        fn list_memos(&self) -> Result<Vec<Memo>, PortError> {
            Ok(self
                .memos
                .iter()
                .filter(|memo| memo.status == MemoStatus::Active)
                .cloned()
                .collect())
        }
        fn list_archived_memos(&self) -> Result<Vec<Memo>, PortError> {
            Ok(self
                .memos
                .iter()
                .filter(|memo| memo.status == MemoStatus::Archived)
                .cloned()
                .collect())
        }
        fn save_memo(&mut self, memo: &Memo, _change: &ChangeLog) -> Result<(), PortError> {
            self.memos.retain(|current| current.id != memo.id);
            self.memos.push(memo.clone());
            Ok(())
        }
        fn delete_memo(&mut self, id: &str, _change: &ChangeLog) -> Result<(), PortError> {
            self.memos.retain(|memo| memo.id != id);
            Ok(())
        }
        fn save_purchase(
            &mut self,
            purchase: &OneTimePurchase,
            _change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.purchases.push(purchase.clone());
            Ok(())
        }
        fn save_person_and_purchase(
            &mut self,
            person: &Person,
            purchase: &OneTimePurchase,
            _changes: &[ChangeLog],
        ) -> Result<(), PortError> {
            self.records.push(DeskRecord {
                person: person.clone(),
                subscriptions: vec![],
                distributions: vec![],
                has_memo: false,
            });
            self.purchases.push(purchase.clone());
            Ok(())
        }
        fn latest_reversible_purchase(
            &self,
            issue: Issue,
        ) -> Result<Option<OneTimePurchase>, PortError> {
            Ok(self
                .purchases
                .iter()
                .rev()
                .find(|item| {
                    item.issue == issue
                        && item.reversal_of.is_none()
                        && !self
                            .purchases
                            .iter()
                            .any(|candidate| candidate.reversal_of.as_deref() == Some(&item.id))
                })
                .cloned())
        }
        fn purchase_summary(&self, issue: Issue) -> Result<(u32, u32), PortError> {
            let matching =
                self.purchases
                    .iter()
                    .filter(|purchase| {
                        purchase.issue == issue
                            && purchase.reversal_of.is_none()
                            && !self.purchases.iter().any(|candidate| {
                                candidate.reversal_of.as_deref() == Some(&purchase.id)
                            })
                    })
                    .collect::<Vec<_>>();
            Ok((
                matching.len() as u32,
                matching.iter().map(|purchase| purchase.quantity).sum(),
            ))
        }
    }

    fn record(quantity: u32) -> DeskRecord {
        let now = "2026-01-01T00:00:00+09:00";
        let person = Person {
            id: "person-1".into(),
            name: "가상 신청자".into(),
            cohort: Some("94".into()),
            phone: Some("010-1234-5678".into()),
            normalized_phone: Some("01012345678".into()),
            status: PersonStatus::Active,
            person_note: None,
            created_at: now.into(),
            updated_at: now.into(),
        };
        DeskRecord {
            subscriptions: vec![Subscription {
                id: "subscription-1".into(),
                person_id: person.id.clone(),
                start_issue: Issue::new(2026, 1).unwrap(),
                issue_count: 6,
                quantity,
                applied_at: None,
                source: SubscriptionSource::Manual,
                source_reference: None,
                memo: None,
                created_at: now.into(),
                updated_at: now.into(),
                archived_at: None,
            }],
            person,
            distributions: vec![],
            has_memo: true,
        }
    }

    #[test]
    fn empty_search_shows_remaining_people_and_counts_people_and_books() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record(2)],
            ..Default::default()
        };
        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            false,
        )
        .unwrap();

        assert_eq!(desk.people.len(), 1);
        assert_eq!(desk.totals.target_people, 1);
        assert_eq!(desk.totals.remaining_people, 1);
        assert_eq!(desk.totals.target_quantity, 2);
        assert_eq!(desk.people[0].phone.as_deref(), Some("010-1234-5678"));
    }

    #[test]
    fn scheduled_and_issue_ineligible_people_are_not_distribution_candidates() {
        let mut scheduled = record(1);
        scheduled.subscriptions[0].start_issue = Issue::new(2026, 9).unwrap();
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![scheduled],
            ..Default::default()
        };

        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 5).unwrap(),
            "",
            true,
        )
        .unwrap();

        assert!(desk.people.is_empty());
        assert_eq!(desk.totals.target_people, 0);
        assert_eq!(desk.totals.target_quantity, 0);
        assert_eq!(desk.totals.remaining_people, 0);
    }

    #[test]
    fn totals_ignore_search_and_keep_the_selected_issue_whole() {
        let first = record(1);
        let mut second = record(2);
        second.person.id = "person-2".into();
        second.person.name = "다른 신청자".into();
        second.person.cohort = Some("00".into());
        second.person.phone = None;
        second.person.normalized_phone = None;
        second.subscriptions[0].id = "subscription-2".into();
        second.subscriptions[0].person_id = second.person.id.clone();
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![first, second],
            ..Default::default()
        };

        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "가상",
            true,
        )
        .unwrap();

        assert_eq!(desk.people.len(), 1);
        assert_eq!(desk.people[0].name, "가상 신청자");
        assert_eq!(desk.totals.target_people, 2);
        assert_eq!(desk.totals.remaining_people, 2);
        assert_eq!(desk.totals.target_quantity, 3);
    }

    #[test]
    fn overlapping_independent_subscriptions_are_summed_per_person() {
        let mut record = record(1);
        let mut second = record.subscriptions[0].clone();
        second.id = "subscription-2".into();
        second.start_issue = Issue::new(2026, 5).unwrap();
        record.subscriptions.push(second);
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record],
            ..Default::default()
        };

        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            true,
        )
        .unwrap();

        assert_eq!(desk.people.len(), 1);
        assert_eq!(desk.people[0].distribution_targets.len(), 2);
        assert_eq!(desk.people[0].target_quantity, 2);
        assert_eq!(desk.people[0].remaining_quantity, 2);
        assert!(desk.people[0].can_distribute);
        assert_eq!(desk.totals.target_people, 1);
        assert_eq!(desk.totals.target_quantity, 2);
    }

    #[test]
    fn completed_people_are_hidden_from_remaining_and_visible_in_all() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record(1)],
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        record_distribution(
            &mut repository,
            &services,
            RecordDistributionRequest {
                issue_year: 2026,
                issue_month: 7,
                subscription_id: "subscription-1".into(),
                quantity: None,
                note: None,
            },
        )
        .unwrap();

        let remaining = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            false,
        )
        .unwrap();
        let all = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            true,
        )
        .unwrap();

        assert!(remaining.people.is_empty());
        assert_eq!(all.people.len(), 1);
        assert_eq!(all.people[0].distribution_status, "배부 완료");
        assert_eq!(all.totals.completed_people, 1);
    }

    #[test]
    fn partial_then_remaining_distribution_and_undo_are_persistent_records() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record(2)],
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        record_distribution(
            &mut repository,
            &services,
            RecordDistributionRequest {
                issue_year: 2026,
                issue_month: 7,
                subscription_id: "subscription-1".into(),
                quantity: Some(1),
                note: None,
            },
        )
        .unwrap();
        record_distribution(
            &mut repository,
            &services,
            RecordDistributionRequest {
                issue_year: 2026,
                issue_month: 7,
                subscription_id: "subscription-1".into(),
                quantity: None,
                note: None,
            },
        )
        .unwrap();
        let complete = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "가상",
            false,
        )
        .unwrap();
        assert_eq!(complete.people[0].distribution_status, "배부 완료");

        let undone = undo_last_distribution(
            &mut repository,
            &services,
            UndoDistributionRequest {
                issue_year: 2026,
                issue_month: 7,
                subscription_id: None,
            },
        )
        .unwrap();
        assert_eq!(undone.subscription_id, "subscription-1");
        assert_eq!(undone.quantity, 1);
        let partial = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "가상",
            false,
        )
        .unwrap();
        assert_eq!(partial.people[0].distribution_status, "일부 배부");
        assert_eq!(partial.people[0].remaining_quantity, 1);
    }

    #[test]
    fn check_items_and_pinned_notes_remain_separate_and_support_all_states() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        create_check_item(
            &mut repository,
            &services,
            CreateCheckItemRequest {
                person_id: None,
                content: "신규 신청 확인".into(),
            },
        )
        .unwrap();
        create_pinned_note(
            &mut repository,
            &services,
            CreatePinnedNoteRequest {
                title: "보관 위치".into(),
                content: "예배당 뒤편".into(),
                is_pinned: true,
            },
        )
        .unwrap();

        let item_id = repository.check_items[0].id.clone();
        let note_id = repository.pinned_notes[0].id.clone();
        update_check_item_status(
            &mut repository,
            &services,
            UpdateCheckItemStatusRequest {
                id: item_id.clone(),
                status: CheckItemStatus::Checked,
            },
        )
        .unwrap();
        update_check_item_status(
            &mut repository,
            &services,
            UpdateCheckItemStatusRequest {
                id: item_id.clone(),
                status: CheckItemStatus::Archived,
            },
        )
        .unwrap();
        update_pinned_note(
            &mut repository,
            &services,
            UpdatePinnedNoteRequest {
                id: note_id.clone(),
                is_pinned: None,
                archived: Some(true),
            },
        )
        .unwrap();

        assert_eq!(repository.check_items[0].status, CheckItemStatus::Archived);
        assert_eq!(repository.pinned_notes.len(), 1);
        assert!(!repository.pinned_notes[0].is_visible());
        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            false,
        )
        .unwrap();
        assert!(desk.check_items.is_empty());
        assert!(desk.pinned_notes.is_empty());
        assert_eq!(desk.archived_check_items.len(), 1);
        assert_eq!(desk.archived_pinned_notes.len(), 1);

        update_check_item_status(
            &mut repository,
            &services,
            UpdateCheckItemStatusRequest {
                id: item_id,
                status: CheckItemStatus::NeedsCheck,
            },
        )
        .unwrap();
        update_pinned_note(
            &mut repository,
            &services,
            UpdatePinnedNoteRequest {
                id: note_id,
                is_pinned: None,
                archived: Some(false),
            },
        )
        .unwrap();
        assert_eq!(
            repository.check_items[0].status,
            CheckItemStatus::NeedsCheck
        );
        assert!(repository.pinned_notes[0].is_visible());

        let item_id = repository.check_items[0].id.clone();
        let note_id = repository.pinned_notes[0].id.clone();
        delete_check_item(&mut repository, &services, &item_id).unwrap();
        delete_pinned_note(&mut repository, &services, &note_id).unwrap();
        assert!(repository.check_items.is_empty());
        assert!(repository.pinned_notes.is_empty());
    }

    #[test]
    fn check_item_view_keeps_full_content_for_detail_surfaces() {
        let content = "권별 구독 기간과 신청 수량을 담당자가 당사자에게 확인해야 하며 첫째 권과 둘째 권의 시작 호가 서로 다른지도 함께 확인해야 하는 익명 확인 내용 전문";
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &SequenceIds(Cell::new(0)),
        };
        create_check_item(
            &mut repository,
            &services,
            CreateCheckItemRequest {
                person_id: None,
                content: content.into(),
            },
        )
        .unwrap();

        let desk = load_distribution_desk(
            &mut repository,
            &FixedClock,
            Issue::new(2026, 7).unwrap(),
            "",
            true,
        )
        .unwrap();

        assert_eq!(desk.check_items[0].summary, content);
    }

    #[test]
    fn linked_check_item_content_can_be_updated_without_changing_its_state() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        create_check_item(
            &mut repository,
            &services,
            CreateCheckItemRequest {
                person_id: Some("person-1".into()),
                content: "기존 확인 내용".into(),
            },
        )
        .unwrap();
        let item_id = repository.check_items[0].id.clone();
        update_check_item_status(
            &mut repository,
            &services,
            UpdateCheckItemStatusRequest {
                id: item_id.clone(),
                status: CheckItemStatus::Checked,
            },
        )
        .unwrap();
        update_check_item(
            &mut repository,
            &services,
            UpdateCheckItemRequest {
                id: item_id,
                content: "수정된 확인 내용".into(),
            },
        )
        .unwrap();

        assert_eq!(repository.check_items[0].content, "수정된 확인 내용");
        assert_eq!(repository.check_items[0].status, CheckItemStatus::Checked);
    }

    #[test]
    fn one_time_purchase_can_be_cancelled_without_touching_subscription() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record(1)],
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        let issue = Issue::new(2026, 7).unwrap();
        record_purchase(
            &mut repository,
            &services,
            RecordPurchaseRequest {
                person_id: None,
                buyer_name: Some("현장 구매자".into()),
                issue_year: 2026,
                issue_month: 7,
                quantity: 2,
                note: None,
            },
        )
        .unwrap();
        assert_eq!(repository.purchase_summary(issue).unwrap(), (1, 2));

        cancel_latest_purchase(&mut repository, &services, issue).unwrap();

        assert_eq!(repository.purchase_summary(issue).unwrap(), (0, 0));
        assert_eq!(repository.records[0].subscriptions[0].quantity, 1);
        assert_eq!(repository.purchases.len(), 2);
    }

    #[test]
    fn one_time_purchase_preserves_an_explicit_existing_person_link() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            records: vec![record(1)],
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };

        record_purchase(
            &mut repository,
            &services,
            RecordPurchaseRequest {
                person_id: Some("person-1".into()),
                buyer_name: Some("가상 신청자".into()),
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                note: None,
            },
        )
        .unwrap();

        assert_eq!(repository.purchases.len(), 1);
        assert_eq!(
            repository.purchases[0].person_id.as_deref(),
            Some("person-1")
        );
        assert_eq!(repository.records[0].subscriptions[0].quantity, 1);
    }

    #[test]
    fn one_time_purchase_can_create_a_linked_person_without_subscription() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };

        let person_id = record_purchase_for_new_person(
            &mut repository,
            &services,
            RecordPurchasePersonRequest {
                name: "가상 구매자".into(),
                cohort: Some("00".into()),
                phone: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                note: Some("현장 구매".into()),
            },
        )
        .unwrap();

        let person = repository
            .records
            .iter()
            .find(|record| record.person.id == person_id)
            .expect("구매 전용 인원이 저장되어야 합니다.");
        assert_eq!(person.person.name, "가상 구매자");
        assert_eq!(person.person.status, PersonStatus::Active);
        assert!(person.subscriptions.is_empty());
        assert_eq!(repository.purchases.len(), 1);
        assert_eq!(
            repository.purchases[0].person_id.as_deref(),
            Some(person_id.as_str())
        );
    }

    #[test]
    fn draft_requires_name_but_allows_missing_cohort() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        create_draft(
            &mut repository,
            &services,
            CreateDraftRequest {
                name: "현장 단체".into(),
                cohort: None,
                phone: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
            },
        )
        .unwrap();
        assert_eq!(repository.records[0].person.name, "현장 단체");
        assert_eq!(repository.records[0].person.cohort, None);

        let error = create_draft(
            &mut repository,
            &services,
            CreateDraftRequest {
                name: "  ".into(),
                cohort: Some("94".into()),
                phone: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
            },
        )
        .expect_err("이름이 없는 간이 등록은 거부되어야 합니다.");
        assert!(matches!(
            error,
            ApplicationError::Domain(qt_domain::DomainError::DraftNameRequired)
        ));
    }

    #[test]
    fn memo_lifecycle_supports_linked_create_edit_archive_restore_and_delete() {
        let mut repository = MemoryRepository {
            operator: Some("담당자".into()),
            ..Default::default()
        };
        let ids = SequenceIds(Cell::new(0));
        let services = RuntimeServices {
            clock: &FixedClock,
            ids: &ids,
        };
        let memo_id = create_memo(
            &mut repository,
            &services,
            CreateMemoRequest {
                person_id: Some("person-1".into()),
                content: "권수 확인".into(),
            },
        )
        .unwrap();
        assert_eq!(repository.memos[0].person_id.as_deref(), Some("person-1"));
        update_memo(
            &mut repository,
            &services,
            UpdateMemoRequest {
                id: memo_id.clone(),
                content: "권수와 시작 호 확인".into(),
            },
        )
        .unwrap();
        update_memo_status(
            &mut repository,
            &services,
            UpdateMemoStatusRequest {
                id: memo_id.clone(),
                archived: true,
            },
        )
        .unwrap();
        assert!(repository.list_memos().unwrap().is_empty());
        assert_eq!(repository.list_archived_memos().unwrap().len(), 1);
        update_memo_status(
            &mut repository,
            &services,
            UpdateMemoStatusRequest {
                id: memo_id.clone(),
                archived: false,
            },
        )
        .unwrap();
        assert_eq!(
            repository.list_memos().unwrap()[0].content,
            "권수와 시작 호 확인"
        );
        delete_memo(&mut repository, &services, &memo_id).unwrap();
        assert!(repository.memos.is_empty());
    }
}
