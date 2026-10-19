use qt_domain::{
    ChangeLog, Issue, Person, PersonStatus, Subscription, SubscriptionSource, format_phone,
    normalize_phone,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::{
    ApplicationError, Clock, IdGenerator, PeopleManagementRepository, PortError, RuntimeServices,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardColumnMapping {
    pub submitted_at: Option<usize>,
    pub name: usize,
    pub cohort: usize,
    pub phone: usize,
    pub start_issue: usize,
    pub quantity: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedApplicationRow {
    pub row_number: usize,
    pub submitted_at: Option<String>,
    pub name: Option<String>,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub start_issue: Option<Issue>,
    pub quantity: Option<u32>,
    pub fingerprint: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClipboardParseResult {
    pub rows: Vec<ParsedApplicationRow>,
    pub detected_mapping: Option<ClipboardColumnMapping>,
    pub needs_mapping: bool,
    pub ignored_payment_column: bool,
}

pub trait ApplicationClipboardParser {
    fn parse(
        &self,
        text: &str,
        default_issue_year: i32,
        mapping: Option<ClipboardColumnMapping>,
    ) -> ClipboardParseResult;
}

pub trait ApplicationImportRepository {
    fn source_reference_exists(&self, fingerprint: &str) -> Result<bool, PortError>;
    fn save_application_import(
        &mut self,
        batch: &ApplicationImportBatch,
        rows: &[ApplicationImportRecord],
    ) -> Result<(), PortError>;
}

#[derive(Clone, Debug)]
pub struct ApplicationImportBatch {
    pub id: String,
    pub source_hash: String,
    pub operator_name: String,
    pub started_at: String,
    pub completed_at: String,
    pub change: ChangeLog,
}

#[derive(Clone, Debug)]
pub struct ApplicationImportRecord {
    pub row_number: usize,
    pub person: Option<Person>,
    pub subscription: Subscription,
    pub changes: Vec<ChangeLog>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewApplicationsRequest {
    pub text: String,
    pub default_issue_year: i32,
    pub mapping: Option<ClipboardColumnMapping>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationsPreview {
    pub rows: Vec<ApplicationPreviewRow>,
    pub detected_mapping: Option<ClipboardColumnMappingView>,
    pub needs_mapping: bool,
    pub ignored_payment_column: bool,
    pub ready_count: u32,
    pub warning_count: u32,
    pub error_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardColumnMappingView {
    pub submitted_at: Option<usize>,
    pub name: usize,
    pub cohort: usize,
    pub phone: usize,
    pub start_issue: usize,
    pub quantity: usize,
}

impl From<ClipboardColumnMapping> for ClipboardColumnMappingView {
    fn from(mapping: ClipboardColumnMapping) -> Self {
        Self {
            submitted_at: mapping.submitted_at.map(|index| index + 1),
            name: mapping.name + 1,
            cohort: mapping.cohort + 1,
            phone: mapping.phone + 1,
            start_issue: mapping.start_issue + 1,
            quantity: mapping.quantity + 1,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationPreviewRow {
    pub row_number: usize,
    pub submitted_at: Option<String>,
    pub name: Option<String>,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub issue_year: Option<i32>,
    pub issue_month: Option<u8>,
    pub issue_label: Option<String>,
    pub quantity: Option<u32>,
    pub fingerprint: Option<String>,
    pub status: String,
    pub message: String,
    pub candidates: Vec<ApplicationPersonCandidate>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationPersonCandidate {
    pub person_id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportApplicationsRequest {
    pub rows: Vec<ImportApplicationRowRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportApplicationRowRequest {
    pub row_number: usize,
    pub submitted_at: Option<String>,
    pub name: String,
    pub cohort: String,
    pub phone: String,
    pub issue_year: i32,
    pub issue_month: u8,
    pub quantity: u32,
    pub fingerprint: String,
    pub existing_person_id: Option<String>,
    pub create_as_new: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportApplicationsResult {
    pub imported_count: u32,
    pub new_people_count: u32,
    pub existing_people_count: u32,
}

pub fn preview_applications<P, R>(
    parser: &P,
    repository: &mut R,
    request: PreviewApplicationsRequest,
) -> Result<ApplicationsPreview, ApplicationError>
where
    P: ApplicationClipboardParser,
    R: PeopleManagementRepository + ApplicationImportRepository,
{
    PeopleManagementRepository::migrate(repository)?;
    let parsed = parser.parse(&request.text, request.default_issue_year, request.mapping);
    let mut rows = Vec::with_capacity(parsed.rows.len());
    let mut ready_count = 0;
    let mut warning_count = 0;
    let mut error_count = 0;
    let mut seen_fingerprints = HashSet::new();

    for row in parsed.rows {
        let mut view = preview_row(&row);
        if let Some(error) = &row.error {
            view.status = "error".into();
            view.message = error.clone();
            error_count += 1;
        } else if let Some(fingerprint) = &row.fingerprint {
            if !seen_fingerprints.insert(fingerprint.clone()) {
                view.status = "already_imported".into();
                view.message = "붙여넣은 내용 안에 같은 행이 있습니다.".into();
                warning_count += 1;
            } else if repository.source_reference_exists(fingerprint)? {
                view.status = "already_imported".into();
                view.message = "이미 추가한 행입니다.".into();
                warning_count += 1;
            } else {
                add_candidates(
                    repository,
                    &row,
                    &mut view,
                    &mut ready_count,
                    &mut warning_count,
                )?;
            }
        } else {
            add_candidates(
                repository,
                &row,
                &mut view,
                &mut ready_count,
                &mut warning_count,
            )?;
        }
        rows.push(view);
    }

    if parsed.needs_mapping && rows.is_empty() {
        error_count = 1;
    }
    Ok(ApplicationsPreview {
        rows,
        detected_mapping: parsed.detected_mapping.map(Into::into),
        needs_mapping: parsed.needs_mapping,
        ignored_payment_column: parsed.ignored_payment_column,
        ready_count,
        warning_count,
        error_count,
    })
}

pub fn import_applications<R, C, I>(
    repository: &mut R,
    runtime: &RuntimeServices<C, I>,
    request: ImportApplicationsRequest,
) -> Result<ImportApplicationsResult, ApplicationError>
where
    R: PeopleManagementRepository + ApplicationImportRepository,
    C: Clock,
    I: IdGenerator,
{
    PeopleManagementRepository::migrate(repository)?;
    let operator = repository
        .current_operator()?
        .filter(|name| !name.trim().is_empty())
        .ok_or(ApplicationError::MissingOperator)?;
    if request.rows.is_empty() {
        return Err(ApplicationError::NoApplicationRowsSelected);
    }
    let now = runtime.clock.now();
    let mut records = Vec::with_capacity(request.rows.len());
    let mut new_people_count = 0;
    let mut existing_people_count = 0;
    let mut fingerprints = Vec::with_capacity(request.rows.len());
    let mut seen_fingerprints = HashSet::new();

    for row in request.rows {
        validate_import_row(&row)?;
        if !seen_fingerprints.insert(row.fingerprint.clone())
            || repository.source_reference_exists(&row.fingerprint)?
        {
            return Err(ApplicationError::ApplicationAlreadyImported(row.row_number));
        }
        fingerprints.push(row.fingerprint.clone());
        let existing = match &row.existing_person_id {
            Some(person_id) => {
                repository
                    .load_person(person_id)?
                    .ok_or(ApplicationError::MissingDeskRecord)?
                    .person
            }
            None if row.create_as_new => {
                new_people_count += 1;
                Person {
                    cohort_not_applicable: false,
                    is_group: false,
                    id: runtime.ids.next_id(),
                    name: row.name.trim().into(),
                    cohort: Some(row.cohort.clone()),
                    phone: Some(
                        format_phone(&row.phone)?
                            .ok_or(ApplicationError::InvalidApplicationRow(row.row_number))?,
                    ),
                    normalized_phone: Some(normalize_phone(&row.phone)),
                    status: PersonStatus::Active,
                    person_note: None,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                }
            }
            None => {
                return Err(ApplicationError::ApplicationCandidateChoiceRequired(
                    row.row_number,
                ));
            }
        };
        if row.existing_person_id.is_some() {
            existing_people_count += 1;
        }
        existing.validate()?;
        let subscription = Subscription {
            payment_status: Some(qt_domain::PaymentStatus::Pending),
            id: runtime.ids.next_id(),
            person_id: existing.id.clone(),
            start_issue: Issue::new(row.issue_year, row.issue_month)?,
            issue_count: 6,
            quantity: row.quantity,
            applied_at: row.submitted_at.clone(),
            source: SubscriptionSource::GoogleForm,
            source_reference: Some(row.fingerprint),
            memo: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            archived_at: None,
        };
        subscription.validate()?;
        let mut changes = Vec::new();
        let person = if row.existing_person_id.is_none() {
            changes.push(change(
                runtime.ids.next_id(),
                &now,
                &operator,
                "person_created",
                "person",
                &existing.id,
                "스프레드시트에서 QT 신청자 생성",
            ));
            Some(existing)
        } else {
            None
        };
        changes.push(change(
            runtime.ids.next_id(),
            &now,
            &operator,
            "subscription_created_from_google_form",
            "subscription",
            &subscription.id,
            "스프레드시트에서 연간 구독 생성",
        ));
        records.push(ApplicationImportRecord {
            row_number: row.row_number,
            person,
            subscription,
            changes,
        });
    }
    fingerprints.sort();
    let batch_id = runtime.ids.next_id();
    let batch = ApplicationImportBatch {
        id: batch_id.clone(),
        source_hash: stable_fingerprint(&fingerprints.join("|")),
        operator_name: operator.clone(),
        started_at: now.clone(),
        completed_at: now.clone(),
        change: change(
            runtime.ids.next_id(),
            &now,
            &operator,
            "google_form_applications_imported",
            "import_batch",
            &batch_id,
            &format!("스프레드시트 {}건 가져오기", records.len()),
        ),
    };
    repository.save_application_import(&batch, &records)?;
    Ok(ImportApplicationsResult {
        imported_count: records.len() as u32,
        new_people_count,
        existing_people_count,
    })
}

fn add_candidates<R: PeopleManagementRepository>(
    repository: &R,
    row: &ParsedApplicationRow,
    view: &mut ApplicationPreviewRow,
    ready_count: &mut u32,
    warning_count: &mut u32,
) -> Result<(), ApplicationError> {
    let normalized_phone = row.phone.as_deref().map(normalize_phone);
    let candidates = repository.duplicate_candidates(
        row.name.as_deref().unwrap_or_default(),
        row.cohort.as_deref(),
        normalized_phone.as_deref(),
        None,
    )?;
    view.candidates = candidates
        .into_iter()
        .map(|person| ApplicationPersonCandidate {
            person_id: person.id,
            name: person.name,
            cohort: person.cohort,
            phone: person.phone,
        })
        .collect();
    if view.candidates.is_empty() {
        view.status = "ready".into();
        view.message = "새 QT 신청자로 추가할 수 있습니다.".into();
        *ready_count += 1;
    } else {
        view.status = "candidate".into();
        view.message = "기존 신청자 후보를 확인해 주세요.".into();
        *warning_count += 1;
    }
    Ok(())
}

fn preview_row(row: &ParsedApplicationRow) -> ApplicationPreviewRow {
    ApplicationPreviewRow {
        row_number: row.row_number,
        submitted_at: row.submitted_at.clone(),
        name: row.name.clone(),
        cohort: row.cohort.clone(),
        phone: row.phone.clone(),
        issue_year: row.start_issue.map(|issue| issue.year),
        issue_month: row.start_issue.map(|issue| issue.start_month),
        issue_label: row.start_issue.map(Issue::display_name),
        quantity: row.quantity,
        fingerprint: row.fingerprint.clone(),
        status: String::new(),
        message: String::new(),
        candidates: Vec::new(),
    }
}

fn validate_import_row(row: &ImportApplicationRowRequest) -> Result<(), ApplicationError> {
    if row.name.trim().is_empty()
        || row.cohort.len() != 2
        || !row.cohort.bytes().all(|value| value.is_ascii_digit())
        || format_phone(&row.phone).ok().flatten().is_none()
        || row.quantity == 0
        || row.fingerprint.trim().is_empty()
    {
        return Err(ApplicationError::InvalidApplicationRow(row.row_number));
    }
    Issue::new(row.issue_year, row.issue_month)?;
    Ok(())
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

pub fn stable_fingerprint(value: &str) -> String {
    // 중복 방지 식별자일 뿐 보안 해시가 아니므로 새 의존성 없이 고정 FNV-1a를 사용한다.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}:{}", value.len())
}
