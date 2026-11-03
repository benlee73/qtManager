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

const VERSION_3: &str = "
ALTER TABLE people RENAME COLUMN special_note TO person_note;

CREATE TABLE check_items (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    status TEXT NOT NULL CHECK(status IN ('needs_check', 'checked', 'archived')),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    checked_at TEXT
);

INSERT INTO check_items(
    id, person_id, content, status, operator_name, created_at, updated_at, checked_at
)
SELECT id, person_id, content,
       CASE status
           WHEN 'open' THEN 'needs_check'
           WHEN 'completed' THEN 'checked'
           ELSE 'archived'
       END,
       operator_name, created_at, updated_at, completed_at
FROM quick_notes;

DROP TABLE quick_notes;

CREATE TABLE pinned_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    is_pinned INTEGER NOT NULL CHECK(is_pinned IN (0, 1)),
    status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    legacy_active_from TEXT,
    legacy_active_until TEXT
);

INSERT INTO pinned_notes(
    id, title, content, is_pinned, status, operator_name, created_at, updated_at,
    archived_at, legacy_active_from, legacy_active_until
)
SELECT id, title, content, is_pinned, status, operator_name, created_at, updated_at,
       archived_at, active_from, active_until
FROM operational_notes;

DROP TABLE operational_notes;

CREATE INDEX idx_check_items_status_updated
    ON check_items(status, updated_at DESC);
CREATE INDEX idx_check_items_person
    ON check_items(person_id);
CREATE INDEX idx_pinned_notes_status_pinned
    ON pinned_notes(status, is_pinned DESC, updated_at DESC);
";

const VERSION_4: &str = "
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id),
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    legacy_source TEXT,
    legacy_title TEXT
);

CREATE INDEX idx_memos_status_updated ON memos(status, updated_at DESC, id DESC);
CREATE INDEX idx_memos_person_status ON memos(person_id, status, updated_at DESC, id DESC);

INSERT INTO memos(
    id, person_id, content, status, operator_name, created_at, updated_at,
    archived_at, legacy_source, legacy_title
)
SELECT
    'legacy-person:' || id,
    id,
    trim(person_note),
    'active',
    '이전 데이터',
    created_at,
    updated_at,
    NULL,
    'person_note',
    NULL
FROM people
WHERE person_note IS NOT NULL AND length(trim(person_note)) > 0;

INSERT INTO memos(
    id, person_id, content, status, operator_name, created_at, updated_at,
    archived_at, legacy_source, legacy_title
)
SELECT
    'legacy-check:' || id,
    person_id,
    trim(content),
    CASE WHEN status = 'needs_check' THEN 'active' ELSE 'archived' END,
    operator_name,
    created_at,
    updated_at,
    CASE WHEN status = 'needs_check' THEN NULL ELSE COALESCE(checked_at, updated_at) END,
    'check_item',
    NULL
FROM check_items;

INSERT INTO memos(
    id, person_id, content, status, operator_name, created_at, updated_at,
    archived_at, legacy_source, legacy_title
)
SELECT
    'legacy-pinned:' || id,
    NULL,
    CASE WHEN length(trim(content)) > 0 THEN trim(title) || char(10) || trim(content)
         ELSE trim(title) END,
    status,
    operator_name,
    created_at,
    updated_at,
    archived_at,
    CASE WHEN is_pinned = 1 THEN 'pinned_note:pinned' ELSE 'pinned_note' END,
    title
FROM pinned_notes;
";

// Older XLSX files sometimes stored a valid 010 number as digits only or
// without consistent separators. Normalize only values that are unambiguous;
// leave other legacy text untouched so migration never destroys evidence.
const VERSION_5: &str = "
UPDATE people
SET
    phone = '010-' || substr(replace(replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '.', ''), '(', ''), ')', ''), 4, 4)
        || '-' || substr(replace(replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '.', ''), '(', ''), ')', ''), 8, 4),
    normalized_phone = replace(replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '.', ''), '(', ''), ')', '')
WHERE length(replace(replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '.', ''), '(', ''), ')', '')) = 11
  AND substr(replace(replace(replace(replace(replace(COALESCE(phone, ''), '-', ''), ' ', ''), '.', ''), '(', ''), ')', ''), 1, 3) = '010';
";

// Existing records remain outside the new payment queue. Group identity is
// stored independently of its display name so later edits cannot change rules.
const VERSION_6: &str = "
ALTER TABLE people ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0 CHECK(is_group IN (0, 1));
ALTER TABLE subscriptions ADD COLUMN payment_status TEXT CHECK(payment_status IN ('pending', 'confirmed'));
ALTER TABLE one_time_purchases ADD COLUMN payment_status TEXT CHECK(payment_status IN ('pending', 'confirmed'));
ALTER TABLE one_time_purchases ADD COLUMN is_group_distribution INTEGER NOT NULL DEFAULT 0 CHECK(is_group_distribution IN (0, 1));
INSERT INTO change_logs (id, occurred_at, operator_name, action_type, entity_type, entity_id, summary)
SELECT 'schema6-group:' || id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '데이터 이전', 'group_recipient_migrated', 'person', id, '군지체 권수 기록 대상으로 전환'
FROM people WHERE name = '군지체' OR (name LIKE '군지체(%' AND substr(name, -1) = ')');
UPDATE people SET is_group = 1, name = '군지체', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE name = '군지체' OR (name LIKE '군지체(%' AND substr(name, -1) = ')');
CREATE INDEX idx_subscriptions_payment ON subscriptions(payment_status, person_id);
CREATE INDEX idx_purchases_payment ON one_time_purchases(payment_status, person_id);
";

const VERSION_7: &str = "ALTER TABLE people ADD COLUMN cohort_not_applicable INTEGER NOT NULL DEFAULT 0 CHECK(cohort_not_applicable IN (0, 1)); ALTER TABLE one_time_purchases ADD COLUMN correction_of TEXT REFERENCES one_time_purchases(id); CREATE UNIQUE INDEX idx_purchase_correction ON one_time_purchases(correction_of) WHERE correction_of IS NOT NULL;";

const VERSION_8: &str = "ALTER TABLE one_time_purchases ADD COLUMN delivery_records TEXT;";

pub(crate) fn configure(connection: &Connection) -> Result<(), PortError> {
    connection
        .create_scalar_function(
            "qt_matches",
            2,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let text: String = ctx.get(0)?;
                let query: String = ctx.get(1)?;
                Ok(qt_domain::matches_korean(&text, &query))
            },
        )
        .map_err(port_error)?;
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

fn backup_before_upgrade(connection: &Connection) -> Result<(), PortError> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')", [], |row| row.get(0)).map_err(port_error)?;
    if !exists {
        return Ok(());
    }
    let version: Option<u16> = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .map_err(port_error)?;
    if version.is_none_or(|version| version == 0 || version >= DATABASE_SCHEMA_VERSION) {
        return Ok(());
    }
    let Some(path) = connection.path().filter(|path| !path.is_empty()) else {
        return Ok(());
    };
    let backup = std::path::Path::new(path).with_extension(format!(
        "pre-schema{}-{}.sqlite",
        DATABASE_SCHEMA_VERSION,
        uuid::Uuid::new_v4()
    ));
    // VACUUM INTO captures a consistent SQLite snapshot including WAL contents.
    // Refuse the migration if this local safety copy cannot be written.
    connection
        .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
        .map_err(port_error)?;
    Ok(())
}

pub(crate) fn migrate(connection: &mut Connection) -> Result<MigrationReport, PortError> {
    backup_before_upgrade(connection)?;
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
    for (version, sql) in [
        (1_u16, VERSION_1),
        (2_u16, VERSION_2),
        (3_u16, VERSION_3),
        (4_u16, VERSION_4),
        (5_u16, VERSION_5),
        (6_u16, VERSION_6),
        (7_u16, VERSION_7),
        (8_u16, VERSION_8),
    ] {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_four_preserves_legacy_records_as_memos() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations VALUES (1, '2026-07-01T00:00:00Z');
                INSERT INTO schema_migrations VALUES (2, '2026-07-01T00:00:00Z');
                ",
            )
            .unwrap();
        connection.execute_batch(VERSION_1).unwrap();
        connection.execute_batch(VERSION_2).unwrap();
        connection
            .execute_batch(
                "
                INSERT INTO people VALUES (
                    'person-1', '가상 신청자', '00', NULL, NULL, 'active',
                    '지속 참고', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'
                );
                INSERT INTO quick_notes VALUES (
                    'item-1', 'person-1', '수량 확인', 'completed', '가상담당자',
                    '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z',
                    '2026-07-02T00:00:00Z'
                );
                INSERT INTO operational_notes VALUES (
                    'note-1', '보관 위치', '가상 선반', '2026-07-01', '2026-09-30',
                    1, 'active', '가상담당자', '2026-07-01T00:00:00Z',
                    '2026-07-02T00:00:00Z', NULL
                );
                ",
            )
            .unwrap();

        let report = migrate(&mut connection).unwrap();

        assert_eq!(report.newly_applied, 6);
        let person_note: String = connection
            .query_row(
                "SELECT person_note FROM people WHERE id = 'person-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(person_note, "지속 참고");
        let item: (String, String, String) = connection
            .query_row(
                "SELECT person_id, status, checked_at FROM check_items WHERE id = 'item-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            item,
            (
                "person-1".into(),
                "checked".into(),
                "2026-07-02T00:00:00Z".into()
            )
        );
        let periods: (String, String) = connection
            .query_row(
                "SELECT legacy_active_from, legacy_active_until
                 FROM pinned_notes WHERE id = 'note-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(periods, ("2026-07-01".into(), "2026-09-30".into()));
        let memo_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM memos", [], |row| row.get(0))
            .unwrap();
        assert_eq!(memo_count, 3);
        let memo_status: String = connection
            .query_row(
                "SELECT status FROM memos WHERE id = 'legacy-check:item-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(memo_status, "archived");
    }

    #[test]
    fn version_six_preserves_legacy_records_and_creates_a_consistent_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.sqlite");
        let mut connection = Connection::open(&path).unwrap();
        configure(&connection).unwrap();
        for sql in [VERSION_1, VERSION_2, VERSION_3, VERSION_4, VERSION_5] {
            connection.execute_batch(sql).unwrap();
        }
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1,'2026-01-01'),(2,'2026-01-01'),(3,'2026-01-01'),(4,'2026-01-01'),(5,'2026-01-01');
        INSERT INTO people VALUES ('group', '군지체(가상담당)', '00', NULL, NULL, 'active', NULL, '2026-01-01', '2026-01-01');
        INSERT INTO subscriptions VALUES ('subscription', 'group', 2026, 1, 6, 1, NULL, 'legacy_xlsx', NULL, NULL, '2026-01-01', '2026-01-01', NULL);
        INSERT INTO one_time_purchases VALUES ('purchase', NULL, NULL, 2026, 1, 1, '2026-01-01', NULL, NULL, '2026-01-01', '2026-01-01');").unwrap();
        let report = migrate(&mut connection).unwrap();
        assert_eq!(report.newly_applied, 3);
        let person: (String, bool, String) = connection
            .query_row(
                "SELECT name, is_group, cohort FROM people WHERE id = 'group'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(person, ("군지체".into(), true, "00".into()));
        let pending: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM subscriptions WHERE payment_status IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 0);
        let pending: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM one_time_purchases WHERE payment_status IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 0);
        let backup_path = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.to_string_lossy().contains("pre-schema8-"))
            .unwrap();
        let backup = Connection::open(backup_path).unwrap();
        let old_name: String = backup
            .query_row("SELECT name FROM people WHERE id = 'group'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(old_name, "군지체(가상담당)");
        let old_version: u16 = backup
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(old_version, 5);
        assert_eq!(migrate(&mut connection).unwrap().newly_applied, 0);
    }

    #[test]
    fn version_five_formats_unambiguous_010_numbers_without_touching_other_text() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(VERSION_1).unwrap();
        connection.execute_batch(VERSION_2).unwrap();
        connection
            .execute_batch(
                "
                INSERT INTO people VALUES
                    ('person-1', '가상 신청자', '00', '01012345678', NULL, 'active', NULL, '2026-07-01', '2026-07-01'),
                    ('person-2', '다른 신청자', '01', '02-1234-5678', NULL, 'active', NULL, '2026-07-01', '2026-07-01');
                ",
            )
            .unwrap();
        connection.execute_batch(VERSION_5).unwrap();

        let phone: String = connection
            .query_row(
                "SELECT phone FROM people WHERE id = 'person-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let normalized: String = connection
            .query_row(
                "SELECT normalized_phone FROM people WHERE id = 'person-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let other: String = connection
            .query_row(
                "SELECT phone FROM people WHERE id = 'person-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(phone, "010-1234-5678");
        assert_eq!(normalized, "01012345678");
        assert_eq!(other, "02-1234-5678");
    }
}
