use std::{env, fs, path::PathBuf};

use qt_application::{
    AppLogger, ApplyStateImportRequest, Clock, CoreRepository, IdGenerator, ImportMode,
    LegacyPeriodCorrection, LegacyPeriodShift, LegacyRenewalMerge, LegacySubscriptionExpectation,
    StateTransferRepository, StateWorkbookV1, VerifiedLegacyProfile, apply_state_import,
    reconcile_verified_legacy_periods,
};
use qt_domain::{Issue, normalize_phone, normalize_search_text};
use qt_infrastructure::{
    LegacyEvidenceRow, SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, SystemRuntime,
    XlsxStateWorkbook, read_legacy_evidence_rows,
};

fn main() {
    let source = PathBuf::from(required_argument(1, "원본 XLSX 경로"));
    let database = PathBuf::from(required_argument(2, "앱 SQLite 경로"));
    let data_directory = PathBuf::from(required_argument(3, "앱 데이터 폴더"));
    let encoded_plan = required_argument(4, "검증된 교정 계획");
    let should_apply = env::args().nth(5).as_deref() == Some("--apply");
    let runtime = SystemRuntime;
    let logger = StderrEventLogger;
    let now = runtime.now();
    logger.info("legacy_period_reconciliation_started");

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
        reconcile_verified_legacy_periods(&mut repaired, &corrections, &operator, &now, &runtime)
            .expect("현재 상태가 검증 계획과 달라 교정을 중단했습니다.");
    println!(
        "dry-run: corrections={}, people={}->{}, subscriptions={}->{}, distributions={}->{}, checks={}->{}, shifted_subscriptions={}, removed_subscriptions={}, removed_people={}, moved_distributions={}, removed_start_checks={}",
        corrections.len(),
        current.people.len(),
        repaired.people.len(),
        current.subscriptions.len(),
        repaired.subscriptions.len(),
        current.distributions.len(),
        repaired.distributions.len(),
        current.check_items.len(),
        repaired.check_items.len(),
        result.shifted_subscriptions,
        result.removed_subscriptions,
        result.removed_people,
        result.moved_distributions,
        result.removed_start_checks,
    );
    logger.info("legacy_period_reconciliation_dry_run_completed");
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
        "verified-legacy-period-reconciliation-{operation_id}.xlsx"
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
            source_file_name: "원본 구독 기간 일괄 검증 교정".into(),
            backup_path: backup_path.to_string_lossy().into_owned(),
            mode: ImportMode::Replace,
            person_resolutions: Vec::new(),
        },
        operation_id,
        now,
    )
    .expect("검증된 상태를 원자적으로 적용하지 못했습니다.");
    println!(
        "applied: people={}, subscriptions={}, distributions={}, checks={}, backup_created=true",
        counts.people, counts.subscriptions, counts.distributions, counts.check_items
    );
    logger.info("legacy_period_reconciliation_completed");
}

fn parse_plan(
    encoded: &str,
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> Vec<LegacyPeriodCorrection> {
    encoded
        .split(';')
        .filter(|item| !item.is_empty())
        .map(|item| {
            let fields = item.split('|').collect::<Vec<_>>();
            match fields.first().copied() {
                Some("S") => parse_shift(&fields, current, evidence),
                Some("M") => parse_merge(&fields, current, evidence),
                _ => panic!("알 수 없는 교정 계획 형식입니다."),
            }
        })
        .collect()
}

fn parse_shift(
    fields: &[&str],
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> LegacyPeriodCorrection {
    assert_eq!(fields.len(), 6, "시작 호 교정 필드 수가 다릅니다.");
    let corrected_start = issue(fields[3], fields[4]);
    let row = evidence_row(evidence, fields[5]);
    assert_verified_period(row, corrected_start);
    let subscription = current
        .subscriptions
        .iter()
        .find(|item| item.id == fields[2])
        .expect("교정할 구독이 없습니다.");
    assert_eq!(subscription.quantity, row.quantity, "원본 수량이 다릅니다.");
    LegacyPeriodCorrection::Shift(LegacyPeriodShift {
        subscription: LegacySubscriptionExpectation {
            subscription_id: fields[2].into(),
            owner_person_id: fields[1].into(),
            expected_start: corrected_start.advance(1),
            expected_source_reference: fields[5].into(),
        },
        corrected_start,
    })
}

fn parse_merge(
    fields: &[&str],
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> LegacyPeriodCorrection {
    assert_eq!(fields.len(), 10, "중복 갱신 교정 필드 수가 다릅니다.");
    let corrected_start = issue(fields[5], fields[6]);
    let retained_row = evidence_row(evidence, fields[7]);
    let profile_row = evidence_row(evidence, fields[9]);
    assert_verified_period(profile_row, corrected_start);
    assert_eq!(
        base_name(&retained_row.name),
        base_name(&profile_row.name),
        "갱신 행의 이름이 다릅니다."
    );
    let retained = current
        .subscriptions
        .iter()
        .find(|item| item.id == fields[3])
        .expect("유지할 구독이 없습니다.");
    assert_eq!(
        retained.quantity, retained_row.quantity,
        "원본 수량이 다릅니다."
    );
    assert_eq!(
        retained.quantity, profile_row.quantity,
        "갱신 수량이 다릅니다."
    );

    let obsolete_subscriptions = fields[8]
        .split('+')
        .map(|spec| {
            let values = spec.split('@').collect::<Vec<_>>();
            assert_eq!(values.len(), 3, "제거 구독 필드 수가 다릅니다.");
            let row = evidence_row(evidence, values[2]);
            assert_verified_period(row, corrected_start);
            assert_eq!(base_name(&row.name), base_name(&profile_row.name));
            let subscription = current
                .subscriptions
                .iter()
                .find(|item| item.id == values[0])
                .expect("제거할 구독이 없습니다.");
            assert_eq!(subscription.quantity, row.quantity, "원본 수량이 다릅니다.");
            LegacySubscriptionExpectation {
                subscription_id: values[0].into(),
                owner_person_id: values[1].into(),
                expected_start: corrected_start.advance(1),
                expected_source_reference: values[2].into(),
            }
        })
        .collect();
    let normalized_phone = profile_row
        .phone
        .as_deref()
        .map(normalize_phone)
        .filter(|value| !value.is_empty());
    LegacyPeriodCorrection::Merge(LegacyRenewalMerge {
        canonical_person_id: fields[1].into(),
        duplicate_person_ids: fields[2].split('+').map(str::to_owned).collect(),
        retained_subscription: LegacySubscriptionExpectation {
            subscription_id: fields[3].into(),
            owner_person_id: fields[4].into(),
            expected_start: corrected_start,
            expected_source_reference: fields[7].into(),
        },
        obsolete_subscriptions,
        corrected_start,
        verified_profile: VerifiedLegacyProfile {
            name: base_name(&profile_row.name),
            cohort: profile_row.cohort.clone(),
            phone: profile_row.phone.clone(),
            normalized_phone,
        },
    })
}

fn evidence_row<'a>(evidence: &'a [LegacyEvidenceRow], reference: &str) -> &'a LegacyEvidenceRow {
    evidence
        .iter()
        .find(|row| row.source_reference == reference)
        .expect("검증할 원본 행이 없습니다.")
}

fn assert_verified_period(row: &LegacyEvidenceRow, start: Issue) {
    assert_eq!(row.start_issue, Some(start), "원본 시작 호가 다릅니다.");
    assert_eq!(
        row.end_issue,
        Some(start.advance(5)),
        "원본 종료 호가 6개 호 규칙과 다릅니다."
    );
}

fn issue(year: &str, month: &str) -> Issue {
    Issue::new(
        year.parse().expect("시작 연도가 숫자가 아닙니다."),
        month.parse().expect("시작 월이 숫자가 아닙니다."),
    )
    .expect("유효하지 않은 QT 호입니다.")
}

fn base_name(value: &str) -> String {
    let normalized = normalize_search_text(value);
    normalized
        .strip_suffix("(추가)")
        .unwrap_or(&normalized)
        .to_string()
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
