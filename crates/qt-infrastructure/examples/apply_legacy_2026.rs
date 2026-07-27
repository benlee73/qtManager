use std::{env, fs, path::PathBuf};

use qt_application::{
    ApplyStateImportRequest, Clock, CoreRepository, IdGenerator, ImportMode,
    StateTransferRepository, StateWorkbookV1, apply_state_import,
};
use qt_infrastructure::{
    SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, SystemRuntime, XlsxStateWorkbook,
    read_legacy_2026,
};

fn main() {
    let source = required_argument(1, "원본 XLSX 경로");
    let database = PathBuf::from(required_argument(2, "앱 SQLite 경로"));
    let data_directory = required_argument(3, "앱 데이터 폴더");
    let data_directory = PathBuf::from(data_directory);
    let runtime = SystemRuntime;
    let now = runtime.now();

    let mut repository =
        SqliteCoreRepository::open(&database).expect("앱 SQLite를 열 수 없습니다.");
    repository
        .migrate_core()
        .expect("앱 SQLite 마이그레이션 실패");
    let operator = {
        let mut transfer = SqliteStateTransfer::new(&mut repository);
        transfer
            .load_state()
            .expect("현재 앱 상태를 읽을 수 없습니다.")
            .settings
            .into_iter()
            .find(|setting| setting.key == "current_operator_name")
            .map(|setting| setting.value)
            .unwrap_or_else(|| "초기 데이터 이전".into())
    };
    let legacy = read_legacy_2026(PathBuf::from(&source).as_path(), &operator, &now)
        .expect("기존 XLSX 변환 실패");
    let migration_directory = data_directory.join("initial-migration");
    let restore_directory = data_directory.join("restore-points");
    fs::create_dir_all(&migration_directory).expect("최초 이전 폴더 생성 실패");
    fs::create_dir_all(&restore_directory).expect("자동 백업 폴더 생성 실패");
    let converted = migration_directory.join("2026-converted-state.xlsx");
    XlsxStateWorkbook
        .write_state(
            &converted,
            &legacy.snapshot,
            env!("CARGO_PKG_VERSION"),
            &now,
        )
        .expect("변환 상태 XLSX 저장 실패");

    let restore_id = runtime.next_id();
    let backup = restore_directory.join(format!("{restore_id}.xlsx"));
    let request = ApplyStateImportRequest {
        source_path: converted.to_string_lossy().into_owned(),
        source_file_name: "2026 기존 배부현황 최초 이전".into(),
        backup_path: backup.to_string_lossy().into_owned(),
        mode: ImportMode::Replace,
        person_resolutions: Vec::new(),
    };
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    let counts = apply_state_import(
        &mut transfer,
        &XlsxStateWorkbook,
        &StderrEventLogger,
        &request,
        restore_id,
        now,
    )
    .expect("최초 운영 데이터 적용 실패");

    println!(
        "applied: people={}, subscriptions={}, distributions={}, purchases={}, checks={}, warnings={}",
        counts.people,
        counts.subscriptions,
        counts.distributions,
        counts.purchases,
        counts.check_items,
        legacy.warnings
    );
    for (issue, rows, distributions) in legacy.issue_rows {
        println!(
            "issue {}~{}: rows={rows}, distributed={distributions}",
            issue.start_month,
            issue.start_month + 1
        );
    }
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
