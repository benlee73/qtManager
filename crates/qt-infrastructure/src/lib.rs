mod sqlite_core_repository;
mod sqlite_migrations;
mod sqlite_probe_repository;
mod state_xlsx;

pub use sqlite_core_repository::SqliteCoreRepository;
pub use sqlite_probe_repository::SqliteProbeRepository;
pub use state_xlsx::XlsxStateWorkbook;

use qt_application::AppLogger;

#[derive(Default)]
pub struct StderrEventLogger;

impl AppLogger for StderrEventLogger {
    fn info(&self, event: &'static str) {
        eprintln!("INFO event={event}");
    }

    fn error(&self, event: &'static str) {
        eprintln!("ERROR event={event}");
    }
}
