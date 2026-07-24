use qt_application::{MigrationReport, PortError};
use qt_domain::DATABASE_SCHEMA_VERSION;
use rusqlite::{Connection, OptionalExtension};

const VERSION_1: &str = "
CREATE TABLE IF NOT EXISTS phase0_people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cohort TEXT NOT NULL CHECK(length(cohort) = 2)
);
";

const VERSION_2: &str = "
CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) > 0),
    cohort TEXT CHECK(cohort IS NULL OR (length(cohort) = 2 AND cohort GLOB '[0-9][0-9]')),
    phone TEXT,
    normalized_phone TEXT,
    status TEXT NOT NULL CHECK(status IN ('active', 'draft', 'archived')),
    special_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    start_issue_year INTEGER NOT NULL CHECK(start_issue_year > 0),
    start_issue_month INTEGER NOT NULL CHECK(start_issue_month IN (1, 3, 5, 7, 9, 11)),
    issue_count INTEGER NOT NULL CHECK(issue_count > 0),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    applied_at TEXT,
    source TEXT NOT NULL CHECK(source IN ('google_form', 'on_site', 'legacy_xlsx', 'manual')),
    source_reference TEXT,
    memo TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE TABLE distributions (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
    issue_year INTEGER NOT NULL CHECK(issue_year > 0),
    issue_month INTEGER NOT NULL CHECK(issue_month IN (1, 3, 5, 7, 9, 11)),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    distributed_at TEXT NOT NULL,
    note TEXT,
    reversal_of TEXT REFERENCES distributions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE one_time_purchases (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id),
    buyer_name TEXT,
    issue_year INTEGER NOT NULL CHECK(issue_year > 0),
    issue_month INTEGER NOT NULL CHECK(issue_month IN (1, 3, 5, 7, 9, 11)),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    purchased_at TEXT NOT NULL,
    note TEXT,
    reversal_of TEXT REFERENCES one_time_purchases(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE quick_notes (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    status TEXT NOT NULL CHECK(status IN ('open', 'completed', 'archived')),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE operational_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    active_from TEXT NOT NULL,
    active_until TEXT,
    is_pinned INTEGER NOT NULL CHECK(is_pinned IN (0, 1)),
    status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE TABLE change_logs (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    operator_name TEXT NOT NULL CHECK(length(trim(operator_name)) > 0),
    action_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT
);

CREATE TABLE import_batches (
    id TEXT PRIMARY KEY,
    import_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_file_name TEXT,
    source_hash TEXT NOT NULL,
    format_version INTEGER,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    success_count INTEGER NOT NULL DEFAULT 0 CHECK(success_count >= 0),
    warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0)
);

CREATE TABLE import_rows (
    id TEXT PRIMARY KEY,
    import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
    row_number INTEGER NOT NULL CHECK(row_number > 0),
    status TEXT NOT NULL CHECK(status IN ('success', 'warning', 'failure')),
    reason TEXT
);

CREATE TABLE restore_points (
    id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    source_file_name TEXT,
    created_at TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    app_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    restored_at TEXT
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_people_name ON people(name);
CREATE INDEX idx_people_cohort ON people(cohort);
CREATE INDEX idx_people_normalized_phone ON people(normalized_phone);
CREATE INDEX idx_subscriptions_person ON subscriptions(person_id);
CREATE INDEX idx_subscriptions_issue ON subscriptions(start_issue_year, start_issue_month);
CREATE INDEX idx_distributions_subscription_issue
    ON distributions(subscription_id, issue_year, issue_month);
CREATE INDEX idx_change_logs_occurred_at ON change_logs(occurred_at DESC);
CREATE UNIQUE INDEX idx_subscriptions_source_reference
    ON subscriptions(source, source_reference)
    WHERE source_reference IS NOT NULL;
";

pub(crate) fn configure(connection: &Connection) -> Result<(), PortError> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(port_error)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(port_error)?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(port_error)
}

pub(crate) fn migrate(connection: &mut Connection) -> Result<MigrationReport, PortError> {
    let transaction = connection.transaction().map_err(port_error)?;
    transaction
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            ",
        )
        .map_err(port_error)?;

    let current: Option<u16> = transaction
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(port_error)?
        .flatten();
    if current.unwrap_or(0) > DATABASE_SCHEMA_VERSION {
        return Err(PortError::new(format!(
            "현재 앱보다 새로운 SQLite 스키마입니다: {}",
            current.unwrap_or(0)
        )));
    }

    let mut newly_applied = 0;
    for (version, sql) in [(1_u16, VERSION_1), (2_u16, VERSION_2)] {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
                [version],
                |row| row.get(0),
            )
            .map_err(port_error)?;
        if !exists {
            transaction.execute_batch(sql).map_err(port_error)?;
            transaction
                .execute(
                    "
                    INSERT INTO schema_migrations(version, applied_at)
                    VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    ",
                    [version],
                )
                .map_err(port_error)?;
            newly_applied += 1;
        }
    }
    transaction.commit().map_err(port_error)?;
    Ok(MigrationReport {
        schema_version: DATABASE_SCHEMA_VERSION,
        newly_applied,
    })
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!(
        "SQLite 스키마 마이그레이션에 실패했습니다: {error}"
    ))
}
