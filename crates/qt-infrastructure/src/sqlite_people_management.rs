use qt_application::{CoreRepository, ManagedPersonRecord, PeopleManagementRepository, PortError};
use qt_domain::{ChangeLog, CheckItem, Distribution, Memo, Person, Subscription};
use rusqlite::{OptionalExtension, params};
use std::collections::HashMap;

use crate::SqliteCoreRepository;
use crate::sqlite_core_repository::{
    distribution_from_row, person_from_row, subscription_from_row, upsert_change, upsert_person,
    upsert_subscription,
};
use crate::sqlite_distribution_desk::{check_item_from_row, memo_from_row};

impl PeopleManagementRepository for SqliteCoreRepository {
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

    fn list_people(
        &self,
        query: &str,
        include_archived: bool,
    ) -> Result<Vec<ManagedPersonRecord>, PortError> {
        let normalized = query.split_whitespace().collect::<String>().to_lowercase();
        let phone_query = normalized
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, name, cohort, phone, normalized_phone, status, person_note,
                       created_at, updated_at
                FROM people
                WHERE (?1 OR status != 'archived')
                  AND (
                    ?2 = ''
                    OR lower(replace(name, ' ', '')) LIKE '%' || ?2 || '%'
                    OR coalesce(cohort, '') LIKE '%' || ?2 || '%'
                    OR coalesce(cohort, '') || lower(replace(name, ' ', '')) LIKE '%' || ?2 || '%'
                    OR (?3 != '' AND coalesce(normalized_phone, '') LIKE '%' || ?3 || '%')
                  )
                ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
                         name, id
                ",
            )
            .map_err(port_error)?;
        let people = statement
            .query_map(
                params![include_archived, normalized, phone_query],
                person_from_row,
            )
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)?;
        drop(statement);

        let mut subscription_statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, start_issue_year, start_issue_month, issue_count, quantity,
                       applied_at, source, source_reference, memo, created_at, updated_at, archived_at
                FROM subscriptions
                ORDER BY start_issue_year, start_issue_month, created_at
                ",
            )
            .map_err(port_error)?;
        let subscriptions = subscription_statement
            .query_map([], subscription_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<Subscription>, _>>()
            .map_err(port_error)?;
        let mut by_person: HashMap<String, Vec<Subscription>> = HashMap::new();
        for subscription in subscriptions {
            by_person
                .entry(subscription.person_id.clone())
                .or_default()
                .push(subscription);
        }
        Ok(people
            .into_iter()
            .map(|person| ManagedPersonRecord {
                subscriptions: by_person.remove(&person.id).unwrap_or_default(),
                person,
                distributions: Vec::new(),
            })
            .collect())
    }

    fn load_person(&self, id: &str) -> Result<Option<ManagedPersonRecord>, PortError> {
        let person = self
            .connection
            .query_row(
                "
                SELECT id, name, cohort, phone, normalized_phone, status, person_note,
                       created_at, updated_at
                FROM people WHERE id = ?1
                ",
                [id],
                person_from_row,
            )
            .optional()
            .map_err(port_error)?;
        let Some(person) = person else {
            return Ok(None);
        };

        let mut subscription_statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, start_issue_year, start_issue_month, issue_count, quantity,
                       applied_at, source, source_reference, memo, created_at, updated_at, archived_at
                FROM subscriptions
                WHERE person_id = ?1
                ORDER BY start_issue_year, start_issue_month, created_at
                ",
            )
            .map_err(port_error)?;
        let subscriptions = subscription_statement
            .query_map([id], subscription_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)?;
        drop(subscription_statement);

        let mut distribution_statement = self
            .connection
            .prepare(
                "
                SELECT d.id, d.subscription_id, d.issue_year, d.issue_month, d.quantity,
                       d.distributed_at, d.note, d.reversal_of, d.created_at, d.updated_at
                FROM distributions d
                JOIN subscriptions s ON s.id = d.subscription_id
                WHERE s.person_id = ?1
                ORDER BY d.distributed_at, d.rowid
                ",
            )
            .map_err(port_error)?;
        let distributions = distribution_statement
            .query_map([id], distribution_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<Distribution>, _>>()
            .map_err(port_error)?;
        Ok(Some(ManagedPersonRecord {
            person,
            subscriptions,
            distributions,
        }))
    }

    fn list_person_check_items(&self, person_id: &str) -> Result<Vec<CheckItem>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, content, status, operator_name, created_at, updated_at,
                       checked_at
                FROM check_items
                WHERE person_id = ?1 AND status != 'archived'
                ORDER BY updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([person_id], check_item_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn list_person_memos(&self, person_id: &str) -> Result<Vec<Memo>, PortError> {
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, person_id, content, status, operator_name, created_at,
                       updated_at, archived_at, legacy_source, legacy_title
                FROM memos
                WHERE person_id = ?1 AND status = 'active'
                ORDER BY updated_at DESC, id DESC
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map([person_id], memo_from_row)
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn duplicate_candidates(
        &self,
        name: &str,
        cohort: Option<&str>,
        normalized_phone: Option<&str>,
        excluding_id: Option<&str>,
    ) -> Result<Vec<Person>, PortError> {
        let normalized_name = name.split_whitespace().collect::<String>().to_lowercase();
        let mut statement = self
            .connection
            .prepare(
                "
                SELECT id, name, cohort, phone, normalized_phone, status, person_note,
                       created_at, updated_at
                FROM people
                WHERE status != 'archived'
                  AND (?1 IS NULL OR id != ?1)
                  AND (
                    (?2 != '' AND lower(replace(name, ' ', '')) = ?2
                       AND (?3 IS NULL OR cohort = ?3))
                    OR (?4 IS NOT NULL AND normalized_phone = ?4)
                  )
                ORDER BY name, id
                ",
            )
            .map_err(port_error)?;
        statement
            .query_map(
                params![excluding_id, normalized_name, cohort, normalized_phone],
                person_from_row,
            )
            .map_err(port_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(port_error)
    }

    fn save_person_with_subscription(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        changes: &[ChangeLog],
    ) -> Result<(), PortError> {
        person
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        subscription
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        upsert_person(&transaction, person)?;
        upsert_subscription(&transaction, subscription)?;
        for change in changes {
            change
                .validate()
                .map_err(|error| PortError::new(error.to_string()))?;
            upsert_change(&transaction, change)?;
        }
        transaction.commit().map_err(port_error)
    }

    fn update_person(&mut self, person: &Person, change: &ChangeLog) -> Result<(), PortError> {
        if person.status == qt_domain::PersonStatus::Draft {
            person.validate_draft()
        } else {
            person.validate()
        }
        .map_err(|error| PortError::new(error.to_string()))?;
        change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        upsert_person(&transaction, person)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }

    fn save_subscription(
        &mut self,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError> {
        subscription
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        upsert_subscription(&transaction, subscription)?;
        upsert_change(&transaction, change)?;
        transaction.commit().map_err(port_error)
    }
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!(
        "QT 신청자 관리 데이터를 처리하지 못했습니다: {error}"
    ))
}
