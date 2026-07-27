use std::path::Path;

use qt_domain::{
    ChangeLog, CheckItem, Distribution, OneTimePurchase, Person, PinnedNoteStatus, Subscription,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{AppLogger, ApplicationError, PortError};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSetting {
    pub key: String,
    pub value: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePinnedNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
    pub status: PinnedNoteStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub legacy_active_from: Option<String>,
    pub legacy_active_until: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSnapshot {
    pub settings: Vec<StateSetting>,
    pub people: Vec<Person>,
    pub subscriptions: Vec<Subscription>,
    pub distributions: Vec<Distribution>,
    pub purchases: Vec<OneTimePurchase>,
    pub check_items: Vec<CheckItem>,
    pub pinned_notes: Vec<StatePinnedNote>,
    pub changes: Vec<ChangeLog>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateCounts {
    pub people: usize,
    pub subscriptions: usize,
    pub distributions: usize,
    pub purchases: usize,
    pub check_items: usize,
    pub pinned_notes: usize,
    pub changes: usize,
}

impl StateSnapshot {
    pub fn counts(&self) -> StateCounts {
        StateCounts {
            people: self.people.len(),
            subscriptions: self.subscriptions.len(),
            distributions: self.distributions.len(),
            purchases: self.purchases.len(),
            check_items: self.check_items.len(),
            pinned_notes: self.pinned_notes.len(),
            changes: self.changes.len(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    Replace,
    Merge,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePersonConflict {
    pub incoming_person_id: String,
    pub incoming_name: String,
    pub incoming_cohort: Option<String>,
    pub incoming_phone: Option<String>,
    pub existing_person_id: String,
    pub existing_name: String,
    pub existing_cohort: Option<String>,
    pub existing_phone: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergePersonResolution {
    KeepSeparate {
        incoming_person_id: String,
    },
    LinkToExisting {
        incoming_person_id: String,
        existing_person_id: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub format_version: u16,
    pub app_version: String,
    pub created_at: String,
    pub counts: StateCounts,
    pub add_count: usize,
    pub update_count: usize,
    pub keep_count: usize,
    pub person_conflicts: Vec<MergePersonConflict>,
    pub clock_skew_warning: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStateImportRequest {
    pub source_path: String,
    pub source_file_name: String,
    pub backup_path: String,
    pub mode: ImportMode,
    pub person_resolutions: Vec<MergePersonResolution>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePointView {
    pub id: String,
    pub source_file_name: String,
    pub created_at: String,
    pub snapshot_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateWorkbookMetadata {
    pub format_version: u16,
    pub app_version: String,
    pub created_at: String,
}

pub trait StateWorkbookV1 {
    fn write_state(
        &self,
        path: &Path,
        snapshot: &StateSnapshot,
        app_version: &str,
        created_at: &str,
    ) -> Result<(), PortError>;
    fn read_state(&self, path: &Path) -> Result<(StateWorkbookMetadata, StateSnapshot), PortError>;
}

pub trait StateTransferRepository {
    fn load_state(&mut self) -> Result<StateSnapshot, PortError>;
    fn apply_state(
        &mut self,
        incoming: &StateSnapshot,
        mode: ImportMode,
        resolutions: &[MergePersonResolution],
        restore: &RestorePointView,
    ) -> Result<(), PortError>;
    fn latest_restore_point(&mut self) -> Result<Option<RestorePointView>, PortError>;
    fn restore_state(
        &mut self,
        snapshot: &StateSnapshot,
        restore_point_id: &str,
        restored_at: &str,
    ) -> Result<(), PortError>;
    fn prune_restore_points(&mut self, keep: usize) -> Result<(), PortError>;
}

pub fn export_state<R, W, L>(
    repository: &mut R,
    workbook: &W,
    logger: &L,
    path: &Path,
    app_version: &str,
    now: &str,
) -> Result<StateCounts, ApplicationError>
where
    R: StateTransferRepository,
    W: StateWorkbookV1,
    L: AppLogger,
{
    logger.info("state_export_started");
    let result = (|| {
        let snapshot = repository.load_state()?;
        let counts = snapshot.counts();
        workbook.write_state(path, &snapshot, app_version, now)?;
        Ok(counts)
    })();
    match result {
        Ok(value) => {
            logger.info("state_export_completed");
            Ok(value)
        }
        Err(error) => {
            logger.error("state_export_failed");
            Err(error)
        }
    }
}

pub fn preview_state_import<R, W>(
    repository: &mut R,
    workbook: &W,
    path: &Path,
    now: &str,
) -> Result<ImportPreview, ApplicationError>
where
    R: StateTransferRepository,
    W: StateWorkbookV1,
{
    let current = repository.load_state()?;
    let (metadata, incoming) = workbook.read_state(path)?;
    if metadata.format_version != qt_domain::STATE_XLSX_FORMAT_VERSION {
        return Err(ApplicationError::UnsupportedStateFormat(
            metadata.format_version,
        ));
    }
    let (add_count, update_count, keep_count) = compare_snapshots(&current, &incoming);
    Ok(ImportPreview {
        format_version: metadata.format_version,
        app_version: metadata.app_version,
        created_at: metadata.created_at.clone(),
        counts: incoming.counts(),
        add_count,
        update_count,
        keep_count,
        person_conflicts: find_person_conflicts(&current.people, &incoming.people),
        clock_skew_warning: clock_skew_warning(now, &metadata.created_at),
    })
}

pub fn apply_state_import<R, W, L>(
    repository: &mut R,
    workbook: &W,
    logger: &L,
    request: &ApplyStateImportRequest,
    restore_id: String,
    now: String,
) -> Result<StateCounts, ApplicationError>
where
    R: StateTransferRepository,
    W: StateWorkbookV1,
    L: AppLogger,
{
    logger.info("state_import_started");
    let result = (|| {
        let source_path = Path::new(&request.source_path);
        let (metadata, incoming) = workbook.read_state(source_path)?;
        if metadata.format_version != qt_domain::STATE_XLSX_FORMAT_VERSION {
            return Err(ApplicationError::UnsupportedStateFormat(
                metadata.format_version,
            ));
        }
        if request.mode == ImportMode::Merge {
            let current = repository.load_state()?;
            let conflicts = find_person_conflicts(&current.people, &incoming.people);
            if conflicts.iter().any(|conflict| {
                !request
                    .person_resolutions
                    .iter()
                    .any(|resolution| resolution.incoming_id() == conflict.incoming_person_id)
            }) {
                return Err(ApplicationError::UnresolvedPersonConflicts);
            }
        }

        let current = repository.load_state()?;
        workbook.write_state(
            Path::new(&request.backup_path),
            &current,
            env!("CARGO_PKG_VERSION"),
            &now,
        )?;
        let restore = RestorePointView {
            id: restore_id,
            source_file_name: request.source_file_name.clone(),
            created_at: now,
            snapshot_path: request.backup_path.clone(),
        };
        repository.apply_state(
            &incoming,
            request.mode,
            &request.person_resolutions,
            &restore,
        )?;
        // 최근 10개면 한 해의 통상 인수인계·시험 작업을 충분히 되돌릴 수 있으면서
        // 개인정보가 든 자동 백업이 제한 없이 쌓이는 것을 막는다.
        if repository.prune_restore_points(10).is_err() {
            // 가져오기 본 트랜잭션은 이미 성공했으므로 오래된 백업 정리 실패를
            // 전체 가져오기 실패로 오인시키지 않고 별도 운영 이벤트로 남긴다.
            logger.error("restore_point_prune_failed");
        }
        Ok(repository.load_state()?.counts())
    })();
    match result {
        Ok(value) => {
            logger.info("state_import_completed");
            Ok(value)
        }
        Err(error) => {
            logger.error("state_import_failed");
            Err(error)
        }
    }
}

pub fn undo_state_import<R, W, L>(
    repository: &mut R,
    workbook: &W,
    logger: &L,
    now: &str,
) -> Result<RestorePointView, ApplicationError>
where
    R: StateTransferRepository,
    W: StateWorkbookV1,
    L: AppLogger,
{
    logger.info("state_import_undo_started");
    let result = (|| {
        let restore = repository
            .latest_restore_point()?
            .ok_or(ApplicationError::NoStateImportToUndo)?;
        let (_, snapshot) = workbook.read_state(Path::new(&restore.snapshot_path))?;
        repository.restore_state(&snapshot, &restore.id, now)?;
        Ok(restore)
    })();
    match result {
        Ok(value) => {
            logger.info("state_import_undo_completed");
            Ok(value)
        }
        Err(error) => {
            logger.error("state_import_undo_failed");
            Err(error)
        }
    }
}

impl MergePersonResolution {
    fn incoming_id(&self) -> &str {
        match self {
            Self::KeepSeparate { incoming_person_id }
            | Self::LinkToExisting {
                incoming_person_id, ..
            } => incoming_person_id,
        }
    }
}

fn find_person_conflicts(current: &[Person], incoming: &[Person]) -> Vec<MergePersonConflict> {
    incoming
        .iter()
        .filter(|person| !current.iter().any(|item| item.id == person.id))
        .filter_map(|person| {
            current
                .iter()
                .find(|candidate| likely_same_person(candidate, person))
                .map(|candidate| MergePersonConflict {
                    incoming_person_id: person.id.clone(),
                    incoming_name: person.name.clone(),
                    incoming_cohort: person.cohort.clone(),
                    incoming_phone: person.phone.clone(),
                    existing_person_id: candidate.id.clone(),
                    existing_name: candidate.name.clone(),
                    existing_cohort: candidate.cohort.clone(),
                    existing_phone: candidate.phone.clone(),
                })
        })
        .collect()
}

fn likely_same_person(left: &Person, right: &Person) -> bool {
    left.name.trim() == right.name.trim()
        && left.cohort == right.cohort
        && left.normalized_phone.is_some()
        && left.normalized_phone == right.normalized_phone
}

fn compare_snapshots(current: &StateSnapshot, incoming: &StateSnapshot) -> (usize, usize, usize) {
    let mut totals = (0, 0, 0);
    compare_records(
        &current.people,
        &incoming.people,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    compare_records(
        &current.subscriptions,
        &incoming.subscriptions,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    compare_records(
        &current.distributions,
        &incoming.distributions,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    compare_records(
        &current.purchases,
        &incoming.purchases,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    compare_records(
        &current.check_items,
        &incoming.check_items,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    compare_records(
        &current.pinned_notes,
        &incoming.pinned_notes,
        |value| &value.id,
        |value| &value.updated_at,
        &mut totals,
    );
    totals
}

fn compare_records<T, I, U>(
    current: &[T],
    incoming: &[T],
    id: I,
    updated_at: U,
    totals: &mut (usize, usize, usize),
) where
    I: Fn(&T) -> &str,
    U: Fn(&T) -> &str,
{
    for record in incoming {
        match current.iter().find(|item| id(item) == id(record)) {
            None => totals.0 += 1,
            Some(existing) if is_newer(updated_at(record), updated_at(existing)) => totals.1 += 1,
            Some(_) => totals.2 += 1,
        }
    }
}

pub fn is_newer(candidate: &str, existing: &str) -> bool {
    match (
        OffsetDateTime::parse(candidate, &time::format_description::well_known::Rfc3339),
        OffsetDateTime::parse(existing, &time::format_description::well_known::Rfc3339),
    ) {
        (Ok(candidate), Ok(existing)) => candidate > existing,
        _ => candidate > existing,
    }
}


