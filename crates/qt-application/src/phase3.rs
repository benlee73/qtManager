use qt_domain::{
    ChangeLog, Distribution, Issue, Person, PersonStatus, Subscription, SubscriptionSource,
    normalize_phone,
};
use serde::{Deserialize, Serialize};

use crate::{ApplicationError, Clock, IdGenerator, PortError, RuntimeServices};

#[derive(Clone, Debug)]
pub struct ManagedPersonRecord {
    pub person: Person,
    pub subscriptions: Vec<Subscription>,
    pub distributions: Vec<Distribution>,
}

pub trait PeopleManagementRepository {
    fn migrate(&mut self) -> Result<(), PortError>;
    fn current_operator(&self) -> Result<Option<String>, PortError>;
    fn list_people(
        &self,
        query: &str,
        include_archived: bool,
    ) -> Result<Vec<ManagedPersonRecord>, PortError>;
    fn load_person(&self, id: &str) -> Result<Option<ManagedPersonRecord>, PortError>;
    fn duplicate_candidates(
        &self,
        name: &str,
        cohort: Option<&str>,
        normalized_phone: Option<&str>,
        excluding_id: Option<&str>,
    ) -> Result<Vec<Person>, PortError>;
    fn save_person_with_subscription(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        changes: &[ChangeLog],
    ) -> Result<(), PortError>;
    fn update_person(&mut self, person: &Person, change: &ChangeLog) -> Result<(), PortError>;
    fn save_subscription(
        &mut self,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleManagement {
    pub people: Vec<PersonSummary>,
    pub draft_count: u32,
    pub archived_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonSummary {
    pub id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone_suffix: Option<String>,
    pub status: String,
    pub special_note: Option<String>,
    pub subscription_count: u32,
    pub latest_last_issue: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonDetail {
    pub id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub status: String,
    pub special_note: Option<String>,
    pub subscriptions: Vec<SubscriptionView>,
    pub distributions: Vec<DistributionView>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionView {
    pub id: String,
    pub start_issue: String,
    pub last_issue: String,
    pub quantity: u32,
    pub applied_at: Option<String>,
    pub source: String,
    pub memo: Option<String>,
    pub archived: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionView {
    pub issue: String,
    pub quantity: u32,
    pub distributed_at: String,
    pub reversed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone_suffix: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPersonRequest {
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub special_note: Option<String>,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub applied_at: Option<String>,
    pub memo: Option<String>,
    pub confirm_duplicate: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonRequest {
    pub person_id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub special_note: Option<String>,
    pub confirm_duplicate: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewSubscriptionRequest {
    pub person_id: String,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub applied_at: Option<String>,
    pub memo: Option<String>,
    pub confirm_overlap: bool,
}

pub fn load_people_management<R: PeopleManagementRepository>(
    repository: &mut R,
    query: &str,
    include_archived: bool,
) -> Result<PeopleManagement, ApplicationError> {
    repository.migrate()?;
    let records = repository.list_people(query, include_archived)?;
    let mut draft_count = 0;
    let mut archived_count = 0;
    let mut summaries = Vec::with_capacity(records.len());
    for record in records {
        let person = record.person;
        if person.status == PersonStatus::Draft {
            draft_count += 1;
        }
        if person.status == PersonStatus::Archived {
            archived_count += 1;
        }
        let latest_last_issue = record
            .subscriptions
            .iter()
            .filter(|item| item.archived_at.is_none())
            .filter_map(|item| item.last_issue().ok())
            .max()
            .map(|issue| issue.display_name());
        summaries.push(PersonSummary {
            id: person.id,
            name: person.name,
            cohort: person.cohort,
            phone_suffix: phone_suffix(person.normalized_phone.as_deref()),
            status: person_status(person.status).into(),
            special_note: person.special_note,
            subscription_count: record
                .subscriptions
                .iter()
                .filter(|item| item.archived_at.is_none())
                .count() as u32,
            latest_last_issue,
        });
    }
    Ok(PeopleManagement {
        people: summaries,
        draft_count,
        archived_count,
    })
}

pub fn load_person_detail<R: PeopleManagementRepository>(
    repository: &mut R,
    person_id: &str,
) -> Result<PersonDetail, ApplicationError> {
    repository.migrate()?;
    let record = repository
        .load_person(person_id)?
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let mut subscriptions = record
        .subscriptions
        .iter()
        .map(|item| {
            Ok(SubscriptionView {
                id: item.id.clone(),
                start_issue: item.start_issue.display_name(),
                last_issue: item.last_issue()?.display_name(),
                quantity: item.quantity,
                applied_at: item.applied_at.clone(),
                source: source_label(item.source).into(),
                memo: item.memo.clone(),
                archived: item.archived_at.is_some(),
            })
        })
        .collect::<Result<Vec<_>, qt_domain::DomainError>>()?;
    subscriptions.reverse();
    let mut distributions = record
        .distributions
        .iter()
        .map(|item| DistributionView {
            issue: item.issue.display_name(),
            quantity: item.quantity,
            distributed_at: item.distributed_at.clone(),
            reversed: item.reversal_of.is_some(),
        })
        .collect::<Vec<_>>();
    distributions.sort_by(|left, right| right.distributed_at.cmp(&left.distributed_at));
    Ok(PersonDetail {
        id: record.person.id,
        name: record.person.name,
        cohort: record.person.cohort,
        phone: record.person.phone,
        status: person_status(record.person.status).into(),
        special_note: record.person.special_note,
        subscriptions,
        distributions,
    })
}

pub fn preview_duplicates<R: PeopleManagementRepository>(
    repository: &mut R,
    name: &str,
    cohort: Option<&str>,
    phone: Option<&str>,
    excluding_id: Option<&str>,
) -> Result<Vec<DuplicateCandidate>, ApplicationError> {
    repository.migrate()?;
    let normalized = phone.map(normalize_phone).filter(|item| !item.is_empty());
    Ok(repository
        .duplicate_candidates(
            name.trim(),
            clean(cohort),
            normalized.as_deref(),
            excluding_id,
        )?
        .into_iter()
        .map(|person| DuplicateCandidate {
            id: person.id,
            name: person.name,
            cohort: person.cohort,
            phone_suffix: phone_suffix(person.normalized_phone.as_deref()),
            status: person_status(person.status).into(),
        })
        .collect())
}

pub fn register_person<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: RegisterPersonRequest,
) -> Result<String, ApplicationError>
where
    R: PeopleManagementRepository,
    C: Clock,
    I: IdGenerator,
{
    repository.migrate()?;
    let operator = operator(repository)?;
    let now = runtime.clock.now();
    let phone = clean_owned(request.phone);
    let normalized_phone = phone.as_deref().map(normalize_phone);
    let duplicates = repository.duplicate_candidates(
        request.name.trim(),
        clean(request.cohort.as_deref()),
        normalized_phone.as_deref(),
        None,
    )?;
    if !duplicates.is_empty() && !request.confirm_duplicate {
        return Err(ApplicationError::DuplicatePersonConfirmationRequired);
    }
    let person = Person {
        id: runtime.ids.next_id(),
        name: request.name.trim().into(),
        cohort: clean_owned(request.cohort),
        phone,
        normalized_phone,
        status: PersonStatus::Active,
        special_note: clean_owned(request.special_note),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    person.validate()?;
    let subscription = annual_subscription(NewSubscription {
        id: runtime.ids.next_id(),
        person_id: person.id.clone(),
        start_issue: Issue::new(request.issue_year, request.issue_month)?,
        quantity: request.quantity,
        applied_at: clean_owned(request.applied_at),
        source: SubscriptionSource::Manual,
        memo: clean_owned(request.memo),
        now: &now,
    })?;
    let changes = vec![
        change(
            runtime.ids.next_id(),
            &now,
            &operator,
            "person_created",
            "person",
            &person.id,
            "QT 신청자 정식 등록",
        ),
        change(
            runtime.ids.next_id(),
            &now,
            &operator,
            "subscription_created",
            "subscription",
            &subscription.id,
            "연간 구독 생성",
        ),
    ];
    repository.save_person_with_subscription(&person, &subscription, &changes)?;
    Ok(person.id)
}

pub fn update_person<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: UpdatePersonRequest,
) -> Result<(), ApplicationError>
where
    R: PeopleManagementRepository,
    C: Clock,
    I: IdGenerator,
{
    repository.migrate()?;
    let operator = operator(repository)?;
    let mut person = repository
        .load_person(&request.person_id)?
        .ok_or(ApplicationError::MissingDeskRecord)?
        .person;
    let phone = clean_owned(request.phone);
    let normalized_phone = phone.as_deref().map(normalize_phone);
    let duplicates = repository.duplicate_candidates(
        request.name.trim(),
        clean(request.cohort.as_deref()),
        normalized_phone.as_deref(),
        Some(&person.id),
    )?;
    if !duplicates.is_empty() && !request.confirm_duplicate {
        return Err(ApplicationError::DuplicatePersonConfirmationRequired);
    }
    let before = format!("status={}", person_status(person.status));
    person.name = request.name.trim().into();
    person.cohort = clean_owned(request.cohort);
    person.phone = phone;
    person.normalized_phone = normalized_phone;
    person.special_note = clean_owned(request.special_note);
    person.status = PersonStatus::Active;
    person.updated_at = runtime.clock.now();
    person.validate()?;
    let change = ChangeLog {
        before_json: Some(before),
        ..change(
            runtime.ids.next_id(),
            &person.updated_at,
            &operator,
            "person_updated",
            "person",
            &person.id,
            "QT 신청자 정보 수정",
        )
    };
    repository.update_person(&person, &change)?;
    Ok(())
}

pub fn set_person_archived<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<C, I>,
    person_id: &str,
    archived: bool,
) -> Result<(), ApplicationError>
where
    R: PeopleManagementRepository,
    C: Clock,
    I: IdGenerator,
{
    repository.migrate()?;
    let operator = operator(repository)?;
    let mut person = repository
        .load_person(person_id)?
        .ok_or(ApplicationError::MissingDeskRecord)?
        .person;
    person.status = if archived {
        PersonStatus::Archived
    } else {
        PersonStatus::Active
    };
    person.updated_at = runtime.clock.now();
    let change = change(
        runtime.ids.next_id(),
        &person.updated_at,
        &operator,
        if archived {
            "person_archived"
        } else {
            "person_restored"
        },
        "person",
        &person.id,
        if archived {
            "QT 신청자 보관"
        } else {
            "QT 신청자 복원"
        },
    );
    repository.update_person(&person, &change)?;
    Ok(())
}

pub fn renew_subscription<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: RenewSubscriptionRequest,
) -> Result<(), ApplicationError>
where
    R: PeopleManagementRepository,
    C: Clock,
    I: IdGenerator,
{
    repository.migrate()?;
    let operator = operator(repository)?;
    let record = repository
        .load_person(&request.person_id)?
        .ok_or(ApplicationError::MissingDeskRecord)?;
    let now = runtime.clock.now();
    let subscription = annual_subscription(NewSubscription {
        id: runtime.ids.next_id(),
        person_id: record.person.id,
        start_issue: Issue::new(request.issue_year, request.issue_month)?,
        quantity: request.quantity,
        applied_at: clean_owned(request.applied_at),
        source: SubscriptionSource::Manual,
        memo: clean_owned(request.memo),
        now: &now,
    })?;
    let overlap = record
        .subscriptions
        .iter()
        .filter(|item| item.archived_at.is_none())
        .any(|item| item.overlaps(&subscription).unwrap_or(true));
    if overlap && !request.confirm_overlap {
        return Err(ApplicationError::OverlappingSubscriptionConfirmationRequired);
    }
    let change = change(
        runtime.ids.next_id(),
        &now,
        &operator,
        "subscription_renewed",
        "subscription",
        &subscription.id,
        "연간 구독 갱신",
    );
    repository.save_subscription(&subscription, &change)?;
    Ok(())
}

struct NewSubscription<'a> {
    id: String,
    person_id: String,
    start_issue: Issue,
    quantity: u32,
    applied_at: Option<String>,
    source: SubscriptionSource,
    memo: Option<String>,
    now: &'a str,
}

fn annual_subscription(input: NewSubscription<'_>) -> Result<Subscription, ApplicationError> {
    let subscription = Subscription {
        id: input.id,
        person_id: input.person_id,
        start_issue: input.start_issue,
        issue_count: 6,
        quantity: input.quantity,
        applied_at: input.applied_at,
        source: input.source,
        source_reference: None,
        memo: input.memo,
        created_at: input.now.into(),
        updated_at: input.now.into(),
        archived_at: None,
    };
    subscription.validate()?;
    Ok(subscription)
}

fn operator<R: PeopleManagementRepository>(repository: &R) -> Result<String, ApplicationError> {
    repository
        .current_operator()?
        .filter(|item| !item.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)
}

fn change(
    id: String,
    now: &str,
    operator: &str,
    action_type: &str,
    entity_type: &str,
    entity_id: &str,
    summary: &str,
) -> ChangeLog {
    ChangeLog {
        id,
        occurred_at: now.into(),
        operator_name: operator.into(),
        action_type: action_type.into(),
        entity_type: entity_type.into(),
        entity_id: entity_id.into(),
        summary: summary.into(),
        before_json: None,
        after_json: None,
    }
}

fn clean(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|item| !item.is_empty())
}

fn clean_owned(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

fn phone_suffix(value: Option<&str>) -> Option<String> {
    value
        .filter(|item| !item.is_empty())
        .map(|item| item.chars().rev().take(4).collect::<String>())
        .map(|item| item.chars().rev().collect())
}

fn person_status(status: PersonStatus) -> &'static str {
    match status {
        PersonStatus::Active => "정식 등록",
        PersonStatus::Draft => "정보 보완 필요",
        PersonStatus::Archived => "보관됨",
    }
}

fn source_label(source: SubscriptionSource) -> &'static str {
    match source {
        SubscriptionSource::GoogleForm => "Google Forms",
        SubscriptionSource::OnSite => "현장 신청",
        SubscriptionSource::LegacyXlsx => "기존 XLSX",
        SubscriptionSource::Manual => "직접 등록",
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[derive(Default)]
    struct MemoryRepository {
        operator: Option<String>,
        records: Vec<ManagedPersonRecord>,
        changes: Vec<ChangeLog>,
    }

    impl PeopleManagementRepository for MemoryRepository {
        fn migrate(&mut self) -> Result<(), PortError> {
            Ok(())
        }
        fn current_operator(&self) -> Result<Option<String>, PortError> {
            Ok(self.operator.clone())
        }
        fn list_people(
            &self,
            _: &str,
            include_archived: bool,
        ) -> Result<Vec<ManagedPersonRecord>, PortError> {
            Ok(self
                .records
                .iter()
                .filter(|item| include_archived || item.person.status != PersonStatus::Archived)
                .cloned()
                .collect())
        }
        fn load_person(&self, id: &str) -> Result<Option<ManagedPersonRecord>, PortError> {
            Ok(self
                .records
                .iter()
                .find(|item| item.person.id == id)
                .cloned())
        }
        fn duplicate_candidates(
            &self,
            name: &str,
            cohort: Option<&str>,
            phone: Option<&str>,
            excluding: Option<&str>,
        ) -> Result<Vec<Person>, PortError> {
            Ok(self
                .records
                .iter()
                .filter(|item| {
                    Some(item.person.id.as_str()) != excluding
                        && item.person.name == name
                        && item.person.cohort.as_deref() == cohort
                        && (phone.is_none() || item.person.normalized_phone.as_deref() == phone)
                })
                .map(|item| item.person.clone())
                .collect())
        }
        fn save_person_with_subscription(
            &mut self,
            person: &Person,
            subscription: &Subscription,
            changes: &[ChangeLog],
        ) -> Result<(), PortError> {
            self.records.push(ManagedPersonRecord {
                person: person.clone(),
                subscriptions: vec![subscription.clone()],
                distributions: vec![],
            });
            self.changes.extend_from_slice(changes);
            Ok(())
        }
        fn update_person(&mut self, person: &Person, change: &ChangeLog) -> Result<(), PortError> {
            self.records
                .iter_mut()
                .find(|item| item.person.id == person.id)
                .unwrap()
                .person = person.clone();
            self.changes.push(change.clone());
            Ok(())
        }
        fn save_subscription(
            &mut self,
            subscription: &Subscription,
            change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.records
                .iter_mut()
                .find(|item| item.person.id == subscription.person_id)
                .unwrap()
                .subscriptions
                .push(subscription.clone());
            self.changes.push(change.clone());
            Ok(())
        }
    }

    struct FixedRuntime(Cell<u32>);
    impl Clock for FixedRuntime {
        fn now(&self) -> String {
            "2026-07-26T10:00:00+09:00".into()
        }
        fn today(&self) -> String {
            "2026-07-26".into()
        }
    }
    impl IdGenerator for FixedRuntime {
        fn next_id(&self) -> String {
            let next = self.0.get() + 1;
            self.0.set(next);
            format!("generated-{next}")
        }
    }

    fn services(runtime: &FixedRuntime) -> RuntimeServices<'_, FixedRuntime, FixedRuntime> {
        RuntimeServices {
            clock: runtime,
            ids: runtime,
        }
    }

    #[test]
    fn registers_full_person_and_six_issue_subscription_with_two_changes() {
        let mut repository = MemoryRepository {
            operator: Some("가상담당자".into()),
            ..Default::default()
        };
        let runtime = FixedRuntime(Cell::new(0));
        let id = register_person(
            &mut repository,
            &services(&runtime),
            RegisterPersonRequest {
                name: "가상정식".into(),
                cohort: Some("00".into()),
                phone: Some("010-0000-1234".into()),
                special_note: Some("두 권 신청".into()),
                issue_year: 2026,
                issue_month: 7,
                quantity: 2,
                applied_at: Some("2026-07-26".into()),
                memo: None,
                confirm_duplicate: false,
            },
        )
        .unwrap();
        let record = repository.load_person(&id).unwrap().unwrap();
        assert_eq!(record.person.status, PersonStatus::Active);
        assert_eq!(
            record.subscriptions[0].last_issue().unwrap(),
            Issue::new(2027, 5).unwrap()
        );
        assert_eq!(repository.changes.len(), 2);
    }

    #[test]
    fn completing_draft_and_renewing_preserves_history_and_warns_on_overlap() {
        let runtime = FixedRuntime(Cell::new(0));
        let now = runtime.now();
        let person = Person {
            id: "person-1".into(),
            name: "가상간이".into(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Draft,
            special_note: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let old = annual_subscription(NewSubscription {
            id: "sub-1".into(),
            person_id: person.id.clone(),
            start_issue: Issue::new(2026, 7).unwrap(),
            quantity: 1,
            applied_at: None,
            source: SubscriptionSource::OnSite,
            memo: None,
            now: &now,
        })
        .unwrap();
        let mut repository = MemoryRepository {
            operator: Some("가상담당자".into()),
            records: vec![ManagedPersonRecord {
                person,
                subscriptions: vec![old],
                distributions: vec![],
            }],
            changes: vec![],
        };
        update_person(
            &mut repository,
            &services(&runtime),
            UpdatePersonRequest {
                person_id: "person-1".into(),
                name: "가상정식".into(),
                cohort: Some("00".into()),
                phone: Some("010-0000-9999".into()),
                special_note: None,
                confirm_duplicate: false,
            },
        )
        .unwrap();
        assert_eq!(repository.records[0].person.status, PersonStatus::Active);

        let request = RenewSubscriptionRequest {
            person_id: "person-1".into(),
            issue_year: 2027,
            issue_month: 1,
            quantity: 1,
            applied_at: None,
            memo: None,
            confirm_overlap: false,
        };
        assert!(matches!(
            renew_subscription(&mut repository, &services(&runtime), request),
            Err(ApplicationError::OverlappingSubscriptionConfirmationRequired)
        ));
        assert_eq!(repository.records[0].subscriptions.len(), 1);
    }

    #[test]
    fn duplicate_registration_requires_explicit_confirmation() {
        let runtime = FixedRuntime(Cell::new(0));
        let now = runtime.now();
        let person = Person {
            id: "person-1".into(),
            name: "가상중복".into(),
            cohort: Some("00".into()),
            phone: Some("010-0000-1111".into()),
            normalized_phone: Some("01000001111".into()),
            status: PersonStatus::Active,
            special_note: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let mut repository = MemoryRepository {
            operator: Some("가상담당자".into()),
            records: vec![ManagedPersonRecord {
                person,
                subscriptions: vec![],
                distributions: vec![],
            }],
            changes: vec![],
        };
        let result = register_person(
            &mut repository,
            &services(&runtime),
            RegisterPersonRequest {
                name: "가상중복".into(),
                cohort: Some("00".into()),
                phone: Some("01000001111".into()),
                special_note: None,
                issue_year: 2026,
                issue_month: 7,
                quantity: 1,
                applied_at: None,
                memo: None,
                confirm_duplicate: false,
            },
        );
        assert!(matches!(
            result,
            Err(ApplicationError::DuplicatePersonConfirmationRequired)
        ));
    }
}
