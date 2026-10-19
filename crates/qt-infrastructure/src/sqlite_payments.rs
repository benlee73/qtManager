use crate::SqliteCoreRepository;
use crate::sqlite_core_repository::{
    person_from_row, subscription_from_row, upsert_change, upsert_subscription,
};
use crate::sqlite_distribution_desk::{purchase_from_row, upsert_purchase};
use qt_application::{PaymentIntake, PaymentRepository, PortError};
use qt_domain::ChangeLog;
use rusqlite::OptionalExtension;

impl PaymentRepository for SqliteCoreRepository {
    fn payment_operator(&self) -> Result<Option<String>, PortError> {
        self.connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'current_operator_name'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)
    }
    fn payment_intakes(&self) -> Result<Vec<PaymentIntake>, PortError> {
        let load_person = |id: &str| {
            self.connection.query_row("SELECT id, name, cohort, phone, normalized_phone, status, person_note, created_at, updated_at, is_group, cohort_not_applicable FROM people WHERE id = ?1", [id], person_from_row).optional().map_err(error)
        };
        let mut result = Vec::new();
        let mut statement = self.connection.prepare("SELECT id, person_id, start_issue_year, start_issue_month, issue_count, quantity, applied_at, source, source_reference, memo, created_at, updated_at, archived_at, payment_status FROM subscriptions WHERE payment_status IS NOT NULL AND archived_at IS NULL").map_err(error)?;
        let subscriptions = statement
            .query_map([], subscription_from_row)
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        for subscription in subscriptions {
            if let Some(person) = load_person(&subscription.person_id)? {
                result.push(PaymentIntake::Subscription(person, subscription));
            }
        }
        let mut statement = self.connection.prepare("SELECT p.id, p.person_id, p.buyer_name, p.issue_year, p.issue_month, p.quantity, p.purchased_at, p.note, p.reversal_of, p.created_at, p.updated_at, p.payment_status, p.is_group_distribution, p.correction_of FROM one_time_purchases p WHERE p.payment_status IS NOT NULL AND p.reversal_of IS NULL AND NOT EXISTS (SELECT 1 FROM one_time_purchases r WHERE r.reversal_of = p.id)").map_err(error)?;
        let purchases = statement
            .query_map([], purchase_from_row)
            .map_err(error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?;
        for purchase in purchases {
            let person = purchase
                .person_id
                .as_deref()
                .map(load_person)
                .transpose()?
                .flatten();
            result.push(PaymentIntake::Purchase(person, purchase));
        }
        Ok(result)
    }
    fn save_payment_changes(
        &mut self,
        changes: &[(PaymentIntake, ChangeLog)],
    ) -> Result<(), PortError> {
        let transaction = self.connection.transaction().map_err(error)?;
        for (intake, change) in changes {
            match intake {
                PaymentIntake::Subscription(_, subscription) => {
                    upsert_subscription(&transaction, subscription)?
                }
                PaymentIntake::Purchase(_, purchase) => upsert_purchase(&transaction, purchase)?,
            }
            upsert_change(&transaction, change)?;
        }
        transaction.commit().map_err(error)
    }
}
fn error(value: rusqlite::Error) -> PortError {
    PortError::new(format!("입금 확인 저장소 오류: {value}"))
}
