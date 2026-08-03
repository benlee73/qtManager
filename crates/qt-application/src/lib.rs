use std::path::Path;

use qt_domain::{ProbePerson, STATE_XLSX_FORMAT_VERSION};
use serde::Serialize;
use thiserror::Error;

mod application_import;
mod phase1;
mod phase2;
mod phase3;
mod phase4;

pub use application_import::{
    ApplicationClipboardParser, ApplicationImportBatch, ApplicationImportRecord,
    ApplicationImportRepository, ApplicationPersonCandidate, ApplicationPreviewRow,
    ApplicationsPreview, ClipboardColumnMapping, ClipboardColumnMappingView, ClipboardParseResult,
    ImportApplicationRowRequest, ImportApplicationsRequest, ImportApplicationsResult,
    ParsedApplicationRow, PreviewApplicationsRequest, import_applications, preview_applications,
    stable_fingerprint,
};
pub use phase1::{CoreRepository, MigrationReport, Phase1Report, RunPhase1Probe};
pub use phase2::{
    CheckItemView, Clock, CreateCheckItemRequest, CreateDraftRequest, CreatePinnedNoteRequest,
    DeskRecord, DistributionDesk, DistributionDeskRepository, IdGenerator, PinnedNoteView,
    RecordDistributionRequest, RecordPurchaseRequest, RuntimeServices, UndoDistributionRequest,
    UndoDistributionResult, UpdateCheckItemStatusRequest, UpdatePinnedNoteRequest,
    cancel_latest_purchase, create_check_item, create_draft, create_pinned_note, delete_check_item,
    delete_pinned_note, load_distribution_desk, record_distribution, record_purchase,
    save_operator, undo_last_distribution, update_check_item_status, update_pinned_note,
};
pub use phase3::{
    DistributionView, DuplicateCandidate, ManagedPersonRecord, PeopleManagement,
    PeopleManagementRepository, PersonDetail, PersonSummary, RegisterPersonRequest,
    RenewSubscriptionRequest, SubscriptionView, UpdatePersonRequest, load_people_management,
    load_person_detail, preview_duplicates, register_person, renew_subscription,
    set_person_archived, update_person,
};
pub use phase4::{
    ApplyStateImportRequest, ImportMode, ImportPreview, MergePersonConflict, MergePersonResolution,
    RestorePointView, StateCounts, StatePinnedNote, StateSetting, StateSnapshot,
    StateTransferRepository, StateWorkbookMetadata, StateWorkbookV1, apply_state_import,
    export_state, merge_snapshots, preview_state_import, undo_state_import,
};

pub trait ProbeRepository {
    fn migrate(&mut self) -> Result<(), PortError>;
    fn replace_person(&mut self, person: &ProbePerson) -> Result<(), PortError>;
    fn find_person(&self, id: &str) -> Result<Option<ProbePerson>, PortError>;
}

pub trait StateWorkbook {
    fn export_person(&self, path: &Path, person: &ProbePerson) -> Result<(), PortError>;
    fn import_people(&self, path: &Path) -> Result<Vec<ProbePerson>, PortError>;
}

pub trait AppLogger {
    fn info(&self, event: &'static str);
    fn error(&self, event: &'static str);
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase0Report {
    pub database: &'static str,
    pub xlsx: &'static str,
    pub format_version: u16,
    pub verified_rows: usize,
}

pub struct RunPhase0Probe<'a, R, W, L> {
    repository: &'a mut R,
    workbook: &'a W,
    logger: &'a L,
}

impl<'a, R, W, L> RunPhase0Probe<'a, R, W, L>
where
    R: ProbeRepository,
    W: StateWorkbook,
    L: AppLogger,
{
    pub fn new(repository: &'a mut R, workbook: &'a W, logger: &'a L) -> Self {
        Self {
            repository,
            workbook,
            logger,
        }
    }

    pub fn execute(&mut self, workbook_path: &Path) -> Result<Phase0Report, ApplicationError> {
        self.logger.info("phase0_probe_started");
        let result = self.execute_inner(workbook_path);
        match result {
            Ok(report) => {
                self.logger.info("phase0_probe_completed");
                Ok(report)
            }
            Err(error) => {
                self.logger.error("phase0_probe_failed");
                Err(error)
            }
        }
    }

    fn execute_inner(&mut self, workbook_path: &Path) -> Result<Phase0Report, ApplicationError> {
        let expected = ProbePerson::anonymous_fixture();
        expected.validate()?;

        self.repository.migrate()?;
        self.repository.replace_person(&expected)?;
        let stored = self
            .repository
            .find_person(&expected.id)?
            .ok_or(ApplicationError::MissingPersistedPerson)?;
        if stored != expected {
            return Err(ApplicationError::DatabaseMismatch);
        }

        self.workbook.export_person(workbook_path, &stored)?;
        let imported = self.workbook.import_people(workbook_path)?;
        if imported.as_slice() != [expected] {
            return Err(ApplicationError::WorkbookMismatch);
        }

        Ok(Phase0Report {
            database: "ok",
            xlsx: "ok",
            format_version: STATE_XLSX_FORMAT_VERSION,
            verified_rows: imported.len(),
        })
    }
}

#[derive(Debug, Error)]
pub enum ApplicationError {
    #[error(transparent)]
    Domain(#[from] qt_domain::DomainError),
    #[error(transparent)]
    Port(#[from] PortError),
    #[error("SQLite에 저장한 익명 검증 행을 다시 찾지 못했습니다.")]
    MissingPersistedPerson,
    #[error("SQLite 저장 전후 데이터가 다릅니다.")]
    DatabaseMismatch,
    #[error("XLSX 내보내기와 다시 가져오기 데이터가 다릅니다.")]
    WorkbookMismatch,
    #[error("SQLite 스키마 버전이 다릅니다. 예상: {expected}, 실제: {actual}")]
    DatabaseSchemaMismatch { expected: u16, actual: u16 },
    #[error("SQLite에 저장한 구독을 다시 찾지 못했습니다.")]
    MissingPersistedSubscription,
    #[error("저장 후 배부 상태가 예상과 다릅니다.")]
    DistributionMismatch,
    #[error("담당자가 포함된 업무 변경 이력이 예상과 다릅니다.")]
    ChangeLogMismatch,
    #[error("현재 담당자 이름을 먼저 설정해 주세요.")]
    MissingOperator,
    #[error("선택한 QT 신청자 또는 구독을 찾지 못했습니다.")]
    MissingDeskRecord,
    #[error("되돌릴 수 있는 최근 배부 기록이 없습니다.")]
    NothingToUndo,
    #[error("취소할 수 있는 최근 현장 개별 구매가 없습니다.")]
    NoPurchaseToCancel,
    #[error("같은 사람일 수 있는 QT 신청자가 있습니다. 후보를 확인한 뒤 계속할지 선택해 주세요.")]
    DuplicatePersonConfirmationRequired,
    #[error("기존 구독과 기간이 겹칩니다. 두 구독을 모두 유지할지 확인해 주세요.")]
    OverlappingSubscriptionConfirmationRequired,
    #[error("추가할 Google 응답 행을 한 개 이상 선택해 주세요.")]
    NoApplicationRowsSelected,
    #[error("{0}행은 이미 추가한 Google 응답입니다.")]
    ApplicationAlreadyImported(usize),
    #[error("{0}행의 기존 신청자 연결 또는 새 신청자 추가 방법을 선택해 주세요.")]
    ApplicationCandidateChoiceRequired(usize),
    #[error("{0}행의 값이 올바르지 않습니다. 미리보기에서 수정해 주세요.")]
    InvalidApplicationRow(usize),
    #[error("지원하지 않는 XLSX 형식 버전입니다: {0}")]
    UnsupportedStateFormat(u16),
    #[error("가져오기 파일에 해결하지 않은 동일인 후보가 있습니다.")]
    UnresolvedPersonConflicts,
    #[error("가져오기를 되돌릴 복원 지점이 없습니다.")]
    NoStateImportToUndo,
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct PortError {
    message: String,
}

impl PortError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::path::Path;

    use super::*;

    #[derive(Default)]
    struct MemoryRepository {
        person: Option<ProbePerson>,
    }

    impl ProbeRepository for MemoryRepository {
        fn migrate(&mut self) -> Result<(), PortError> {
            Ok(())
        }

        fn replace_person(&mut self, person: &ProbePerson) -> Result<(), PortError> {
            self.person = Some(person.clone());
            Ok(())
        }

        fn find_person(&self, id: &str) -> Result<Option<ProbePerson>, PortError> {
            Ok(self.person.clone().filter(|person| person.id == id))
        }
    }

    struct MemoryWorkbook;

    impl StateWorkbook for MemoryWorkbook {
        fn export_person(&self, _path: &Path, _person: &ProbePerson) -> Result<(), PortError> {
            Ok(())
        }

        fn import_people(&self, _path: &Path) -> Result<Vec<ProbePerson>, PortError> {
            Ok(vec![ProbePerson::anonymous_fixture()])
        }
    }

    #[derive(Default)]
    struct RecordingLogger(RefCell<Vec<&'static str>>);

    impl AppLogger for RecordingLogger {
        fn info(&self, event: &'static str) {
            self.0.borrow_mut().push(event);
        }

        fn error(&self, event: &'static str) {
            self.0.borrow_mut().push(event);
        }
    }

    #[test]
    fn runs_storage_and_workbook_round_trip_with_safe_logs() {
        let mut repository = MemoryRepository::default();
        let workbook = MemoryWorkbook;
        let logger = RecordingLogger::default();
        let mut use_case = RunPhase0Probe::new(&mut repository, &workbook, &logger);

        let report = use_case.execute(Path::new("ignored.xlsx")).unwrap();

        assert_eq!(report.format_version, 1);
        assert_eq!(report.verified_rows, 1);
        assert_eq!(
            logger.0.into_inner(),
            vec!["phase0_probe_started", "phase0_probe_completed"]
        );
    }
}
