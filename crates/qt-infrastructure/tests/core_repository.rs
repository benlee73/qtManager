use qt_application::{CoreRepository, RunPhase1Probe};
use qt_domain::{ChangeLog, Issue, Person, PersonStatus, Subscription, SubscriptionSource};
use qt_infrastructure::{SqliteCoreRepository, StderrEventLogger};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn migrates_idempotently_and_runs_atomic_core_round_trip() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("core.sqlite");
    let mut repository = SqliteCoreRepository::open(&path).unwrap();

    let first = repository.migrate_core().unwrap();
    let second = repository.migrate_core().unwrap();
    assert_eq!(first.schema_version, 2);
    assert_eq!(first.newly_applied, 2);
    assert_eq!(second.newly_applied, 0);

    let logger = StderrEventLogger;
    let mut probe = RunPhase1Probe::new(&mut repository, &logger);
    let report = probe.execute().unwrap();
    assert_eq!(report.distributed_quantity, 2);

    drop(repository);
    let mut reopened = SqliteCoreRepository::open(&path).unwrap();
    assert_eq!(reopened.migrate_core().unwrap().newly_applied, 0);
    assert_eq!(reopened.list_changes().unwrap().len(), 2);
}

#[test]
fn upgrades_phase0_database_without_losing_probe_row() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("phase0.sqlite");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE phase0_people (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cohort TEXT NOT NULL CHECK(length(cohort) = 2)
            );
            INSERT INTO schema_migrations VALUES (1, '2026-07-24T00:00:00Z');
            INSERT INTO phase0_people VALUES ('probe-1', '가상신청자', '00');
            ",
        )
        .unwrap();
    drop(connection);

    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    let report = repository.migrate_core().unwrap();
    drop(repository);

    assert_eq!(report.newly_applied, 1);
    let connection = Connection::open(&path).unwrap();
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM phase0_people", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn rolls_back_person_when_subscription_write_fails() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("rollback.sqlite");
    let mut repository = SqliteCoreRepository::open(&path).unwrap();
    repository.migrate_core().unwrap();
    let now = "2026-07-24T10:00:00+09:00";
    let person = Person {
        id: "person-rollback".into(),
        name: "가상 신청자".into(),
        cohort: Some("00".into()),
        phone: None,
        normalized_phone: None,
        status: PersonStatus::Active,
        special_note: None,
        created_at: now.into(),
        updated_at: now.into(),
    };
    let subscription = Subscription {
        id: "subscription-rollback".into(),
        // 존재하지 않는 사람을 참조시켜 person INSERT 이후 FK 오류를 유도한다.
        person_id: "missing-person".into(),
        start_issue: Issue::new(2026, 1).unwrap(),
        issue_count: 6,
        quantity: 1,
        applied_at: None,
        source: SubscriptionSource::Manual,
        source_reference: None,
        memo: None,
        created_at: now.into(),
        updated_at: now.into(),
        archived_at: None,
    };
    let change = ChangeLog {
        id: "change-rollback".into(),
        occurred_at: now.into(),
        operator_name: "가상담당자".into(),
        action_type: "subscription_created".into(),
        entity_type: "subscription".into(),
        entity_id: subscription.id.clone(),
        summary: "구독 생성".into(),
        before_json: None,
        after_json: None,
    };

    assert!(
        repository
            .register_subscription(&person, &subscription, &change)
            .is_err()
    );
    assert_eq!(repository.find_person(&person.id).unwrap(), None);
    assert!(repository.list_changes().unwrap().is_empty());
}
