use std::{env, fs, path::PathBuf};

use qt_application::{
    AppLogger, ApplyStateImportRequest, Clock, CoreRepository, IdGenerator, ImportMode,
    LegacyDuplicateRenewalRequest, StateTransferRepository, StateWorkbookV1, apply_state_import,
    reconcile_legacy_duplicate_renewal,
};
use qt_domain::Issue;
use qt_infrastructure::{
    SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, SystemRuntime, XlsxStateWorkbook,
};

fn main() {
    let database = PathBuf::from(required_argument(1, "앱 SQLite 경로"));
    let data_directory = PathBuf::from(required_argument(2, "앱 데이터 폴더"));
    let request = LegacyDuplicateRenewalRequest {
        canonical_person_id: required_argument(3, "기준 신청자 ID"),
        duplicate_person_id: required_argument(4, "중복 신청자 ID"),
        renewal_subscription_id: required_argument(5, "확정 갱신 구독 ID"),
        obsolete_subscription_id: required_argument(6, "잘못 생성된 구독 ID"),
        expected_renewal_start: issue_argument(7, 8, "확정 갱신 시작 호"),
        expected_renewal_source_reference: required_argument(9, "확정 갱신 원본 행"),
        expected_obsolete_start: issue_argument(10, 11, "잘못 생성된 시작 호"),
        expected_obsolete_source_reference: required_argument(12, "잘못 생성된 원본 행"),
    };
    let should_apply = env::args().nth(13).as_deref() == Some("--apply");
    let runtime = SystemRuntime;
    let logger = StderrEventLogger;
    let now = runtime.now();
    logger.info("legacy_duplicate_renewal_reconciliation_started");

    let mut repository = SqliteCoreRepository::open(&database).expect("앱 SQLite 열기 실패");
    repository
        .migrate_core()
        .expect("앱 SQLite 마이그레이션 실패");
    let current = SqliteStateTransfer::new(&mut repository)
        .load_state()
        .expect("현재 앱 상태 읽기 실패");
    let operator = current
        .settings
        .iter()
        .find(|setting| setting.key == "current_operator_name")
        .map(|setting| setting.value.clone())
        .unwrap_or_else(|| "초기 데이터 검증".into());
    let before = current.counts();
    let mut repaired = current;
    let result =
        reconcile_legacy_duplicate_renewal(&mut repaired, &request, &operator, &now, &runtime)
            .expect("검증된 중복 신청자·갱신 구독 정리 조건 불일치");
    let after = repaired.counts();
    println!(
        "dry-run: people={}->{}, subscriptions={}->{}, distributions={}->{}, checks={}->{}, moved_distributions={}, removed_start_checks={}",
        before.people,
        after.people,
        before.subscriptions,
        after.subscriptions,
        before.distributions,
        after.distributions,
        before.check_items,
        after.check_items,
        result.moved_distributions,
        result.removed_start_checks
    );
    logger.info("legacy_duplicate_renewal_reconciliation_dry_run_completed");
    if !should_apply {
        println!("dry-run only: no data changed");
        return;
    }

    let migration_directory = data_directory.join("initial-migration");
    let restore_directory = data_directory.join("restore-points");
    fs::create_dir_all(&migration_directory).expect("검증 결과 폴더 생성 실패");
    fs::create_dir_all(&restore_directory).expect("자동 백업 폴더 생성 실패");
    let operation_id = runtime.next_id();
    let repaired_path = migration_directory.join(format!(
        "verified-duplicate-renewal-reconciliation-{operation_id}.xlsx"
    ));
    XlsxStateWorkbook
        .write_state(&repaired_path, &repaired, env!("CARGO_PKG_VERSION"), &now)
        .expect("검증된 상태 XLSX 저장 실패");
    let backup_path = restore_directory.join(format!("{operation_id}.xlsx"));
    let import = ApplyStateImportRequest {
        source_path: repaired_path.to_string_lossy().into_owned(),
        source_file_name: "원본 검증 중복 신청자·갱신 구독 정리".into(),
        backup_path: backup_path.to_string_lossy().into_owned(),
        mode: ImportMode::Replace,
        person_resolutions: Vec::new(),
    };
    let counts = apply_state_import(
        &mut SqliteStateTransfer::new(&mut repository),
        &XlsxStateWorkbook,
        &logger,
        &import,
        operation_id,
        now,
    )
    .expect("검증된 중복 신청자·갱신 구독 정리 적용 실패");
    println!(
        "applied: people={}, subscriptions={}, distributions={}, checks={}, backup_created=true",
        counts.people, counts.subscriptions, counts.distributions, counts.check_items
    );
    logger.info("legacy_duplicate_renewal_reconciliation_completed");
}

fn issue_argument(year_index: usize, month_index: usize, label: &str) -> Issue {
    let year = required_argument(year_index, label)
        .parse()
        .unwrap_or_else(|_| panic!("{label} 연도가 올바르지 않습니다."));
    let month = required_argument(month_index, label)
        .parse()
        .unwrap_or_else(|_| panic!("{label} 월이 올바르지 않습니다."));
    Issue::new(year, month).unwrap_or_else(|_| panic!("{label}가 올바르지 않습니다."))
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
