use std::collections::HashMap;

use qt_application::{CoreRepository, DeskRecord, DistributionDeskRepository, PortError};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, Issue, OneTimePurchase, Person,
    PinnedNote, PinnedNoteStatus, Subscription,
};
use rusqlite::{OptionalExtension, Row, params};

use crate::SqliteCoreRepository;
use crate::sqlite_core_repository::{
    distribution_from_row, person_from_row, subscription_from_row, upsert_change,
};

impl DistributionDeskRepository for SqliteCoreRepository {
    fn migrate(&mut self) -> Result<(), PortError> {
        self.migrate_core().map(|_| ())
    }

    fn current_operator(&self) -> Result<Option<String>, PortError> {
        self.connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'current_operator_name'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(port_error)
    }

    fn save_operator(&mut self, name: &str, now: &str) -> Result<(), PortError> {
        self.connection
            .execute(
                "
                INSERT INTO app_settings(key, value, created_at, updated_at)
                VALUES ('current_operator_name', ?1, ?2, ?2)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                ",
                params![name, now],
            )
            .map_err(port_error)?;
        Ok(())
    }

    fn list_desk_records(&self, query: &str, issue: Issue) -> Result<Vec<DeskRecord>, PortError> {
        let normalized = query.split_whitespace().collect::<String>().to_lowercase();
        let phone_query = normalized
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        let mut people_statement = self
            .connection
            .prepare(&format!(
                "
                SELECT id, name, cohort, phone, normalized_phone, status, person_note,
                       created_at, updated_at
                FROM people p
                WHERE p.status != 'archived' AND ({})
                ORDER BY p.name, p.id
                ",
                search_predicate("p")
            ))
            .map_err(port_error)?;
        let people = people_statement
            .query_map(params![normalized, phone_query], person_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)?;
        drop(people_statement);

        let mut subscriptions = subscriptions_by_person(&self.connection, query)?;
        let mut distributions = distributions_by_subscription(&self.connection, query, issue)?;
        let item_people = needs_check_people(&self.connection)?;
        Ok(people
            .into_iter()
            .map(|person| {
                let person_subscriptions = subscriptions.remove(&person.id).unwrap_or_default();
                let person_distributions = person_subscriptions
                    .iter()
                    .flat_map(|subscription| {
                        distributions.remove(&subscription.id).unwrap_or_default()
                    })
                    .collect();
                let has_check_item = item_people.contains_key(&person.id);
                DeskRecord {
                    person,
                    subscriptions: person_subscriptions,
                    distributions: person_distributions,
                    has_check_item,
                }
            })
            .collect())
    }

    fn save_distribution(
        &mut self,
        distribution: &Distribution,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        self.record_distribution(distribution, change)
    }

    fn latest_reversible_distribution(
        &self,
        issue: Issue,
    ) -> Result<Option<Distribution>, PortError> {
        self.connection
            .query_row(
                "
                SELECT d.id, d.subscription_id, d.issue_year, d.issue_month, d.quantity,
                       d.distributed_at, d.note, d.reversal_of, d.created_at, d.updated_at
                FROM distributions d
                WHERE d.issue_year = ?1 AND d.issue_month = ?2
                  AND d.reversal_of IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM distributions reversal WHERE reversal.reversal_of = d.id
                  )
                ORDER BY d.distributed_at DESC, d.rowid DESC
                LIMIT 1
                ",
                params![issue.year, issue.start_month],
                distribution_from_row,
            )
            .optional()
            .map_err(port_error)
    }

    fn latest_reversible_distribution_for_subscription(
        &self,
        issue: Issue,
        subscription_id: &str,
    ) -> Result<Option<Distribution>, PortError> {
        self.connection
            .query_row(
                "
                SELECT d.id, d.subscription_id, d.issue_year, d.issue_month, d.quantity,
                       d.distributed_at, d.note, d.reversal_of, d.created_at, d.updated_at
                FROM distributions d
                WHERE d.issue_year = ?1 AND d.issue_month = ?2
                  AND d.subscription_id = ?3
                  AND d.reversal_of IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM distributions reversal WHERE reversal.reversal_of = d.id
                  )
                ORDER BY d.distributed_at DESC, d.rowid DESC
                LIMIT 1
                ",
                params![issue.year, issue.start_month, subscription_id],
                distribution_from_row,
            )
            .optional()
            .map_err(port_error)
    }

    fn save_draft(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        self.register_subscription(person, subscription, change)
    }

    fn list_check_items(&self) -> Result<Vec<CheckItem>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, content, status, operator_name, created_at, updated_at,
                       checked_at
                FROM check_items
                WHERE status != 'archived'
                ORDER BY updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([], check_item_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn list_archived_check_items(&self) -> Result<Vec<CheckItem>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, content, status, operator_name, created_at, updated_at,
                       checked_at
                FROM check_items
                WHERE status = 'archived'
                ORDER BY updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([], check_item_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn save_check_item(&mut self, item: &CheckItem, change: &ChangeLog) -> Result<(), PortError> {
        item.validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute(
                "
                INSERT INTO check_items(
                    id, person_id, content, status, operator_name, created_at, updated_at,
                    checked_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(id) DO UPDATE SET
                    person_id = excluded.person_id,
                    content = excluded.content,
                    status = excluded.status,
                    operator_name = excluded.operator_name,
                    updated_at = excluded.updated_at,
                    checked_at = excluded.checked_at
                ",
                params![
                    item.id,
                    item.person_id,
                    item.content,
                    check_item_status(item.status),
                    item.operator_name,
                    item.created_at,
                    item.updated_at,
                    item.checked_at
                ],
            )
            .map_err(port_error)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn list_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, title, content, is_pinned, status, operator_name,
                       created_at, updated_at, archived_at
                FROM pinned_notes
                WHERE status != 'archived'
                ORDER BY is_pinned DESC, updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([], pinned_note_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn list_archived_pinned_notes(&self) -> Result<Vec<PinnedNote>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, title, content, is_pinned, status, operator_name,
                       created_at, updated_at, archived_at
                FROM pinned_notes
                WHERE status = 'archived'
                ORDER BY updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([], pinned_note_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn save_pinned_note(&mut self, note: &PinnedNote, change: &ChangeLog) -> Result<(), PortError> {
        note.validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute(
                "
                INSERT INTO pinned_notes(
                    id, title, content, is_pinned, status, operator_name,
                    created_at, updated_at, archived_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    is_pinned = excluded.is_pinned,
                    status = excluded.status,
                    operator_name = excluded.operator_name,
                    updated_at = excluded.updated_at,
                    archived_at = excluded.archived_at
                ",
                params![
                    note.id,
                    note.title,
                    note.content,
                    note.is_pinned,
                    pinned_note_status(note.status),
                    note.operator_name,
                    note.created_at,
                    note.updated_at,
                    note.archived_at
                ],
            )
            .map_err(port_error)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn save_purchase(
        &mut self,
        purchase: &OneTimePurchase,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        purchase
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute(
                "
                INSERT INTO one_time_purchases(
                    id, person_id, buyer_name, issue_year, issue_month, quantity, purchased_at,
                    note, reversal_of, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(id) DO UPDATE SET
                    person_id = excluded.person_id,
                    buyer_name = excluded.buyer_name,
                    issue_year = excluded.issue_year,
                    issue_month = excluded.issue_month,
                    quantity = excluded.quantity,
                    purchased_at = excluded.purchased_at,
                    note = excluded.note,
                    reversal_of = excluded.reversal_of,
                    updated_at = excluded.updated_at
                ",
                params![
                    purchase.id,
                    purchase.person_id,
                    purchase.buyer_name,
                    purchase.issue.year,
                    purchase.issue.start_month,
                    purchase.quantity,
                    purchase.purchased_at,
                    purchase.note,
                    purchase.reversal_of,
                    purchase.created_at,
                    purchase.updated_at
                ],
            )
            .map_err(port_error)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn latest_reversible_purchase(
        &self,
        issue: Issue,
    ) -> Result<Option<OneTimePurchase>, PortError> {
        self.connection
            .query_row(
                "
                SELECT p.id, p.person_id, p.buyer_name, p.issue_year, p.issue_month, p.quantity,
                       p.purchased_at, p.note, p.reversal_of, p.created_at, p.updated_at
                FROM one_time_purchases p
                WHERE p.issue_year = ?1 AND p.issue_month = ?2
                  AND p.reversal_of IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM one_time_purchases reversal WHERE reversal.reversal_of = p.id
                  )
                ORDER BY p.purchased_at DESC, p.rowid DESC
                LIMIT 1
                ",
                params![issue.year, issue.start_month],
                purchase_from_row,
            )
            .optional()
            .map_err(port_error)
    }

    fn purchase_summary(&self, issue: Issue) -> Result<(u32, u32), PortError> {
        self.connection
            .query_row(
                "
                SELECT COUNT(*), COALESCE(SUM(p.quantity), 0)
                FROM one_time_purchases p
                WHERE p.issue_year = ?1 AND p.issue_month = ?2
                  AND p.reversal_of IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM one_time_purchases reversal WHERE reversal.reversal_of = p.id
                  )
                ",
                params![issue.year, issue.start_month],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(port_error)
    }
}

fn subscriptions_by_person(
    connection: &rusqlite::Connection,
    query: &str,
) -> Result<HashMap<String, Vec<Subscription>>, PortError> {
    let normalized = query.split_whitespace().collect::<String>().to_lowercase();
    let phone_query = normalized
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    let mut statement = connection
        .prepare(&format!(
            "
            SELECT s.id, s.person_id, s.start_issue_year, s.start_issue_month, s.issue_count,
                   s.quantity, s.applied_at, s.source, s.source_reference, s.memo,
                   s.created_at, s.updated_at, s.archived_at
            FROM subscriptions s
            JOIN people p ON p.id = s.person_id
            WHERE p.status != 'archived' AND s.archived_at IS NULL AND ({})
            ORDER BY s.start_issue_year, s.start_issue_month, s.id
            ",
            search_predicate("p")
        ))
        .map_err(port_error)?;
    let subscriptions = statement
        .query_map(params![normalized, phone_query], subscription_from_row)
        .map_err(port_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_error)?;
    let mut result: HashMap<String, Vec<Subscription>> = HashMap::new();
    for subscription in subscriptions {
        result
            .entry(subscription.person_id.clone())
            .or_default()
            .push(subscription);
    }
    Ok(result)
}

fn distributions_by_subscription(
    connection: &rusqlite::Connection,
    query: &str,
    issue: Issue,
) -> Result<HashMap<String, Vec<Distribution>>, PortError> {
    let normalized = query.split_whitespace().collect::<String>().to_lowercase();
    let phone_query = normalized
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    let mut statement = connection
        .prepare(&format!(
            "
            SELECT d.id, d.subscription_id, d.issue_year, d.issue_month, d.quantity,
                   d.distributed_at, d.note, d.reversal_of, d.created_at, d.updated_at
            FROM distributions d
            JOIN subscriptions s ON s.id = d.subscription_id
            JOIN people p ON p.id = s.person_id
            WHERE d.issue_year = ?3 AND d.issue_month = ?4 AND ({})
            ORDER BY d.created_at, d.id
            ",
            search_predicate("p")
        ))
        .map_err(port_error)?;
    let distributions = statement
        .query_map(
            params![normalized, phone_query, issue.year, issue.start_month],
            distribution_from_row,
        )
        .map_err(port_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_error)?;
    let mut result: HashMap<String, Vec<Distribution>> = HashMap::new();
    for distribution in distributions {
        result
            .entry(distribution.subscription_id.clone())
            .or_default()
            .push(distribution);
    }
    Ok(result)
}

fn search_predicate(alias: &str) -> String {
    format!(
        "
        ?1 = ''
        OR lower(replace({alias}.name, ' ', '')) LIKE '%' || ?1 || '%'
        OR coalesce({alias}.cohort, '') LIKE '%' || ?1 || '%'
        OR coalesce({alias}.cohort, '') || lower(replace({alias}.name, ' ', ''))
            LIKE '%' || ?1 || '%'
        OR (?2 != '' AND coalesce({alias}.normalized_phone, '') LIKE '%' || ?2 || '%')
        "
    )
}

fn needs_check_people(
    connection: &rusqlite::Connection,
) -> Result<HashMap<String, bool>, PortError> {
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT person_id FROM check_items
             WHERE status = 'needs_check' AND person_id IS NOT NULL",
        )
        .map_err(port_error)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(port_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(port_error)?;
    Ok(ids.into_iter().map(|id| (id, true)).collect())
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
            value => return Err(invalid_enum("check item status", value)),
        },
        operator_name: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        checked_at: row.get(7)?,
    })
}

fn pinned_note_from_row(row: &Row<'_>) -> rusqlite::Result<PinnedNote> {
    Ok(PinnedNote {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        is_pinned: row.get(3)?,
        status: match row.get::<_, String>(4)?.as_str() {
            "active" => PinnedNoteStatus::Active,
            "archived" => PinnedNoteStatus::Archived,
            value => return Err(invalid_enum("pinned note status", value)),
        },
        operator_name: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        archived_at: row.get(8)?,
    })
}

fn purchase_from_row(row: &Row<'_>) -> rusqlite::Result<OneTimePurchase> {
    let year = row.get(3)?;
    let month = row.get(4)?;
    Ok(OneTimePurchase {
        id: row.get(0)?,
        person_id: row.get(1)?,
        buyer_name: row.get(2)?,
        issue: Issue::new(year, month).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Integer,
                error.to_string().into(),
            )
        })?,
        quantity: row.get(5)?,
        purchased_at: row.get(6)?,
        note: row.get(7)?,
        reversal_of: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn check_item_status(status: CheckItemStatus) -> &'static str {
    match status {
        CheckItemStatus::NeedsCheck => "needs_check",
        CheckItemStatus::Checked => "checked",
        CheckItemStatus::Archived => "archived",
    }
}

fn pinned_note_status(status: PinnedNoteStatus) -> &'static str {
    match status {
        PinnedNoteStatus::Active => "active",
        PinnedNoteStatus::Archived => "archived",
    }
}

fn invalid_enum(field: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("알 수 없는 {field}: {value}").into(),
    )
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!(
        "SQLite 현장 배부 데이터 처리에 실패했습니다: {error}"
    ))
}
