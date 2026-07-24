use std::path::Path;

use qt_application::{PortError, ProbeRepository};
use qt_domain::ProbePerson;
use rusqlite::{Connection, OptionalExtension, params};

pub struct SqliteProbeRepository {
    connection: Connection,
}

impl SqliteProbeRepository {
    pub fn open(path: &Path) -> Result<Self, PortError> {
        let connection = Connection::open(path).map_err(port_error)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(port_error)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(port_error)?;
        Ok(Self { connection })
    }
}

impl ProbeRepository for SqliteProbeRepository {
    fn migrate(&mut self) -> Result<(), PortError> {
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS phase0_people (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    cohort TEXT NOT NULL CHECK(length(cohort) = 2)
                );
                INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                ",
            )
            .map_err(port_error)?;
        transaction.commit().map_err(port_error)
    }

    fn replace_person(&mut self, person: &ProbePerson) -> Result<(), PortError> {
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute(
                "
                INSERT INTO phase0_people(id, name, cohort)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, cohort = excluded.cohort
                ",
                params![person.id, person.name, person.cohort],
            )
            .map_err(port_error)?;
        transaction.commit().map_err(port_error)
    }

    fn find_person(&self, id: &str) -> Result<Option<ProbePerson>, PortError> {
        self.connection
            .query_row(
                "SELECT id, name, cohort FROM phase0_people WHERE id = ?1",
                [id],
                |row| {
                    Ok(ProbePerson {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        cohort: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(port_error)
    }
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!("SQLite 기술 검증에 실패했습니다: {error}"))
}
