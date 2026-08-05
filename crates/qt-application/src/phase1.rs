use qt_domain::{
    ChangeLog, DATABASE_SCHEMA_VERSION, Distribution, DistributionStatus, Issue, Person,
    PersonStatus, Subscription, SubscriptionSource, assess_distribution, plan_distribution,
};
use serde::Serialize;

use crate::{AppLogger, ApplicationError, PortError};

pub trait CoreRepository {
    fn migrate_core(&mut self) -> Result<MigrationReport, PortError>;
    fn register_subscription(
        &mut self,
        person: &Person,
        subscription: &Subscription,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
    fn record_distribution(
        &mut self,
        distribution: &Distribution,
        change: &ChangeLog,
    ) -> Result<(), PortError>;
    fn find_person(&self, id: &str) -> Result<Option<Person>, PortError>;
    fn find_subscription(&self, id: &str) -> Result<Option<Subscription>, PortError>;
    fn list_distributions(
        &self,
        subscription_id: &str,
        issue: Issue,
    ) -> Result<Vec<Distribution>, PortError>;
    fn list_changes(&self) -> Result<Vec<ChangeLog>, PortError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MigrationReport {
    pub schema_version: u16,
    pub newly_applied: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phase1Report {
    pub schema_version: u16,
    pub subscription_status: String,
    pub distribution_status: String,
    pub target_quantity: u32,
    pub distributed_quantity: u32,
    pub last_issue: String,
    pub change_count: usize,
}

pub struct RunPhase1Probe<'a, R, L> {
    repository: &'a mut R,
    logger: &'a L,
}

impl<'a, R, L> RunPhase1Probe<'a, R, L>
where
    R: CoreRepository,
    L: AppLogger,
{
    pub fn new(repository: &'a mut R, logger: &'a L) -> Self {
        Self { repository, logger }
    }

    pub fn execute(&mut self) -> Result<Phase1Report, ApplicationError> {
        self.logger.info("phase1_core_started");
        let result = self.execute_inner();
        match result {
            Ok(report) => {
                self.logger.info("phase1_core_completed");
                Ok(report)
            }
            Err(error) => {
                self.logger.error("phase1_core_failed");
                Err(error)
            }
        }
    }

    fn execute_inner(&mut self) -> Result<Phase1Report, ApplicationError> {
        let migration = self.repository.migrate_core()?;
        if migration.schema_version != DATABASE_SCHEMA_VERSION {
            return Err(ApplicationError::DatabaseSchemaMismatch {
                expected: DATABASE_SCHEMA_VERSION,
                actual: migration.schema_version,
            });
        }

        let fixture = Phase1Fixture::new();
        fixture.person.validate()?;
        fixture.subscription.validate()?;
        fixture.subscription_change.validate()?;
        self.repository.register_subscription(
            &fixture.person,
            &fixture.subscription,
            &fixture.subscription_change,
        )?;

        let stored_person = self
            .repository
            .find_person(&fixture.person.id)?
            .ok_or(ApplicationError::MissingPersistedPerson)?;
        if stored_person != fixture.person {
            return Err(ApplicationError::DatabaseMismatch);
        }
        let stored_subscription = self
            .repository
            .find_subscription(&fixture.subscription.id)?
            .ok_or(ApplicationError::MissingPersistedSubscription)?;
        if stored_subscription != fixture.subscription {
            return Err(ApplicationError::DatabaseMismatch);
        }

        let selected_issue = Issue::new(2026, 3)?;
        let existing = self
            .repository
            .list_distributions(&fixture.subscription.id, selected_issue)?;
        let existing_assessment =
            assess_distribution(&stored_subscription, selected_issue, false, &existing)?;
        if existing_assessment.status != DistributionStatus::Complete {
            let planned =
                plan_distribution(&stored_subscription, selected_issue, false, &existing, None)?;
            let distribution = fixture.distribution(planned.quantity);
            let distribution_change = fixture.distribution_change(&distribution);
            self.repository
                .record_distribution(&distribution, &distribution_change)?;
        }

        let stored_distributions = self
            .repository
            .list_distributions(&fixture.subscription.id, selected_issue)?;
        let assessment = assess_distribution(
            &stored_subscription,
            selected_issue,
            false,
            &stored_distributions,
        )?;
        if assessment.status != DistributionStatus::Complete {
            return Err(ApplicationError::DistributionMismatch);
        }
        let changes = self.repository.list_changes()?;
        if changes.len() != 2
            || changes
                .iter()
                .any(|change| change.operator_name != "가상담당자")
        {
            return Err(ApplicationError::ChangeLogMismatch);
        }
        let subscription = stored_subscription.assess(selected_issue, false)?;

        Ok(Phase1Report {
            schema_version: migration.schema_version,
            subscription_status: "유효".into(),
            distribution_status: "배부 완료".into(),
            target_quantity: assessment.target_quantity,
            distributed_quantity: assessment.distributed_quantity,
            last_issue: subscription.last_issue.display_name(),
            change_count: changes.len(),
        })
    }
}

struct Phase1Fixture {
    person: Person,
    subscription: Subscription,
    subscription_change: ChangeLog,
}

impl Phase1Fixture {
    fn new() -> Self {
        let now = "2026-07-24T10:00:00+09:00";
        let person = Person {
            id: "00000000-0000-4000-8000-000000000101".into(),
            name: "가상신청자".into(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Active,
            person_note: None,
            created_at: now.into(),
            updated_at: now.into(),
        };
        let subscription = Subscription {
            id: "00000000-0000-4000-8000-000000000102".into(),
            person_id: person.id.clone(),
            start_issue: Issue::new(2026, 1).expect("고정 fixture QT 호는 유효함"),
            issue_count: 6,
            quantity: 2,
            applied_at: Some("2026-01-04T12:00:00+09:00".into()),
            source: SubscriptionSource::Manual,
            source_reference: None,
            memo: None,
            created_at: now.into(),
            updated_at: now.into(),
            archived_at: None,
        };
        let subscription_change = ChangeLog {
            id: "00000000-0000-4000-8000-000000000103".into(),
            occurred_at: now.into(),
            operator_name: "가상담당자".into(),
            action_type: "subscription_created".into(),
            entity_type: "subscription".into(),
            entity_id: subscription.id.clone(),
            summary: "구독 생성".into(),
            before_json: None,
            after_json: None,
        };
        Self {
            person,
            subscription,
            subscription_change,
        }
    }

    fn distribution(&self, quantity: u32) -> Distribution {
        Distribution {
            id: "00000000-0000-4000-8000-000000000104".into(),
            subscription_id: self.subscription.id.clone(),
            issue: Issue::new(2026, 3).expect("고정 fixture QT 호는 유효함"),
            quantity,
            distributed_at: "2026-02-22T12:00:00+09:00".into(),
            note: None,
            reversal_of: None,
            created_at: "2026-02-22T12:00:00+09:00".into(),
            updated_at: "2026-02-22T12:00:00+09:00".into(),
        }
    }

    fn distribution_change(&self, distribution: &Distribution) -> ChangeLog {
        ChangeLog {
            id: "00000000-0000-4000-8000-000000000105".into(),
            occurred_at: distribution.distributed_at.clone(),
            operator_name: "가상담당자".into(),
            action_type: "distribution_recorded".into(),
            entity_type: "distribution".into(),
            entity_id: distribution.id.clone(),
            summary: "2권 배부".into(),
            before_json: None,
            after_json: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    #[derive(Default)]
    struct MemoryCoreRepository {
        person: Option<Person>,
        subscription: Option<Subscription>,
        distributions: Vec<Distribution>,
        changes: Vec<ChangeLog>,
    }

    impl CoreRepository for MemoryCoreRepository {
        fn migrate_core(&mut self) -> Result<MigrationReport, PortError> {
            Ok(MigrationReport {
                schema_version: DATABASE_SCHEMA_VERSION,
                newly_applied: 2,
            })
        }

        fn register_subscription(
            &mut self,
            person: &Person,
            subscription: &Subscription,
            change: &ChangeLog,
        ) -> Result<(), PortError> {
            self.person = Some(person.clone());
            self.subscription = Some(subscription.clone());
            upsert_by_id(&mut self.changes, change.clone(), |item| &item.id);
            Ok(())
        }

        fn record_distribution(
            &mut self,
            distribution: &Distribution,
            change: &ChangeLog,
        ) -> Result<(), PortError> {
            upsert_by_id(&mut self.distributions, distribution.clone(), |item| {
                &item.id
            });
            upsert_by_id(&mut self.changes, change.clone(), |item| &item.id);
            Ok(())
        }

        fn find_person(&self, id: &str) -> Result<Option<Person>, PortError> {
            Ok(self.person.clone().filter(|person| person.id == id))
        }

        fn find_subscription(&self, id: &str) -> Result<Option<Subscription>, PortError> {
            Ok(self
                .subscription
                .clone()
                .filter(|subscription| subscription.id == id))
        }

        fn list_distributions(
            &self,
            subscription_id: &str,
            issue: Issue,
        ) -> Result<Vec<Distribution>, PortError> {
            Ok(self
                .distributions
                .iter()
                .filter(|distribution| {
                    distribution.subscription_id == subscription_id && distribution.issue == issue
                })
                .cloned()
                .collect())
        }

        fn list_changes(&self) -> Result<Vec<ChangeLog>, PortError> {
            Ok(self.changes.clone())
        }
    }

    #[derive(Default)]
    struct RecordingLogger(RefCell<Vec<&'static str>>);

    impl AppLogger for RecordingLogger {
        fn info(&self, event: &'static str) {
            self.0.borrow_mut().push(event);
        }

        fn error(&self, event: &'static str) {
            self.0.borrow_mut().push(event);
        }
    }

    #[test]
    fn persists_subscription_distribution_and_operator_change_history() {
        let mut repository = MemoryCoreRepository::default();
        let logger = RecordingLogger::default();
        let mut use_case = RunPhase1Probe::new(&mut repository, &logger);

        let report = use_case.execute().unwrap();

        assert_eq!(report.schema_version, qt_domain::DATABASE_SCHEMA_VERSION);
        assert_eq!(report.subscription_status, "유효");
        assert_eq!(report.distribution_status, "배부 완료");
        assert_eq!(report.target_quantity, 2);
        assert_eq!(report.distributed_quantity, 2);
        assert_eq!(report.change_count, 2);
        assert_eq!(
            logger.0.into_inner(),
            vec!["phase1_core_started", "phase1_core_completed"]
        );
    }

    #[test]
    fn repeated_probe_does_not_duplicate_completed_distribution() {
        let mut repository = MemoryCoreRepository::default();
        let logger = RecordingLogger::default();

        RunPhase1Probe::new(&mut repository, &logger)
            .execute()
            .unwrap();
        let report = RunPhase1Probe::new(&mut repository, &logger)
            .execute()
            .unwrap();

        assert_eq!(report.distributed_quantity, 2);
        assert_eq!(repository.distributions.len(), 1);
        assert_eq!(repository.changes.len(), 2);
    }

    fn upsert_by_id<T, F>(items: &mut Vec<T>, new_item: T, id: F)
    where
        F: Fn(&T) -> &str,
    {
        if let Some(index) = items
            .iter()
            .position(|existing_item| id(existing_item) == id(&new_item))
        {
            items[index] = new_item;
        } else {
            items.push(new_item);
        }
    }
}
