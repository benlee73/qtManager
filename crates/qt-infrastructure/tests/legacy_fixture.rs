use std::path::PathBuf;

use calamine::{Reader, Xlsx, open_workbook};
use qt_infrastructure::read_legacy_2026;
use rust_xlsxwriter::Workbook;

#[test]
fn anonymous_legacy_fixture_has_expected_monthly_sheets() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-2026-anonymous.xlsx");
    let workbook: Xlsx<_> = open_workbook(path).unwrap();

    assert_eq!(
        workbook.sheet_names(),
        &["1,2월", "3,4월", "5,6월", "7,8월"]
    );
}

#[test]
fn anonymous_legacy_fixture_migrates_people_subscriptions_and_receipts() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/legacy-2026-anonymous.xlsx");

    let report = read_legacy_2026(&path, "가상담당자", "2026-07-27T00:00:00+09:00").unwrap();

    assert_eq!(report.snapshot.people.len(), 1);
    assert_eq!(report.snapshot.people[0].cohort.as_deref(), Some("00"));
    assert_eq!(report.snapshot.subscriptions.len(), 1);
    assert_eq!(report.snapshot.subscriptions[0].quantity, 2);
    assert_eq!(report.snapshot.distributions.len(), 1);
    assert_eq!(report.snapshot.distributions[0].quantity, 2);
    assert_eq!(report.warnings, 0);
}

#[test]
fn conflicting_start_and_end_dates_remain_explicitly_unverified() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("conflicting-period.xlsx");
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("1,2월").unwrap();
    for (column, header) in ["이름", "수량", "전화번호", "구독 시작일", "구독 종료일"]
        .iter()
        .enumerate()
    {
        sheet.write_string(0, column as u16, *header).unwrap();
    }
    sheet.write_string(1, 0, "00 가상 신청자").unwrap();
    sheet.write_number(1, 1, 1).unwrap();
    sheet.write_string(1, 2, "010-0000-0000").unwrap();
    sheet.write_string(1, 3, "26.01").unwrap();
    sheet.write_string(1, 4, "27.03").unwrap();
    workbook.save(&path).unwrap();

    let report = read_legacy_2026(&path, "가상담당자", IMPORTED_AT).unwrap();

    assert!(report.snapshot.check_items.iter().any(|item| {
        item.content == "구독 시작·종료 호 불일치"
            && item.person_id.as_deref() == Some(report.snapshot.people[0].id.as_str())
    }));
}

const IMPORTED_AT: &str = "2026-07-27T00:00:00+09:00";
