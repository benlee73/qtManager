use std::path::Path;

use qt_domain::{ProbePerson, STATE_XLSX_FORMAT_VERSION};
use serde::Serialize;
use thiserror::Error;

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
