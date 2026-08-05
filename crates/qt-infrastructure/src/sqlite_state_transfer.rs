use qt_application::{
    ImportMode, MergePersonResolution, PortError, RestorePointView, StatePinnedNote, StateSetting,
    StateSnapshot, StateTransferRepository, merge_snapshots,
};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Issue, Memo, MemoStatus, OneTimePurchase,
    PinnedNoteStatus,
};
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};

use crate::{
    SqliteCoreRepository,
    sqlite_core_repository::{
        change_from_row, distribution_from_row, person_from_row, subscription_from_row,
        upsert_change, upsert_distribution, upsert_person, upsert_subscription,
    },
};

pub struct SqliteStateTransfer<'a> {
    repository: &'a mut SqliteCoreRepository,
}

impl<'a> SqliteStateTransfer<'a> {
    pub fn new(repository: &'a mut SqliteCoreRepository) -> Self {
        Self { repository }
    }
}

impl StateTransferRepository for SqliteStateTransfer<'_> {
    fn load_state(&mut self) -> Result<StateSnapshot, PortError> {
        load_snapshot(&self.repository.connection)
    }

    fn apply_state(
        &mut self,
        incoming: &StateSnapshot,
        mode: ImportMode,
        resolutions: &[MergePersonResolution],
        restore: &RestorePointView,
    ) -> Result<(), PortError> {
        let target = match mode {
            ImportMode::Replace => incoming.clone(),
            ImportMode::Merge => {
                let current = load_snapshot(&self.repository.connection)?;
                merge_snapshots(&current, incoming, resolutions)
            }
        };
        let transaction = self
            .repository
            .connection
            .transaction()
            .map_err(sql_error)?;
        insert_restore_point(&transaction, restore, mode)?;
        replace_snapshot(&transaction, &target)?;
        insert_transfer_change(&transaction, restore, mode)?;
        transaction.commit().map_err(sql_error)
    }

    fn latest_restore_point(&mut self) -> Result<Option<RestorePointView>, PortError> {
        let latest = self
            .repository
            .connection
            .query_row(
                "
                SELECT id, COALESCE(source_file_name, ''), created_at, snapshot_path, restored_at
                FROM restore_points
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                ",
                [],
                |row| {
                    Ok((
                        RestorePointView {
                            id: row.get(0)?,
                            source_file_name: row.get(1)?,
                            created_at: row.get(2)?,
                            snapshot_path: row.get(3)?,
                        },
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(sql_error)?;
        Ok(latest.and_then(|(restore, restored_at)| restored_at.is_none().then_some(restore)))
    }

    fn restore_state(
        &mut self,
        snapshot: &StateSnapshot,
        restore_point_id: &str,
        restored_at: &str,
    ) -> Result<(), PortError> {
        let transaction = self
            .repository
            .connection
            .transaction()
            .map_err(sql_error)?;
        replace_snapshot(&transaction, snapshot)?;
        transaction
            .execute(
                "UPDATE restore_points SET restored_at = ?2 WHERE id = ?1",
                params![restore_point_id, restored_at],
            )
            .map_err(sql_error)?;
        let operator = snapshot
            .settings
            .iter()
            .find(|setting| setting.key == "current_operator_name")
            .map(|setting| setting.value.as_str())
            .unwrap_or("담당자");
        upsert_change(
            &transaction,
            &ChangeLog {
                id: format!("restore-{restore_point_id}"),
                occurred_at: restored_at.into(),
                operator_name: operator.into(),
                action_type: "state_import_undone".into(),
                entity_type: "restore_point".into(),
                entity_id: restore_point_id.into(),
                summary: "전체 상태 가져오기 되돌림".into(),
                before_json: None,
                after_json: None,
            },
        )?;
        transaction.commit().map_err(sql_error)
    }

    fn prune_restore_points(&mut self, keep: usize) -> Result<(), PortError> {
        let mut statement = self
            .repository
            .connection
            .prepare(
                "SELECT id, snapshot_path FROM restore_points ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?1",
            )
            .map_err(sql_error)?;
        let old = statement
            .query_map([keep as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        drop(statement);
        let transaction = self
            .repository
            .connection
            .transaction()
            .map_err(sql_error)?;
        for (id, _) in &old {
            transaction
                .execute("DELETE FROM restore_points WHERE id = ?1", [id])
                .map_err(sql_error)?;
        }
        transaction.commit().map_err(sql_error)?;
        for (_, path) in old {
            if let Err(error) = std::fs::remove_file(path)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(PortError::new(format!(
                    "오래된 자동 백업 파일 정리에 실패했습니다: {error}"
                )));
            }
        }
        Ok(())
    }
}

fn load_snapshot(connection: &Connection) -> Result<StateSnapshot, PortError> {
    let mut snapshot = StateSnapshot {
        settings: query_all(
            connection,
            "SELECT key, value, created_at, updated_at FROM app_settings ORDER BY key",
            setting_from_row,
        )?,
        people: query_all(
            connection,
            "SELECT id, name, cohort, phone, normalized_phone, status, person_note, created_at, updated_at FROM people ORDER BY id",
            person_from_row,
        )?,
        subscriptions: query_all(
            connection,
            "SELECT id, person_id, start_issue_year, start_issue_month, issue_count, quantity, applied_at, source, source_reference, memo, created_at, updated_at, archived_at FROM subscriptions ORDER BY id",
            subscription_from_row,
        )?,
        distributions: query_all(
            connection,
            "SELECT id, subscription_id, issue_year, issue_month, quantity, distributed_at, note, reversal_of, created_at, updated_at FROM distributions ORDER BY id",
            distribution_from_row,
        )?,
        purchases: query_all(
            connection,
            "SELECT id, person_id, buyer_name, issue_year, issue_month, quantity, purchased_at, note, reversal_of, created_at, updated_at FROM one_time_purchases ORDER BY id",
            purchase_from_row,
        )?,
        check_items: query_all(
            connection,
            "SELECT id, person_id, content, status, operator_name, created_at, updated_at, checked_at FROM check_items ORDER BY id",
            check_item_from_row,
        )?,
        pinned_notes: query_all(
            connection,
            "SELECT id, title, content, is_pinned, status, operator_name, created_at, updated_at, archived_at, legacy_active_from, legacy_active_until FROM pinned_notes ORDER BY id",
            pinned_note_from_row,
        )?,
        changes: query_all(
            connection,
            "SELECT id, occurred_at, operator_name, action_type, entity_type, entity_id, summary, before_json, after_json FROM change_logs ORDER BY occurred_at, id",
            change_from_row,
        )?,
    };
    let memos = query_all(
        connection,
        "SELECT id, person_id, content, status, operator_name, created_at, updated_at, archived_at, legacy_source, legacy_title FROM memos ORDER BY id",
        memo_from_row,
    )?;
    if !memos.is_empty() {
        for person in &mut snapshot.people {
            person.person_note = None;
        }
        snapshot.check_items.clear();
        snapshot.pinned_notes.clear();
        snapshot_from_memos(&mut snapshot, memos);
    }
    Ok(snapshot)
}

fn query_all<T>(
    connection: &Connection,
    sql: &str,
    parser: fn(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, PortError> {
    let mut statement = connection.prepare(sql).map_err(sql_error)?;
    statement
        .query_map([], parser)
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)
}

fn replace_snapshot(
    transaction: &Transaction<'_>,
    snapshot: &StateSnapshot,
) -> Result<(), PortError> {
    for table in [
        "import_rows",
        "import_batches",
        "change_logs",
        "memos",
        "check_items",
        "pinned_notes",
        "distributions",
        "one_time_purchases",
        "subscriptions",
        "people",
        "app_settings",
    ] {
        transaction
            .execute(&format!("DELETE FROM {table}"), [])
            .map_err(sql_error)?;
    }
    for setting in &snapshot.settings {
        transaction
            .execute(
                "INSERT INTO app_settings(key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![setting.key, setting.value, setting.created_at, setting.updated_at],
            )
            .map_err(sql_error)?;
    }
    for person in &snapshot.people {
        upsert_person(transaction, person)?;
    }
    for subscription in &snapshot.subscriptions {
        upsert_subscription(transaction, subscription)?;
    }
    for distribution in snapshot
        .distributions
        .iter()
        .filter(|value| value.reversal_of.is_none())
        .chain(
            snapshot
                .distributions
                .iter()
                .filter(|value| value.reversal_of.is_some()),
        )
    {
        upsert_distribution(transaction, distribution)?;
    }
    for purchase in snapshot
        .purchases
        .iter()
        .filter(|value| value.reversal_of.is_none())
        .chain(
            snapshot
                .purchases
                .iter()
                .filter(|value| value.reversal_of.is_some()),
        )
    {
        insert_purchase(transaction, purchase)?;
    }
    for item in &snapshot.check_items {
        insert_check_item(transaction, item)?;
    }
    for note in &snapshot.pinned_notes {
        insert_pinned_note(transaction, note)?;
    }
    for memo in snapshot_memos(snapshot) {
        insert_memo(transaction, &memo)?;
    }
    for change in &snapshot.changes {
        upsert_change(transaction, change)?;
    }
    Ok(())
}

fn insert_restore_point(
    transaction: &Transaction<'_>,
    restore: &RestorePointView,
    mode: ImportMode,
) -> Result<(), PortError> {
    transaction
        .execute(
            "
            INSERT INTO restore_points(
                id, reason, source_file_name, created_at, snapshot_path,
                app_version, schema_version, restored_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)
            ",
            params![
                restore.id,
                match mode {
                    ImportMode::Replace => "state_replace",
                    ImportMode::Merge => "state_merge",
                },
                restore.source_file_name,
                restore.created_at,
                restore.snapshot_path,
                env!("CARGO_PKG_VERSION"),
                qt_domain::DATABASE_SCHEMA_VERSION,
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn insert_transfer_change(
    transaction: &Transaction<'_>,
    restore: &RestorePointView,
    mode: ImportMode,
) -> Result<(), PortError> {
    let operator: Option<String> = transaction
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'current_operator_name'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql_error)?;
    upsert_change(
        transaction,
        &ChangeLog {
            id: format!("import-{}", restore.id),
            occurred_at: restore.created_at.clone(),
            operator_name: operator.unwrap_or_else(|| "담당자".into()),
            action_type: match mode {
                ImportMode::Replace => "state_replaced",
                ImportMode::Merge => "state_merged",
            }
            .into(),
            entity_type: "state_import".into(),
            entity_id: restore.id.clone(),
            summary: match mode {
                ImportMode::Replace => "전체 상태 교체 가져오기".into(),
                ImportMode::Merge => "전체 상태 병합 가져오기".into(),
            },
            before_json: None,
            after_json: None,
        },
    )
}

fn insert_purchase(
    transaction: &Transaction<'_>,
    value: &OneTimePurchase,
) -> Result<(), PortError> {
    transaction
        .execute(
            "INSERT INTO one_time_purchases(id, person_id, buyer_name, issue_year, issue_month, quantity, purchased_at, note, reversal_of, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![value.id, value.person_id, value.buyer_name, value.issue.year, value.issue.start_month, value.quantity, value.purchased_at, value.note, value.reversal_of, value.created_at, value.updated_at],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn insert_check_item(transaction: &Transaction<'_>, value: &CheckItem) -> Result<(), PortError> {
    transaction
        .execute(
            "INSERT INTO check_items(id, person_id, content, status, operator_name, created_at, updated_at, checked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![value.id, value.person_id, value.content, check_status(value.status), value.operator_name, value.created_at, value.updated_at, value.checked_at],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn insert_pinned_note(
    transaction: &Transaction<'_>,
    value: &StatePinnedNote,
) -> Result<(), PortError> {
    transaction
        .execute(
            "INSERT INTO pinned_notes(id, title, content, is_pinned, status, operator_name, created_at, updated_at, archived_at, legacy_active_from, legacy_active_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![value.id, value.title, value.content, value.is_pinned, pinned_status(value.status), value.operator_name, value.created_at, value.updated_at, value.archived_at, value.legacy_active_from, value.legacy_active_until],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn insert_memo(transaction: &Transaction<'_>, value: &Memo) -> Result<(), PortError> {
    transaction
        .execute(
            "INSERT INTO memos(id, person_id, content, status, operator_name, created_at, updated_at, archived_at, legacy_source, legacy_title) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                value.id,
                value.person_id,
                value.content,
                memo_status(value.status),
                value.operator_name,
                value.created_at,
                value.updated_at,
                value.archived_at,
                value.legacy_source,
                value.legacy_title,
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn setting_from_row(row: &Row<'_>) -> rusqlite::Result<StateSetting> {
    Ok(StateSetting {
        key: row.get(0)?,
        value: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}
fn purchase_from_row(row: &Row<'_>) -> rusqlite::Result<OneTimePurchase> {
    Ok(OneTimePurchase {
        id: row.get(0)?,
        person_id: row.get(1)?,
        buyer_name: row.get(2)?,
        issue: Issue::new(row.get(3)?, row.get(4)?).map_err(domain_error)?,
        quantity: row.get(5)?,
        purchased_at: row.get(6)?,
        note: row.get(7)?,
        reversal_of: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}
fn check_item_from_row(row: &Row<'_>) -> rusqlite::Result<CheckItem> {
    Ok(CheckItem {
        id: row.get(0)?,
        person_id: row.get(1)?,
        content: row.get(2)?,
        status: match row.get::<_, String>(3)?.as_str() {
            "needs_check" => CheckItemStatus::NeedsCheck,
            "checked" => CheckItemStatus::Checked,
            "archived" => CheckItemStatus::Archived,
            value => return Err(enum_error("check item status", value)),
        },
        operator_name: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        checked_at: row.get(7)?,
    })
}
fn pinned_note_from_row(row: &Row<'_>) -> rusqlite::Result<StatePinnedNote> {
    Ok(StatePinnedNote {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        is_pinned: row.get(3)?,
        status: match row.get::<_, String>(4)?.as_str() {
            "active" => PinnedNoteStatus::Active,
            "archived" => PinnedNoteStatus::Archived,
            value => return Err(enum_error("pinned note status", value)),
        },
        operator_name: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        archived_at: row.get(8)?,
        legacy_active_from: row.get(9)?,
        legacy_active_until: row.get(10)?,
    })
}

fn memo_from_row(row: &Row<'_>) -> rusqlite::Result<Memo> {
    Ok(Memo {
        id: row.get(0)?,
        person_id: row.get(1)?,
        content: row.get(2)?,
        status: match row.get::<_, String>(3)?.as_str() {
            "active" => MemoStatus::Active,
            "archived" => MemoStatus::Archived,
            value => return Err(enum_error("memo status", value)),
        },
        operator_name: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived_at: row.get(7)?,
        legacy_source: row.get(8)?,
        legacy_title: row.get(9)?,
    })
}

fn snapshot_from_memos(snapshot: &mut StateSnapshot, memos: Vec<Memo>) {
    for memo in memos {
        match memo.legacy_source.as_deref() {
            Some("person_note") => {
                if let Some(person_id) = memo.person_id.as_deref()
                    && let Some(person) = snapshot
                        .people
                        .iter_mut()
                        .find(|person| person.id == person_id)
                {
                    person.person_note = Some(memo.content);
                }
            }
            Some("pinned_note") | Some("pinned_note:pinned") => {
                let title = memo.legacy_title.unwrap_or_else(|| "메모".to_string());
                let content = memo
                    .content
                    .strip_prefix(&title)
                    .unwrap_or(&memo.content)
                    .trim_start_matches('\n')
                    .to_string();
                snapshot.pinned_notes.push(StatePinnedNote {
                    id: memo.id,
                    title,
                    content,
                    is_pinned: memo.legacy_source.as_deref() == Some("pinned_note:pinned"),
                    status: if memo.status == MemoStatus::Archived {
                        PinnedNoteStatus::Archived
                    } else {
                        PinnedNoteStatus::Active
                    },
                    operator_name: memo.operator_name,
                    created_at: memo.created_at,
                    updated_at: memo.updated_at,
                    archived_at: memo.archived_at,
                    legacy_active_from: None,
                    legacy_active_until: None,
                });
            }
            _ => {
                snapshot.check_items.push(CheckItem {
                    id: memo.id,
                    person_id: memo.person_id,
                    content: memo.content,
                    status: if memo.status == MemoStatus::Archived {
                        CheckItemStatus::Archived
                    } else {
                        CheckItemStatus::NeedsCheck
                    },
                    operator_name: memo.operator_name,
                    created_at: memo.created_at,
                    updated_at: memo.updated_at,
                    checked_at: memo.archived_at,
                });
            }
        }
    }
}

fn snapshot_memos(snapshot: &StateSnapshot) -> Vec<Memo> {
    let mut memos = Vec::new();
    for person in &snapshot.people {
        if let Some(content) = person
            .person_note
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            memos.push(Memo {
                id: format!("legacy-person:{}", person.id),
                person_id: Some(person.id.clone()),
                content: content.to_string(),
                status: MemoStatus::Active,
                operator_name: "가져온 기록".into(),
                created_at: person.created_at.clone(),
                updated_at: person.updated_at.clone(),
                archived_at: None,
                legacy_source: Some("person_note".into()),
                legacy_title: None,
            });
        }
    }
    for item in &snapshot.check_items {
        memos.push(Memo {
            id: item.id.clone(),
            person_id: item.person_id.clone(),
            content: item.content.clone(),
            status: if item.status == CheckItemStatus::Archived {
                MemoStatus::Archived
            } else {
                MemoStatus::Active
            },
            operator_name: item.operator_name.clone(),
            created_at: item.created_at.clone(),
            updated_at: item.updated_at.clone(),
            archived_at: item.checked_at.clone(),
            legacy_source: Some("check_item".into()),
            legacy_title: None,
        });
    }
    for note in &snapshot.pinned_notes {
        memos.push(Memo {
            id: note.id.clone(),
            person_id: None,
            content: note.content.clone(),
            status: if note.status == PinnedNoteStatus::Archived {
                MemoStatus::Archived
            } else {
                MemoStatus::Active
            },
            operator_name: note.operator_name.clone(),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
            archived_at: note.archived_at.clone(),
            legacy_source: Some(if note.is_pinned {
                "pinned_note:pinned".into()
            } else {
                "pinned_note".into()
            }),
            legacy_title: Some(note.title.clone()),
        });
    }
    memos
}

fn check_status(value: CheckItemStatus) -> &'static str {
    match value {
        CheckItemStatus::NeedsCheck => "needs_check",
        CheckItemStatus::Checked => "checked",
        CheckItemStatus::Archived => "archived",
    }
}
fn pinned_status(value: PinnedNoteStatus) -> &'static str {
    match value {
        PinnedNoteStatus::Active => "active",
        PinnedNoteStatus::Archived => "archived",
    }
}

fn memo_status(value: MemoStatus) -> &'static str {
    match value {
        MemoStatus::Active => "active",
        MemoStatus::Archived => "archived",
    }
}
fn enum_error(field: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("알 수 없는 {field}: {value}").into(),
    )
}
fn domain_error(error: qt_domain::DomainError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Integer,
        error.to_string().into(),
    )
}
fn sql_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!("SQLite 전체 상태 처리에 실패했습니다: {error}"))
}
