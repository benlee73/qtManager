use std::path::Path;

use qt_application::{CoreRepository, MigrationReport, PortError};
use qt_domain::{
    ChangeLog, Distribution, Issue, Person, PersonStatus, Subscription, SubscriptionSource,
};
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};

use crate::sqlite_migrations;

pub struct SqliteCoreRepository {
    pub(crate) connection: Connection,
}

impl SqliteCoreRepository {
    pub fn open(path: &Path) -> Result<Self, PortError> {
        let connection = Connection::open(path).map_err(port_error)?;
        sqlite_migrations::configure(&connection)?;
        Ok(Self { connection })
    }
}

impl CoreRepository for SqliteCoreRepository {
    fn migrate_core(&mut self) -> Result<MigrationReport, PortError> {
        sqlite_migrations::migrate(&mut self.connection)
    }

    fn register_subscription(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        person
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        subscription
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;

        let transaction = self.connection.transaction().map_err(port_error)?;
        upsert_person(&transaction, person)?;
        upsert_subscription(&transaction, subscription)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn record_distribution(
        &mut self,
        distribution: &Distribution,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        distribution
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;

        let transaction = self.connection.transaction().map_err(port_error)?;
        upsert_distribution(&transaction, distribution)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn find_person(&self, id: &str) -> Result<Option<Person>, PortError> {
        self.connection
            .query_row(
                "
                SELECT id, name, cohort, phone, normalized_phone, status, person_note,
                       created_at, updated_at
                FROM people
                WHERE id = ?1
                ",
                [id],
                person_from_row,
            )
            .optional()
            .map_err(port_error)
    }

    fn find_subscription(&self, id: &str) -> Result<Option<Subscription>, PortError> {
        self.connection
            .query_row(
                "
                SELECT id, person_id, start_issue_year, start_issue_month, issue_count, quantity,
                       applied_at, source, source_reference, memo, created_at, updated_at, archived_at
                FROM subscriptions
                WHERE id = ?1
                ",
                [id],
                subscription_from_row,
            )
            .optional()
            .map_err(port_error)
    }

    fn list_distributions(
        &self,
        subscription_id: &str,
        issue: Issue,
    ) -> Result<Vec<Distribution>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, subscription_id, issue_year, issue_month, quantity, distributed_at,
                       note, reversal_of, created_at, updated_at
                FROM distributions
                WHERE subscription_id = ?1 AND issue_year = ?2 AND issue_month = ?3
                ORDER BY created_at, id
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map(
                params![subscription_id, issue.year, issue.start_month],
                distribution_from_row,
            )
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn list_changes(&self) -> Result<Vec<ChangeLog>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, occurred_at, operator_name, action_type, entity_type, entity_id,
                       summary, before_json, after_json
                FROM change_logs
                ORDER BY occurred_at, id
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([], change_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }
}

pub(crate) fn upsert_person(
    transaction: &Transaction<'_>,
    person: &Person,
) -> Result<(), PortError> {
    transaction
        .execute(
            "
            INSERT INTO people(
                id, name, cohort, phone, normalized_phone, status, person_note,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                cohort = excluded.cohort,
                phone = excluded.phone,
                normalized_phone = excluded.normalized_phone,
                status = excluded.status,
                person_note = excluded.person_note,
                updated_at = excluded.updated_at
            ",
            params![
                person.id,
                person.name,
                person.cohort,
                person.phone,
                person.normalized_phone,
                person_status(person.status),
                person.person_note,
                person.created_at,
                person.updated_at
            ],
        )
        .map_err(port_error)?;
    Ok(())
}

pub(crate) fn upsert_subscription(
    transaction: &Transaction<'_>,
    subscription: &Subscription,
) -> Result<(), PortError> {
    transaction
        .execute(
            "
            INSERT INTO subscriptions(
                id, person_id, start_issue_year, start_issue_month, issue_count, quantity,
                applied_at, source, source_reference, memo, created_at, updated_at, archived_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
                person_id = excluded.person_id,
                start_issue_year = excluded.start_issue_year,
                start_issue_month = excluded.start_issue_month,
                issue_count = excluded.issue_count,
                quantity = excluded.quantity,
                applied_at = excluded.applied_at,
                source = excluded.source,
                source_reference = excluded.source_reference,
                memo = excluded.memo,
                updated_at = excluded.updated_at,
                archived_at = excluded.archived_at
            ",
            params![
                subscription.id,
                subscription.person_id,
                subscription.start_issue.year,
                subscription.start_issue.start_month,
                subscription.issue_count,
                subscription.quantity,
                subscription.applied_at,
                subscription_source(subscription.source),
                subscription.source_reference,
                subscription.memo,
                subscription.created_at,
                subscription.updated_at,
                subscription.archived_at
            ],
        )
        .map_err(port_error)?;
    Ok(())
}

pub(crate) fn upsert_distribution(
    transaction: &Transaction<'_>,
    distribution: &Distribution,
) -> Result<(), PortError> {
    transaction
        .execute(
            "
            INSERT INTO distributions(
                id, subscription_id, issue_year, issue_month, quantity, distributed_at,
                note, reversal_of, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                subscription_id = excluded.subscription_id,
                issue_year = excluded.issue_year,
                issue_month = excluded.issue_month,
                quantity = excluded.quantity,
                distributed_at = excluded.distributed_at,
                note = excluded.note,
                reversal_of = excluded.reversal_of,
                updated_at = excluded.updated_at
            ",
            params![
                distribution.id,
                distribution.subscription_id,
                distribution.issue.year,
                distribution.issue.start_month,
                distribution.quantity,
                distribution.distributed_at,
                distribution.note,
                distribution.reversal_of,
                distribution.created_at,
                distribution.updated_at
            ],
        )
        .map_err(port_error)?;
    Ok(())
}

pub(crate) fn upsert_change(
    transaction: &Transaction<'_>,
    change: &ChangeLog,
) -> Result<(), PortError> {
    transaction
        .execute(
            "
            INSERT INTO change_logs(
                id, occurred_at, operator_name, action_type, entity_type, entity_id,
                summary, before_json, after_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                occurred_at = excluded.occurred_at,
                operator_name = excluded.operator_name,
                action_type = excluded.action_type,
                entity_type = excluded.entity_type,
                entity_id = excluded.entity_id,
                summary = excluded.summary,
                before_json = excluded.before_json,
                after_json = excluded.after_json
            ",
            params![
                change.id,
                change.occurred_at,
                change.operator_name,
                change.action_type,
                change.entity_type,
                change.entity_id,
                change.summary,
                change.before_json,
                change.after_json
            ],
        )
        .map_err(port_error)?;
    Ok(())
}

pub(crate) fn person_from_row(row: &Row<'_>) -> rusqlite::Result<Person> {
    Ok(Person {
        id: row.get(0)?,
        name: row.get(1)?,
        cohort: row.get(2)?,
        phone: row.get(3)?,
        normalized_phone: row.get(4)?,
        status: parse_person_status(row.get::<_, String>(5)?.as_str())?,
        person_note: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub(crate) fn subscription_from_row(row: &Row<'_>) -> rusqlite::Result<Subscription> {
    let year = row.get(2)?;
    let month = row.get(3)?;
    Ok(Subscription {
        id: row.get(0)?,
        person_id: row.get(1)?,
        start_issue: Issue::new(year, month).map_err(domain_sql_error)?,
        issue_count: row.get(4)?,
        quantity: row.get(5)?,
        applied_at: row.get(6)?,
        source: parse_subscription_source(row.get::<_, String>(7)?.as_str())?,
        source_reference: row.get(8)?,
        memo: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        archived_at: row.get(12)?,
    })
}

pub(crate) fn distribution_from_row(row: &Row<'_>) -> rusqlite::Result<Distribution> {
    let year = row.get(2)?;
    let month = row.get(3)?;
    Ok(Distribution {
        id: row.get(0)?,
        subscription_id: row.get(1)?,
        issue: Issue::new(year, month).map_err(domain_sql_error)?,
        quantity: row.get(4)?,
        distributed_at: row.get(5)?,
        note: row.get(6)?,
        reversal_of: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(crate) fn change_from_row(row: &Row<'_>) -> rusqlite::Result<ChangeLog> {
    Ok(ChangeLog {
        id: row.get(0)?,
        occurred_at: row.get(1)?,
        operator_name: row.get(2)?,
        action_type: row.get(3)?,
        entity_type: row.get(4)?,
        entity_id: row.get(5)?,
        summary: row.get(6)?,
        before_json: row.get(7)?,
        after_json: row.get(8)?,
    })
}

pub(crate) fn person_status(status: PersonStatus) -> &'static str {
    match status {
        PersonStatus::Active => "active",
        PersonStatus::Draft => "draft",
        PersonStatus::Archived => "archived",
    }
}

fn parse_person_status(status: &str) -> rusqlite::Result<PersonStatus> {
    match status {
        "active" => Ok(PersonStatus::Active),
        "draft" => Ok(PersonStatus::Draft),
        "archived" => Ok(PersonStatus::Archived),
        _ => Err(invalid_enum("person status", status)),
    }
}

pub(crate) fn subscription_source(source: SubscriptionSource) -> &'static str {
    match source {
        SubscriptionSource::GoogleForm => "google_form",
        SubscriptionSource::OnSite => "on_site",
        SubscriptionSource::LegacyXlsx => "legacy_xlsx",
        SubscriptionSource::Manual => "manual",
    }
}

fn parse_subscription_source(source: &str) -> rusqlite::Result<SubscriptionSource> {
    match source {
        "google_form" => Ok(SubscriptionSource::GoogleForm),
        "on_site" => Ok(SubscriptionSource::OnSite),
        "legacy_xlsx" => Ok(SubscriptionSource::LegacyXlsx),
        "manual" => Ok(SubscriptionSource::Manual),
        _ => Err(invalid_enum("subscription source", source)),
    }
}

fn invalid_enum(field: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        format!("알 수 없는 {field}: {value}").into(),
    )
}

fn domain_sql_error(error: qt_domain::DomainError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Integer,
        error.to_string().into(),
    )
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!("SQLite 핵심 데이터 처리에 실패했습니다: {error}"))
}
