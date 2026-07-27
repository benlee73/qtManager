use std::path::PathBuf;

use calamine::{Reader, Xlsx, open_workbook};
use qt_infrastructure::read_legacy_2026;

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
