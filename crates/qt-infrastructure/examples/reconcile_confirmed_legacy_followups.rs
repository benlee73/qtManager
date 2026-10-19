use std::{env, fs, path::PathBuf};

use qt_application::{
    AppLogger, ApplyStateImportRequest, Clock, ConfirmedLegacyCheckDetail, ConfirmedLegacyFollowup,
    ConfirmedLegacySubscriptionConsolidation, CoreRepository, IdGenerator, ImportMode,
    LegacySubscriptionExpectation, StateTransferRepository, StateWorkbookV1, apply_state_import,
    reconcile_confirmed_legacy_followups,
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
    let encoded_plan = required_argument(4, "사용자 확인 후속 계획");
    let should_apply = env::args().nth(5).as_deref() == Some("--apply");
    let runtime = SystemRuntime;
    let logger = StderrEventLogger;
    let now = runtime.now();
    logger.info("confirmed_legacy_followup_reconciliation_started");

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
    let followups = parse_plan(&encoded_plan, &current, &evidence);
    let mut repaired = current.clone();
    let result =
        reconcile_confirmed_legacy_followups(&mut repaired, &followups, &operator, &now, &runtime)
            .expect("현재 상태가 사용자 확인 계획과 달라 교정을 중단했습니다.");
    println!(
        "dry-run: followups={}, people={}->{}, subscriptions={}->{}, distributions={}->{}, checks={}->{}, detailed_checks={}, consolidations={}, moved_distributions={}, removed_subscriptions={}, removed_people={}, removed_start_checks={}",
        followups.len(),
        current.people.len(),
        repaired.people.len(),
        current.subscriptions.len(),
        repaired.subscriptions.len(),
        current.distributions.len(),
        repaired.distributions.len(),
        current.check_items.len(),
        repaired.check_items.len(),
        result.updated_check_items,
        result.consolidated_subscriptions,
        result.moved_distributions,
        result.removed_subscriptions,
        result.removed_people,
        result.removed_start_checks,
    );
    logger.info("confirmed_legacy_followup_reconciliation_dry_run_completed");
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
        "confirmed-legacy-followup-reconciliation-{operation_id}.xlsx"
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
            source_file_name: "사용자 확인 상세 항목 및 구독 통합".into(),
            backup_path: backup_path.to_string_lossy().into_owned(),
            mode: ImportMode::Replace,
            person_resolutions: Vec::new(),
        },
        operation_id,
        now,
    )
    .expect("검증된 상태를 원자적으로 적용하지 못했습니다.");
    println!(
        "applied: people={}, subscriptions={}, distributions={}, checks={}, backup={}",
        counts.people,
        counts.subscriptions,
        counts.distributions,
        counts.check_items,
        backup_path.display(),
    );
    logger.info("confirmed_legacy_followup_reconciliation_completed");
}

fn parse_plan(
    encoded: &str,
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> Vec<ConfirmedLegacyFollowup> {
    encoded
        .split(';')
        .filter(|item| !item.is_empty())
        .map(|item| {
            let fields = item.split('|').collect::<Vec<_>>();
            match fields.first().copied() {
                Some("D") => parse_check_detail(&fields),
                Some("C") => parse_consolidation(&fields, current, evidence),
                _ => panic!("알 수 없는 후속 계획 형식입니다."),
            }
        })
        .collect()
}

fn parse_check_detail(fields: &[&str]) -> ConfirmedLegacyFollowup {
    assert_eq!(fields.len(), 5, "확인할 일 상세 필드 수가 다릅니다.");
    ConfirmedLegacyFollowup::CheckDetail(ConfirmedLegacyCheckDetail {
        check_item_id: fields[1].into(),
        person_id: fields[2].into(),
        expected_content: fields[3].into(),
        replacement_content: fields[4].into(),
    })
}

fn parse_consolidation(
    fields: &[&str],
    current: &qt_application::StateSnapshot,
    evidence: &[LegacyEvidenceRow],
) -> ConfirmedLegacyFollowup {
    assert_eq!(fields.len(), 13, "구독 통합 필드 수가 다릅니다.");
    let retained = expectation(fields[3], fields[1], fields[4], fields[5], fields[6]);
    let obsolete = expectation(fields[7], fields[2], fields[8], fields[9], fields[10]);
    let retained_row = evidence_row(evidence, fields[6]);
    let obsolete_row = evidence_row(evidence, fields[10]);
    let canonical = current
        .people
        .iter()
        .find(|item| item.id == fields[1])
        .expect("유지할 신청자가 없습니다.");
    let duplicate = current
        .people
        .iter()
        .find(|item| item.id == fields[2])
        .expect("통합할 신청자가 없습니다.");
    assert_eq!(
        normalize_search_text(&canonical.name),
        normalize_search_text(&duplicate.name)
    );
    assert_eq!(
        normalize_search_text(&canonical.name),
        normalize_search_text(&retained_row.name)
    );
    assert_eq!(
        normalize_search_text(&canonical.name),
        normalize_search_text(&obsolete_row.name)
    );
    assert_eq!(
        retained_row.quantity, obsolete_row.quantity,
        "원본 수량이 다릅니다."
    );
    ConfirmedLegacyFollowup::SubscriptionConsolidation(ConfirmedLegacySubscriptionConsolidation {
        canonical_person_id: fields[1].into(),
        duplicate_person_id: fields[2].into(),
        retained_subscription: retained,
        obsolete_subscription: obsolete,
        expected_last_issue: issue(fields[11], fields[12]),
    })
}

fn expectation(
    subscription_id: &str,
    owner_person_id: &str,
    year: &str,
    month: &str,
    source_reference: &str,
) -> LegacySubscriptionExpectation {
    LegacySubscriptionExpectation {
        subscription_id: subscription_id.into(),
        owner_person_id: owner_person_id.into(),
        expected_start: issue(year, month),
        expected_source_reference: source_reference.into(),
    }
}

fn evidence_row<'a>(evidence: &'a [LegacyEvidenceRow], reference: &str) -> &'a LegacyEvidenceRow {
    evidence
        .iter()
        .find(|row| row.source_reference == reference)
        .expect("검증할 원본 행이 없습니다.")
}

fn issue(year: &str, month: &str) -> Issue {
    Issue::new(
        year.parse().expect("연도가 숫자가 아닙니다."),
        month.parse().expect("월이 숫자가 아닙니다."),
    )
    .expect("유효하지 않은 QT 호입니다.")
}

fn required_argument(index: usize, label: &str) -> String {
    env::args()
        .nth(index)
        .unwrap_or_else(|| panic!("{label}를 인자로 전달해야 합니다."))
}
