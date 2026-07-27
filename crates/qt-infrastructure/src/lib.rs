mod clipboard_tsv;
mod sqlite_application_import;
mod sqlite_core_repository;
mod sqlite_distribution_desk;
mod sqlite_migrations;
mod sqlite_people_management;
mod sqlite_probe_repository;
mod sqlite_state_transfer;
mod state_xlsx;
mod system_runtime;

pub use sqlite_core_repository::SqliteCoreRepository;
pub use sqlite_probe_repository::SqliteProbeRepository;
pub use sqlite_state_transfer::SqliteStateTransfer;
pub use state_xlsx::XlsxStateWorkbook;
pub use system_runtime::SystemRuntime;

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
pub use clipboard_tsv::TsvApplicationClipboardParser;
