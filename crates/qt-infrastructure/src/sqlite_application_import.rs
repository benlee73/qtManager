use qt_application::{
    ApplicationImportBatch, ApplicationImportRecord, ApplicationImportRepository, PortError,
};
use rusqlite::{OptionalExtension, params};

use crate::SqliteCoreRepository;
use crate::sqlite_core_repository::{upsert_change, upsert_person, upsert_subscription};

impl ApplicationImportRepository for SqliteCoreRepository {
    fn source_reference_exists(&self, fingerprint: &str) -> Result<bool, PortError> {
        self.connection
            .query_row(
                "
                SELECT 1
                FROM subscriptions
                WHERE source = 'google_form' AND source_reference = ?1
                LIMIT 1
                ",
                [fingerprint],
                |_| Ok(true),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(port_error)
    }

    fn save_application_import(
        &mut self,
        batch: &ApplicationImportBatch,
        rows: &[ApplicationImportRecord],
    ) -> Result<(), PortError> {
        batch
            .change
            .validate()
            .map_err(|error| PortError::new(error.to_string()))?;
        let transaction = self.connection.transaction().map_err(port_error)?;
        transaction
            .execute(
                "
                INSERT INTO import_batches(
                    id, import_type, source_name, source_hash, format_version,
                    started_at, completed_at, success_count, warning_count, failure_count
                )
                VALUES (?1, 'google_form_clipboard', 'Google Forms', ?2, 1, ?3, ?4, ?5, 0, 0)
                ",
                params![
                    batch.id,
                    batch.source_hash,
                    batch.started_at,
                    batch.completed_at,
                    rows.len() as u32
                ],
            )
            .map_err(port_error)?;

        for record in rows {
            if let Some(person) = &record.person {
                person
                    .validate()
                    .map_err(|error| PortError::new(error.to_string()))?;
                upsert_person(&transaction, person)?;
            }
            record
                .subscription
                .validate()
                .map_err(|error| PortError::new(error.to_string()))?;
            upsert_subscription(&transaction, &record.subscription)?;
            for change in &record.changes {
                change
                    .validate()
                    .map_err(|error| PortError::new(error.to_string()))?;
                upsert_change(&transaction, change)?;
            }
            transaction
                .execute(
                    "
                    INSERT INTO import_rows(id, import_batch_id, row_number, status)
                    VALUES (?1, ?2, ?3, 'success')
                    ",
                    params![
                        format!("{}:{}", batch.id, record.row_number),
                        batch.id,
                        record.row_number as u32
                    ],
                )
                .map_err(port_error)?;
        }
        upsert_change(&transaction, &batch.change)?;
        transaction.commit().map_err(port_error)
    }
}

fn port_error(error: rusqlite::Error) -> PortError {
    PortError::new(format!(
        "Google 응답 가져오기 데이터를 처리하지 못했습니다: {error}"
    ))
}
