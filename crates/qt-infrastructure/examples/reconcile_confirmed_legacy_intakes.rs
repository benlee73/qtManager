use std::{env, fs, path::PathBuf};

use qt_application::{
    AppLogger, ApplyStateImportRequest, Clock, ConfirmedAnnualIntake,
    ConfirmedLegacyIntakeCorrection, ConfirmedOneTimeIntake, CoreRepository, IdGenerator,
    ImportMode, LegacySubscriptionExpectation, StateTransferRepository, StateWorkbookV1,
    apply_state_import, reconcile_confirmed_legacy_intakes,
};
use qt_domain::{Issue, normalize_search_text};
use qt_infrastructure::{
    LegacyEvidenceRow, SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, SystemRuntime,
    XlsxStateWorkbook, read_legacy_evidence_rows,
};

fn main() {
    let source = PathBuf::from(required_argument(1, "원본 XLSX 경로"));
    let database = PathBuf::from(required_argument(2, "앱 SQLite 경로"));
    let data_directory = PathBuf::from(required_argument(3, "앱 데이터 폴더"));
    let encoded_plan = required_argument(4, "사용자 확인 교정 계획");
    let should_apply = env::args().nth(5).as_deref() == Some("--apply");
    let runtime = SystemRuntime;
    let logger = StderrEventLogger;
    let now = runtime.now();
    logger.info("confirmed_legacy_intake_reconciliation_started");

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
    let evidence = read_legacy_evidence_rows(&source).expect("원본 행을 읽을 수 없습니다.");
    let corrections = parse_plan(&encoded_plan, &current, &evidence);
    let mut repaired = current.clone();
    let result =
        reconcile_confirmed_legacy_intakes(&mut repaired, &corrections, &operator, &now, &runtime)
            .expect("현재 상태가 사용자 확인 계획과 달라 교정을 중단했습니다.");
    println!(
        "dry-run: corrections={}, people={}->{}, subscriptions={}->{}, purchases={}->{}, distributions={}->{}, checks={}->{}, annual={}, one_time={}, removed_subscriptions={}, removed_people={}, removed_start_checks={}",
        corrections.len(),
        current.people.len(),
        repaired.people.len(),
        current.subscriptions.len(),
        repaired.subscriptions.len(),
        current.purchases.len(),
        repaired.purchases.len(),
        current.distributions.len(),
        repaired.distributions.len(),
        current.check_items.len(),
        repaired.check_items.len(),
        result.confirmed_annual_subscriptions,
        result.converted_one_time_purchases,
        result.removed_subscriptions,
        result.removed_people,
        result.removed_start_checks,
    );
    logger.info("confirmed_legacy_intake_reconciliation_dry_run_completed");
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
        "confirmed-legacy-intake-reconciliation-{operation_id}.xlsx"
    ));
    XlsxStateWorkbook
        .write_state(&repaired_path, &repaired, env!("CARGO_PKG_VERSION"), &now)
        .expect("검증된 상태 XLSX 저장 실패");
    let backup_path = restore_directory.join(format!("{operation_id}.xlsx"));
    let counts = apply_state_import(
        &mut SqliteStateTransfer::new(&mut repository),
        &XlsxStateWorkbook,
        &logger,
        &ApplyStateImportRequest {
            source_path: repaired_path.to_string_lossy().into_owned(),
            source_file_name: "사용자 확인 현장 신청 구분 교정".into(),
            backup_path: backup_path.to_string_lossy().into_owned(),
            mode: ImportMode::Replace,
            person_resolutions: Vec::new(),
        },
        operation_id,
        now,
    )
    .expect("검증된 상태를 원자적으로 적용하지 못했습니다.");
    println!(
        "applied: people={}, subscriptions={}, purchases={}, distributions={}, checks={}, backup={}",
        counts.people,
        counts.subscriptions,
        counts.purchases,
        counts.distributions,
        counts.check_items,
        backup_path.display(),
    );
    logger.info("confirmed_legacy_intake_reconciliation_completed");
}

fn parse_plan(
    encoded: &str,
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> Vec<ConfirmedLegacyIntakeCorrection> {
    encoded
        .split(';')
        .filter(|item| !item.is_empty())
        .map(|item| {
            let fields = item.split('|').collect::<Vec<_>>();
            assert_eq!(fields.len(), 8, "현장 신청 교정 필드 수가 다릅니다.");
            let canonical = (fields[1] != "-").then(|| fields[1].to_owned());
            let expected = expectation(&fields, current, evidence, canonical.as_deref());
            let quantity = fields[6]
                .parse::<u32>()
                .expect("확정 수량이 숫자가 아닙니다.");
            match fields[0] {
                "A" => ConfirmedLegacyIntakeCorrection::Annual(ConfirmedAnnualIntake {
                    subscription: expected,
                    canonical_person_id: canonical,
                    confirmed_quantity: quantity,
                }),
                "O" => ConfirmedLegacyIntakeCorrection::OneTime(ConfirmedOneTimeIntake {
                    subscription: expected,
                    canonical_person_id: canonical,
                    issue: issue(fields[4], fields[5]),
                    confirmed_quantity: quantity,
                }),
                _ => panic!("알 수 없는 현장 신청 교정 형식입니다."),
            }
        })
        .collect()
}

fn expectation(
    fields: &[&str],
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
    canonical_id: Option<&str>,
) -> LegacySubscriptionExpectation {
    let owner = current
        .people
        .iter()
        .find(|item| item.id == fields[2])
        .expect("교정할 신청자가 없습니다.");
    let row = evidence
        .iter()
        .find(|item| item.source_reference == fields[7])
        .expect("검증할 원본 행이 없습니다.");
    assert_eq!(
        normalize_search_text(&row.name),
        normalize_search_text(&owner.name),
        "원본 행과 신청자 이름이 다릅니다."
    );
    assert_eq!(
        row.quantity,
        fields[6]
            .parse::<u32>()
            .expect("확정 수량이 숫자가 아닙니다."),
        "원본 행과 확정 수량이 다릅니다."
    );
    if let Some(canonical_id) = canonical_id {
        let canonical = current
            .people
            .iter()
            .find(|item| item.id == canonical_id)
            .expect("통합할 기존 신청자가 없습니다.");
        assert_eq!(
            normalize_search_text(&canonical.name),
            normalize_search_text(&owner.name),
            "통합 대상 신청자의 이름이 다릅니다."
        );
    }
    LegacySubscriptionExpectation {
        subscription_id: fields[3].into(),
        owner_person_id: fields[2].into(),
        expected_start: issue(fields[4], fields[5]),
        expected_source_reference: fields[7].into(),
    }
}

fn issue(year: &str, month: &str) -> Issue {
    Issue::new(
        year.parse().expect("시작 연도가 숫자가 아닙니다."),
        month.parse().expect("시작 월이 숫자가 아닙니다."),
    )
    .expect("유효하지 않은 QT 호입니다.")
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
