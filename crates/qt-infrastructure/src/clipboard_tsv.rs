use qt_application::{
    ApplicationClipboardParser, ClipboardColumnMapping, ClipboardParseResult, ParsedApplicationRow,
    stable_fingerprint,
};
use qt_domain::{Issue, format_phone, normalize_phone, normalize_search_text};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Default)]
pub struct TsvApplicationClipboardParser;

impl ApplicationClipboardParser for TsvApplicationClipboardParser {
    fn parse(
        &self,
        text: &str,
        default_issue_year: i32,
        requested_mapping: Option<ClipboardColumnMapping>,
    ) -> ClipboardParseResult {
        let mut rows = text
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                let mut cells = line
                    .split('\t')
                    .map(|cell| cell.trim().to_owned())
                    .collect::<Vec<_>>();
                while cells.last().is_some_and(String::is_empty) {
                    cells.pop();
                }
                (!cells.iter().all(String::is_empty)).then_some((index + 1, cells))
            })
            .collect::<Vec<_>>();

        if rows.is_empty() {
            return ClipboardParseResult {
                rows: Vec::new(),
                detected_mapping: requested_mapping,
                needs_mapping: false,
                ignored_payment_column: false,
            };
        }

        let header = detect_header(&rows[0].1);
        let header_present = header.is_some() || looks_like_header(&rows[0].1);
        let mapping = requested_mapping.or(header);
        let ignored_payment_column = rows.iter().any(|(_, cells)| {
            cells
                .iter()
                .any(|cell| normalize_header(cell).contains("입금"))
        }) || rows
            .iter()
            .skip(usize::from(header_present))
            .any(|(_, cells)| inferred_has_payment(cells));

        if header_present {
            rows.remove(0);
        }

        let needs_mapping =
            mapping.is_none() && rows.iter().any(|(_, cells)| !matches!(cells.len(), 5..=7));
        if needs_mapping {
            return ClipboardParseResult {
                rows: Vec::new(),
                detected_mapping: None,
                needs_mapping: true,
                ignored_payment_column,
            };
        }
        if header_present && mapping.is_none() {
            return ClipboardParseResult {
                rows: Vec::new(),
                detected_mapping: None,
                needs_mapping: true,
                ignored_payment_column,
            };
        }

        ClipboardParseResult {
            rows: rows
                .into_iter()
                .map(|(row_number, cells)| {
                    parse_row(row_number, &cells, default_issue_year, mapping)
                })
                .collect(),
            detected_mapping: mapping,
            needs_mapping: false,
            ignored_payment_column,
        }
    }
}

fn parse_row(
    row_number: usize,
    cells: &[String],
    default_issue_year: i32,
    mapping: Option<ClipboardColumnMapping>,
) -> ParsedApplicationRow {
    let mapping = mapping.unwrap_or_else(|| inferred_mapping(cells));
    let submitted_at = mapping
        .submitted_at
        .and_then(|index| cells.get(index))
        .filter(|value| !value.is_empty())
        .map(|value| parse_korean_timestamp(value));
    let name = cell(cells, mapping.name);
    let cohort = cell(cells, mapping.cohort);
    let phone = cell(cells, mapping.phone)
        .map(|value| format_phone(&value).ok().flatten().unwrap_or(value));
    let issue_text = cell(cells, mapping.start_issue);
    let quantity_text = cell(cells, mapping.quantity);

    let error = submitted_at
        .as_ref()
        .and_then(|result| result.as_ref().err().cloned())
        .or_else(|| validate_name(name.as_deref()))
        .or_else(|| validate_cohort(cohort.as_deref()))
        .or_else(|| validate_phone(phone.as_deref()))
        .or_else(|| {
            issue_text
                .as_deref()
                .ok_or_else(|| "구독 시작 호가 비어 있습니다.".to_owned())
                .and_then(|value| {
                    parse_issue(
                        value,
                        submitted_year(submitted_at.as_ref()).unwrap_or(default_issue_year),
                    )
                    .map(|_| ())
                })
                .err()
        })
        .or_else(|| {
            quantity_text
                .as_deref()
                .ok_or_else(|| "수량이 비어 있습니다.".to_owned())
                .and_then(|value| parse_quantity(value).map(|_| ()))
                .err()
        });

    let normalized_submitted_at = submitted_at.and_then(Result::ok);
    let year =
        submitted_year_from_value(normalized_submitted_at.as_deref()).unwrap_or(default_issue_year);
    let start_issue = issue_text
        .as_deref()
        .and_then(|value| parse_issue(value, year).ok());
    let quantity = quantity_text
        .as_deref()
        .and_then(|value| parse_quantity(value).ok());
    let fingerprint = if error.is_none() {
        Some(application_fingerprint(
            normalized_submitted_at.as_deref(),
            name.as_deref().unwrap_or_default(),
            cohort.as_deref().unwrap_or_default(),
            phone.as_deref().unwrap_or_default(),
            start_issue.expect("오류가 없으면 QT 호가 존재함"),
            quantity.expect("오류가 없으면 수량이 존재함"),
        ))
    } else {
        None
    };

    ParsedApplicationRow {
        row_number,
        submitted_at: normalized_submitted_at,
        name,
        cohort,
        phone,
        start_issue,
        quantity,
        fingerprint,
        error,
    }
}

fn inferred_mapping(cells: &[String]) -> ClipboardColumnMapping {
    let has_timestamp = cells
        .first()
        .is_some_and(|value| looks_like_timestamp(value));
    if has_timestamp {
        ClipboardColumnMapping {
            submitted_at: Some(0),
            name: 1,
            cohort: 2,
            phone: 3,
            start_issue: 4,
            quantity: 5,
        }
    } else {
        ClipboardColumnMapping {
            submitted_at: None,
            name: 0,
            cohort: 1,
            phone: 2,
            start_issue: 3,
            quantity: 4,
        }
    }
}

fn detect_header(cells: &[String]) -> Option<ClipboardColumnMapping> {
    if !looks_like_header(cells) {
        return None;
    }
    let find = |aliases: &[&str]| {
        cells.iter().position(|cell| {
            let normalized = normalize_header(cell);
            aliases
                .iter()
                .any(|alias| normalized.contains(&normalize_header(alias)))
        })
    };
    Some(ClipboardColumnMapping {
        submitted_at: find(&["타임스탬프", "제출시각", "응답시간", "시간"]),
        name: find(&["성함", "이름"])?,
        cohort: find(&["또래"])?,
        phone: find(&["연락처", "전화번호"])?,
        start_issue: find(&["구독시작시점", "구독시작", "시작시점"])?,
        quantity: find(&["수량"])?,
    })
}

fn looks_like_header(cells: &[String]) -> bool {
    cells.iter().any(|cell| {
        let normalized = normalize_header(cell);
        ["성함", "또래", "연락처", "구독시작", "수량", "타임스탬프"]
            .iter()
            .any(|keyword| normalized.contains(keyword))
    })
}

fn normalize_header(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace() && !character.is_ascii_punctuation())
        .collect::<String>()
        .to_lowercase()
}

fn looks_like_timestamp(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.contains("오전") || trimmed.contains("오후"))
        && trimmed
            .split(['.', '-', '/'])
            .next()
            .is_some_and(|year| year.trim().parse::<i32>().is_ok())
}

fn parse_korean_timestamp(value: &str) -> Result<String, String> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 5 || !matches!(parts[3], "오전" | "오후") {
        return Err("제출 시각 형식을 읽을 수 없습니다.".into());
    }
    let year = numeric_part(parts[0])?;
    let month = numeric_part(parts[1])?;
    let day = numeric_part(parts[2])?;
    let time = parts[4]
        .split(':')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "제출 시각 형식을 읽을 수 없습니다.".to_owned())?;
    if time.len() != 3 || time[0] == 0 || time[0] > 12 || time[1] > 59 || time[2] > 59 {
        return Err("제출 시각 값이 올바르지 않습니다.".into());
    }
    let hour = match (parts[3], time[0]) {
        ("오전", 12) => 0,
        ("오후", 12) => 12,
        ("오후", hour) => hour + 12,
        (_, hour) => hour,
    };
    let timestamp = format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{:02}:{:02}+09:00",
        time[1], time[2]
    );
    OffsetDateTime::parse(&timestamp, &Rfc3339)
        .map_err(|_| "제출 날짜 또는 시각 값이 올바르지 않습니다.".to_owned())?;
    Ok(timestamp)
}

fn numeric_part(value: &str) -> Result<i32, String> {
    value
        .trim_end_matches('.')
        .parse()
        .map_err(|_| "제출 시각 형식을 읽을 수 없습니다.".to_owned())
}

fn submitted_year(value: Option<&Result<String, String>>) -> Option<i32> {
    value
        .and_then(|result| result.as_ref().ok())
        .and_then(|timestamp| submitted_year_from_value(Some(timestamp)))
}

fn submitted_year_from_value(value: Option<&str>) -> Option<i32> {
    value
        .and_then(|timestamp| timestamp.get(..4))
        .and_then(|year| year.parse().ok())
}

fn parse_issue(value: &str, year: i32) -> Result<Issue, String> {
    let numbers = value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "구독 시작 호를 읽을 수 없습니다.".to_owned())?;
    if numbers.len() < 2 || numbers[1] != numbers[0] + 1 {
        return Err("구독 시작 호는 ‘1-2월호’ 같은 형식이어야 합니다.".into());
    }
    Issue::new(year, numbers[0]).map_err(|_| "구독 시작 호가 올바르지 않습니다.".into())
}

fn parse_quantity(value: &str) -> Result<u32, String> {
    value
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|quantity| *quantity > 0)
        .ok_or_else(|| "수량은 1 이상의 숫자여야 합니다.".into())
}

fn validate_name(value: Option<&str>) -> Option<String> {
    value
        .is_none_or(str::is_empty)
        .then(|| "성함이 비어 있습니다.".into())
}

fn validate_cohort(value: Option<&str>) -> Option<String> {
    let valid = value.is_some_and(|cohort| {
        cohort.len() == 2 && cohort.bytes().all(|byte| byte.is_ascii_digit())
    });
    (!valid).then(|| "또래는 ‘95’ 같은 두 자리 숫자여야 합니다.".into())
}

fn validate_phone(value: Option<&str>) -> Option<String> {
    let valid = value.is_some_and(|phone| format_phone(phone).is_ok_and(|item| item.is_some()));
    (!valid).then(|| "연락처는 010-xxxx-xxxx 형식이어야 합니다.".into())
}

fn cell(cells: &[String], index: usize) -> Option<String> {
    cells.get(index).cloned().filter(|value| !value.is_empty())
}

fn inferred_has_payment(cells: &[String]) -> bool {
    (looks_like_timestamp(cells.first().map_or("", String::as_str)) && cells.len() >= 7)
        || (!looks_like_timestamp(cells.first().map_or("", String::as_str)) && cells.len() >= 6)
}

fn application_fingerprint(
    submitted_at: Option<&str>,
    name: &str,
    cohort: &str,
    phone: &str,
    issue: Issue,
    quantity: u32,
) -> String {
    stable_fingerprint(&format!(
        "{}|{}|{}|{}|{}|{}|{}",
        submitted_at.unwrap_or("-"),
        normalize_search_text(name),
        cohort,
        normalize_phone(phone),
        issue.year,
        issue.start_month,
        quantity
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMED_WITH_PAYMENT: &str =
        "2026. 2. 1 오후 7:48:08\t가상응답자\t00\t010-0000-0000\t1-2월호\t1\t네";

    #[test]
    fn canonicalizes_phone_preview_and_ignores_the_confirmation_response_in_identity() {
        let parser = TsvApplicationClipboardParser;
        let rows = parser.parse(
            "2026. 8. 23 오후 3:39:01\t가상신청자\t00\t01000000000\t9-10월호\t1\t네 확인했습니다.",
            2026,
            None,
        );
        let same = parser.parse(
            "2026. 8. 23 오후 3:39:01\t가상신청자\t00\t010-0000-0000\t9-10월호\t1\t다른 응답",
            2026,
            None,
        );
        assert_eq!(rows.rows[0].phone.as_deref(), Some("010-0000-0000"));
        assert_eq!(rows.rows[0].fingerprint, same.rows[0].fingerprint);
        assert!(rows.ignored_payment_column);
        assert!(rows.rows[0].error.is_none());
    }

    #[test]
    fn parses_all_provided_shape_variants_and_ignores_trailing_empty_cells() {
        let text = [
            "가상응답자\t00\t010-0000-0000\t1-2월호\t1\t네",
            "2026. 2. 1 오후 7:48:08\t가상응답자\t00\t010-0000-0000\t1-2월호\t1\t네\t\t",
            "2026. 2. 1 오후 7:48:08\t가상응답자\t00\t010-0000-0000\t1-2월호\t1",
            "가상응답자\t00\t010-0000-0000\t1-2월호\t1",
        ]
        .join("\n");
        let parsed = TsvApplicationClipboardParser.parse(&text, 2027, None);

        assert_eq!(parsed.rows.len(), 4);
        assert!(parsed.rows.iter().all(|row| row.error.is_none()));
        assert_eq!(
            parsed.rows[0].start_issue,
            Some(Issue::new(2027, 1).unwrap())
        );
        assert_eq!(
            parsed.rows[1].start_issue,
            Some(Issue::new(2026, 1).unwrap())
        );
        assert!(parsed.ignored_payment_column);
    }

    #[test]
    fn recognizes_header_aliases_and_does_not_return_header_as_data() {
        let text = format!(
            "타임스탬프\t성함\t또래\t연락처\t구독 시작 시점\t수량\t입금 여부\n{TIMED_WITH_PAYMENT}"
        );
        let parsed = TsvApplicationClipboardParser.parse(&text, 2027, None);

        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].row_number, 2);
        assert!(parsed.detected_mapping.is_some());
    }

    #[test]
    fn reports_row_errors_without_discarding_valid_rows() {
        let text = format!("{TIMED_WITH_PAYMENT}\n가상오류\t0\t전화번호\t2월호\t0");
        let parsed = TsvApplicationClipboardParser.parse(&text, 2026, None);

        assert!(parsed.rows[0].error.is_none());
        assert!(parsed.rows[1].error.is_some());
        assert!(parsed.rows[1].fingerprint.is_none());
    }

    #[test]
    fn same_normalized_response_has_stable_fingerprint() {
        let first = TsvApplicationClipboardParser.parse(TIMED_WITH_PAYMENT, 2026, None);
        let second = TsvApplicationClipboardParser.parse(
            "2026. 2. 1 오후 7:48:08\t가상 응답자\t00\t01000000000\t1-2월호\t1",
            2026,
            None,
        );
        assert_eq!(first.rows[0].fingerprint, second.rows[0].fingerprint);
    }

    #[test]
    fn requires_mapping_for_unrecognized_extra_columns() {
        let parsed = TsvApplicationClipboardParser.parse(
            "가상응답자\t00\t010-0000-0000\t1-2월호\t1\t예비1\t예비2\t예비3",
            2026,
            None,
        );
        assert!(parsed.needs_mapping);
        assert!(parsed.rows.is_empty());
    }
}
