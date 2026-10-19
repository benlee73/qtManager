use crate::SqliteCoreRepository;
use crate::sqlite_core_repository::{
    person_from_row, subscription_from_row, upsert_change, upsert_distribution, upsert_person,
    upsert_subscription,
};
use crate::sqlite_distribution_desk::{purchase_from_row, upsert_purchase};
use qt_application::{OperationBatch, OperationsRepository, PortError};
use rusqlite::OptionalExtension;
impl OperationsRepository for SqliteCoreRepository {
    fn save_operation(&mut self, batch: &OperationBatch) -> Result<(), PortError> {
        let tx = self.connection.transaction().map_err(error)?;
        let stale = || PortError::new("다른 변경이 반영되었습니다. 이력을 다시 열어 수정하세요.");
        if let Some(expected) = &batch.expected_person {
            let current=tx.query_row("SELECT id,name,cohort,phone,normalized_phone,status,person_note,created_at,updated_at,is_group,cohort_not_applicable FROM people WHERE id=?1",[&expected.id],person_from_row).optional().map_err(error)?;
            if current.as_ref() != Some(expected) {
                return Err(stale());
            }
        }
        if let Some(expected) = &batch.expected_subscription {
            let current=tx.query_row("SELECT id,person_id,start_issue_year,start_issue_month,issue_count,quantity,applied_at,source,source_reference,memo,created_at,updated_at,archived_at,payment_status FROM subscriptions WHERE id=?1",[&expected.id],subscription_from_row).optional().map_err(error)?;
            if current.as_ref() != Some(expected) {
                return Err(stale());
            }
        }
        if let Some(expected) = &batch.expected_purchase {
            let current=tx.query_row("SELECT id,person_id,buyer_name,issue_year,issue_month,quantity,purchased_at,note,reversal_of,created_at,updated_at,payment_status,is_group_distribution,correction_of FROM one_time_purchases WHERE id=?1",[&expected.id],purchase_from_row).optional().map_err(error)?;
            let cancelled: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM one_time_purchases WHERE reversal_of=?1)",
                    [&expected.id],
                    |r| r.get(0),
                )
                .map_err(error)?;
            if current.as_ref() != Some(expected) || cancelled {
                return Err(stale());
            }
        }
        if let Some((person_id, expected)) = &batch.confirmed_memos {
            let mut statement = tx
                .prepare("SELECT id || ':' || updated_at FROM memos WHERE person_id=?1 AND status='active' ORDER BY id")
                .map_err(error)?;
            let current = statement
                .query_map([person_id], |r| r.get::<_, String>(0))
                .map_err(error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error)?;
            if &current != expected {
                return Err(PortError::new("메모가 변경되었습니다. 다시 확인하세요."));
            }
        }
        if batch.expected_subscription.is_none() {
            for subscription in &batch.subscriptions {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id=?1)",
                        [&subscription.id],
                        |r| r.get(0),
                    )
                    .map_err(error)?;
                if exists {
                    return Err(PortError::new("이미 처리된 신청입니다. 목록을 확인하세요."));
                }
            }
        }
        for value in &batch.people {
            upsert_person(&tx, value)?;
        }
        for value in &batch.subscriptions {
            upsert_subscription(&tx, value)?;
        }
        for value in &batch.distributions {
            upsert_distribution(&tx, value)?;
        }
        for value in &batch.purchases {
            upsert_purchase(&tx, value)?;
        }
        for value in &batch.changes {
            upsert_change(&tx, value)?;
        }
        tx.commit().map_err(error)
    }
}
fn error(value: rusqlite::Error) -> PortError {
    PortError::new(format!("업무 변경 저장 오류: {value}"))
}
