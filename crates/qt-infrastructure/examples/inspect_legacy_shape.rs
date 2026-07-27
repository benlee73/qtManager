use std::{env, path::Path};

use calamine::{Data, DataType, Reader, Xlsx, open_workbook};
use qt_infrastructure::read_legacy_2026;

const KNOWN_HEADERS: &[&str] = &[
    "수령 여부",
    "수령",
    "이름",
    "이름 및 또래",
    "수량",
    "신청 수량",
    "전화번호",
    "지급방법",
    "구독 시작일",
    "구독 종료일",
    "비고",
    "1달 구독",
    "특이사항",
];

fn main() {
    let path = env::args()
        .nth(1)
        .expect("검사할 XLSX 경로를 전달해야 합니다.");
    let mut workbook: Xlsx<_> = open_workbook(Path::new(&path)).expect("XLSX를 열 수 없습니다.");

    for sheet_name in workbook.sheet_names().to_vec() {
        let range = workbook
            .worksheet_range(&sheet_name)
            .expect("시트를 읽을 수 없습니다.");
        let mut headers = Vec::new();
        let mut boolean_count = 0_u32;
        for (row_index, row) in range.rows().enumerate() {
            for (column_index, cell) in row.iter().enumerate() {
                if matches!(cell, Data::Bool(_)) {
                    boolean_count += 1;
                }
                let text = cell.to_string();
                if KNOWN_HEADERS.iter().any(|header| text.trim() == *header) {
                    headers.push(format!("{text}@R{}C{}", row_index + 1, column_index + 1));
                }
            }
        }
        println!(
            "{sheet_name}: rows={}, cols={}, booleans={}, headers=[{}]",
            range.height(),
            range.width(),
            boolean_count,
            headers.join(", ")
        );
        let first_row = range
            .rows()
            .next()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .map(|(index, value)| format!("C{}={}", index + 1, value))
            .collect::<Vec<_>>();
        println!("  first-row=[{}]", first_row.join(", "));
        let columns = (0..range.width())
            .map(|column| {
                let mut non_empty = 0;
                let mut booleans = 0;
                let mut numbers = 0;
                for row in range.rows().skip(1) {
                    let cell = row.get(column).unwrap_or(&Data::Empty);
                    if !cell.is_empty() {
                        non_empty += 1;
                    }
                    if matches!(cell, Data::Bool(_)) {
                        booleans += 1;
                    }
                    if matches!(cell, Data::Int(_) | Data::Float(_)) {
                        numbers += 1;
                    }
                }
                format!(
                    "C{}:nonempty={non_empty}/bool={booleans}/number={numbers}",
                    column + 1
                )
            })
            .collect::<Vec<_>>();
        println!("  columns=[{}]", columns.join(", "));
    }

    let report = read_legacy_2026(
        Path::new(&path),
        "초기 데이터 이전",
        "2026-07-27T00:00:00+09:00",
    )
    .expect("기존 파일을 변환할 수 없습니다.");
    let counts = report.snapshot.counts();
    println!(
        "migration: people={}, subscriptions={}, distributions={}, purchases={}, checks={}, warnings={} (missing_start={}, receipt_mismatch={})",
        counts.people,
        counts.subscriptions,
        counts.distributions,
        counts.purchases,
        counts.check_items,
        report.warnings,
        report.missing_start_warnings,
        report.receipt_mismatch_warnings
    );
    for (issue, rows, distributions) in report.issue_rows {
        println!(
            "  issue={}~{}: rows={rows}, distributed={distributions}",
            issue.start_month,
            issue.start_month + 1
        );
    }
}
