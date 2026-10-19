use std::{collections::BTreeMap, env, fs, path::PathBuf};

use qt_application::{
    AppLogger, ApplyStateImportRequest, Clock, CoreRepository, IdGenerator, ImportMode,
    LegacyStartCheckSkipReason, StateTransferRepository, StateWorkbookV1,
    apply_legacy_start_check_cleanup, apply_state_import, plan_legacy_start_check_cleanup,
};
use qt_infrastructure::{
    SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, SystemRuntime, XlsxStateWorkbook,
    read_legacy_2026,
};

fn main() {
    let source = PathBuf::from(required_argument(1, "원본 XLSX 경로"));
    let database = PathBuf::from(required_argument(2, "앱 SQLite 경로"));
    let data_directory = PathBuf::from(required_argument(3, "앱 데이터 폴더"));
    let should_apply = env::args().nth(4).as_deref() == Some("--apply");
    let runtime = SystemRuntime;
    let logger = StderrEventLogger;
    let now = runtime.now();
    logger.info("legacy_start_check_cleanup_started");

    let mut repository =
        SqliteCoreRepository::open(&database).expect("앱 SQLite를 열 수 없습니다.");
    repository
        .migrate_core()
        .expect("앱 SQLite 마이그레이션 실패");
    let current = SqliteStateTransfer::new(&mut repository)
        .load_state()
        .expect("현재 앱 상태를 읽을 수 없습니다.");
    assert!(
        !should_apply || current.memos.is_none(),
        "이 도구는 이전 형식 자료 전용입니다. 현재 메모를 직접 보존하는 0.2.0 상태에는 적용할 수 없습니다."
    );
    let operator = current
        .settings
        .iter()
        .find(|setting| setting.key == "current_operator_name")
        .map(|setting| setting.value.clone())
        .unwrap_or_else(|| "초기 데이터 검증".into());
    let verified = read_legacy_2026(&source, &operator, &now)
        .expect("원본 XLSX를 현재 규칙으로 검증하지 못했습니다.")
        .snapshot;
    let plan = plan_legacy_start_check_cleanup(&current, &verified);

    let mut skipped = BTreeMap::<&str, usize>::new();
    for item in &plan.skipped {
        let label = match item.reason {
            LegacyStartCheckSkipReason::AmbiguousIdentity => "identity_ambiguous",
            LegacyStartCheckSkipReason::SourceStillUnverified => "source_unverified",
            LegacyStartCheckSkipReason::CurrentRecordModified => "current_record_modified",
            LegacyStartCheckSkipReason::SubscriptionMismatch => "subscription_mismatch",
        };
        *skipped.entry(label).or_default() += 1;
    }
    println!(
        "dry-run: removable={}, retained={}",
        plan.removable_check_item_ids.len(),
        plan.skipped.len()
    );
    for (reason, count) in skipped {
        println!("  retained.{reason}={count}");
    }
    logger.info("legacy_start_check_cleanup_dry_run_completed");

    if !should_apply {
        println!("dry-run only: no data changed");
        return;
    }

    let mut repaired = current;
    let removed = apply_legacy_start_check_cleanup(&mut repaired, &plan, &operator, &now, &runtime);
    assert_eq!(
        removed,
        plan.removable_check_item_ids.len(),
        "드라이런과 적용 대상이 달라 중단했습니다."
    );

    let migration_directory = data_directory.join("initial-migration");
    let restore_directory = data_directory.join("restore-points");
    fs::create_dir_all(&migration_directory).expect("검증 결과 폴더 생성 실패");
    fs::create_dir_all(&restore_directory).expect("자동 백업 폴더 생성 실패");
    let operation_id = runtime.next_id();
    let repaired_path = migration_directory.join(format!(
        "verified-legacy-start-check-cleanup-{operation_id}.xlsx"
    ));
    XlsxStateWorkbook
        .write_state(&repaired_path, &repaired, env!("CARGO_PKG_VERSION"), &now)
        .expect("검증된 상태 XLSX 저장 실패");
    let backup_path = restore_directory.join(format!("{operation_id}.xlsx"));
    let request = ApplyStateImportRequest {
        source_path: repaired_path.to_string_lossy().into_owned(),
        source_file_name: "원본 구독 기간 검증 후 확인할 일 정리".into(),
        backup_path: backup_path.to_string_lossy().into_owned(),
        mode: ImportMode::Replace,
        person_resolutions: Vec::new(),
    };
    let counts = apply_state_import(
        &mut SqliteStateTransfer::new(&mut repository),
        &XlsxStateWorkbook,
        &logger,
        &request,
        operation_id,
        now,
    )
    .expect("검증된 확인할 일 정리 적용 실패");
    println!(
        "applied: removed={removed}, remaining_checks={}, backup_created=true",
        counts.check_items
    );
    logger.info("legacy_start_check_cleanup_completed");
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
