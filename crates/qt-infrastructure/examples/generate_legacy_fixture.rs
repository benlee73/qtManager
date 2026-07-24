use std::path::Path;

use rust_xlsxwriter::{Format, Workbook};

fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("출력할 XLSX 경로를 인자로 전달해야 합니다.");
    let output = Path::new(&output);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).expect("fixture 출력 폴더를 만들 수 없습니다.");
    }
    let mut workbook = Workbook::new();
    let header = Format::new().set_bold();

    for sheet_name in ["1,2월", "3,4월", "5,6월", "7,8월"] {
        let sheet = workbook.add_worksheet();
        sheet.set_name(sheet_name).unwrap();
        for (column, value) in [
            "수령 여부",
            "이름 및 또래",
            "신청 수량",
            "전화번호",
            "지급방법",
            "구독 시작일",
            "구독 종료일",
            "비고",
        ]
        .iter()
        .enumerate()
        {
            sheet
                .write_string_with_format(0, column as u16, *value, &header)
                .unwrap();
        }
    }

    let first = workbook.worksheet_from_name("1,2월").unwrap();
    first.write_boolean(1, 0, true).unwrap();
    first.write_string(1, 1, "가상신청자 00").unwrap();
    first.write_number(1, 2, 2).unwrap();
    first.write_string(1, 3, "010-0000-0000").unwrap();
    first.write_string(1, 4, "익명 fixture").unwrap();
    first.write_string(1, 5, "2026-01-01").unwrap();
    first.write_string(1, 6, "2026-11-01").unwrap();
    first
        .write_string(1, 7, "실제 운영 데이터가 아닌 가상 행")
        .unwrap();

    workbook.save(output).unwrap();
}
