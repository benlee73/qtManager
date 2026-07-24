use std::path::PathBuf;

use calamine::{Reader, Xlsx, open_workbook};

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
