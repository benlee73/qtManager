use std::{collections::HashMap, path::Path};

use calamine::{Data, ExcelDateTime, ExcelDateTimeType, Reader, Xlsx, XlsxError, open_workbook};
use qt_application::{StateSetting, StateSnapshot};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, Issue, OneTimePurchase, Person,
    PersonStatus, Subscription, SubscriptionSource, normalize_phone,
};
use uuid::Uuid;

use qt_application::PortError;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LegacyMigrationReport {
    pub snapshot: StateSnapshot,
    pub warnings: usize,
    pub missing_start_warnings: usize,
    pub receipt_mismatch_warnings: usize,
    pub issue_rows: Vec<(Issue, usize, usize)>,
}

/// Reads the one-off 2026 workbook without modifying it. The legacy sheets move
/// the main table between columns, so columns are located by their Korean
/// headers instead of fixed coordinates.
pub fn read_legacy_2026(
    path: &Path,
    operator_name: &str,
    now: &str,
) -> Result<LegacyMigrationReport, PortError> {
    let mut workbook: Xlsx<_> = open_workbook(path).map_err(calamine_error)?;
    let mut report = LegacyMigrationReport::default();
    let mut people_by_identity = HashMap::<String, usize>::new();
    let mut subscriptions_by_key = HashMap::<String, usize>::new();

    report.snapshot.settings.push(StateSetting {
        key: "current_operator_name".into(),
        value: operator_name.into(),
        created_at: now.into(),
        updated_at: now.into(),
    });

    for sheet_name in workbook.sheet_names().to_vec() {
        let Some(issue) = issue_from_sheet_name(&sheet_name) else {
            continue;
        };
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| legacy_error(error.to_string()))?;
        let Some(header) = range.rows().next() else {
            continue;
        };
        let name_column = find_header(header, &["이름", "이름 및 또래"])
            .ok_or_else(|| legacy_error(format!("{sheet_name} 시트에 이름 열이 없습니다.")))?;
        let receipt_column = find_header(header, &["수령", "수령 여부"]);
        let phone_column = find_header(header, &["전화번호"]);
        let start_column = find_header(header, &["구독 시작일"]);
        let end_column = find_header(header, &["구독 종료일"]);
        let note_column = find_header(header, &["비고"]);
        let purchase_column = find_header(header, &["1달 구독"]);
        let quantity_column =
            find_header(header, &["신청 수량", "수량"]).unwrap_or(name_column + 1);
        let mut main_rows = 0;
        let mut distributed_rows = 0;

        for (offset, row) in range.rows().skip(1).enumerate() {
            let row_number = offset + 2;
            let raw_identity = text(row.get(name_column));
            if !raw_identity.is_empty() {
                main_rows += 1;
                let (name, cohort) = split_identity(&raw_identity);
                if name.is_empty() {
                    report.warnings += 1;
                    continue;
                }
                let phone = phone_column
                    .and_then(|column| clean_text(row.get(column)))
                    .filter(|value| normalize_phone(value).len() >= 8);
                let identity_key = identity_key(&name, cohort.as_deref(), phone.as_deref());
                let person_index = if let Some(index) = people_by_identity.get(&identity_key) {
                    *index
                } else if let Some(index) =
                    compatible_identity(&report.snapshot.people, &name, cohort.as_deref(), &phone)
                {
                    people_by_identity.insert(identity_key, index);
                    index
                } else {
                    let person = Person {
                        id: new_id("legacy-person"),
                        name: name.clone(),
                        cohort: cohort.clone(),
                        phone: phone.clone(),
                        normalized_phone: phone.as_deref().map(normalize_phone),
                        status: PersonStatus::Active,
                        person_note: note_column.and_then(|column| clean_text(row.get(column))),
                        created_at: now.into(),
                        updated_at: now.into(),
                    };
                    let index = report.snapshot.people.len();
                    people_by_identity.insert(identity_key, index);
                    report.snapshot.people.push(person);
                    index
                };
                let person_id = report.snapshot.people[person_index].id.clone();
                if let Some(note) = note_column.and_then(|column| clean_text(row.get(column))) {
                    merge_person_note(&mut report.snapshot.people[person_index], &note);
                }
                let quantity = positive_integer(row.get(quantity_column)).unwrap_or(1);
                let parsed_start = start_column
                    .and_then(|column| issue_from_cell(row.get(column)))
                    .or_else(|| {
                        end_column
                            .and_then(|column| issue_from_cell(row.get(column)))
                            .map(|end| move_issue(end, -5))
                    });
                let existing_start = report
                    .snapshot
                    .subscriptions
                    .iter()
                    .filter(|subscription| {
                        subscription.person_id == person_id
                            && subscription.quantity == quantity
                            && subscription.includes(issue).unwrap_or(false)
                    })
                    .map(|subscription| subscription.start_issue)
                    .collect::<Vec<_>>();
                let start_issue = parsed_start
                    .or_else(|| {
                        if existing_start.len() == 1 {
                            Some(existing_start[0])
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| {
                        report.warnings += 1;
                        report.missing_start_warnings += 1;
                        add_warning_note(
                            &mut report.snapshot,
                            &person_id,
                            operator_name,
                            now,
                            "구독 시작 호 확인",
                        );
                        issue
                    });
                let subscription_key = format!(
                    "{person_id}:{}:{}:{quantity}",
                    start_issue.year, start_issue.start_month
                );
                let subscription_index =
                    if let Some(index) = subscriptions_by_key.get(&subscription_key) {
                        *index
                    } else {
                        let subscription = Subscription {
                            id: new_id("legacy-subscription"),
                            person_id: person_id.clone(),
                            start_issue,
                            issue_count: 6,
                            quantity,
                            applied_at: None,
                            source: SubscriptionSource::LegacyXlsx,
                            source_reference: Some(format!("2026:{sheet_name}:row-{row_number}")),
                            memo: Some("2026년 기존 배부현황 최초 이전".into()),
                            created_at: now.into(),
                            updated_at: now.into(),
                            archived_at: None,
                        };
                        let index = report.snapshot.subscriptions.len();
                        subscriptions_by_key.insert(subscription_key, index);
                        report.snapshot.subscriptions.push(subscription);
                        index
                    };
                let subscription = &report.snapshot.subscriptions[subscription_index];
                let subscription_id = subscription.id.clone();
                let subscription_quantity = subscription.quantity;
                let subscription_includes_issue = subscription.includes(issue).unwrap_or(false);
                let received = receipt_column
                    .and_then(|column| row.get(column))
                    .is_some_and(cell_is_checked);
                if received && subscription_includes_issue {
                    distributed_rows += 1;
                    let distribution = Distribution {
                        id: new_id("legacy-distribution"),
                        subscription_id: subscription_id.clone(),
                        issue,
                        quantity: subscription_quantity,
                        distributed_at: now.into(),
                        note: Some("2026년 기존 배부현황 수령 체크 이전".into()),
                        reversal_of: None,
                        created_at: now.into(),
                        updated_at: now.into(),
                    };
                    report.snapshot.distributions.push(distribution);
                } else if received {
                    distributed_rows += 1;
                    report.warnings += 1;
                    report.receipt_mismatch_warnings += 1;
                    add_warning_note(
                        &mut report.snapshot,
                        &person_id,
                        operator_name,
                        now,
                        "수령 체크와 구독 호 불일치",
                    );
                    report.snapshot.distributions.push(Distribution {
                        id: new_id("legacy-distribution"),
                        subscription_id,
                        issue,
                        quantity: subscription_quantity,
                        distributed_at: now.into(),
                        note: Some("2026년 기존 배부현황 수령 체크 이전·호 확인 필요".into()),
                        reversal_of: None,
                        created_at: now.into(),
                        updated_at: now.into(),
                    });
                }
            }

            if let Some(column) = purchase_column {
                let buyer_name = clean_text(row.get(column));
                if let Some(buyer_name) = buyer_name {
                    let quantity = positive_integer(row.get(column + 2)).unwrap_or(1);
                    report.snapshot.purchases.push(OneTimePurchase {
                        id: new_id("legacy-purchase"),
                        person_id: None,
                        buyer_name: Some(buyer_name),
                        issue,
                        quantity,
                        purchased_at: now.into(),
                        note: Some("2026년 기존 배부현황 1달 구독 영역 이전".into()),
                        reversal_of: None,
                        created_at: now.into(),
                        updated_at: now.into(),
                    });
                }
            }
        }
        report.issue_rows.push((issue, main_rows, distributed_rows));
    }

    append_change_logs(&mut report.snapshot, operator_name, now);
    Ok(report)
}

fn find_header(row: &[Data], expected: &[&str]) -> Option<usize> {
    row.iter()
        .position(|value| expected.contains(&value.to_string().trim()))
}

fn text(cell: Option<&Data>) -> String {
    cell.map(ToString::to_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn clean_text(cell: Option<&Data>) -> Option<String> {
    let value = text(cell);
    (!value.is_empty()).then_some(value)
}

fn positive_integer(cell: Option<&Data>) -> Option<u32> {
    match cell {
        Some(Data::Int(value)) => u32::try_from(*value).ok().filter(|value| *value > 0),
        Some(Data::Float(value)) if *value > 0.0 => Some(*value as u32),
        Some(value) => value
            .to_string()
            .trim()
            .parse()
            .ok()
            .filter(|value| *value > 0),
        None => None,
    }
}

fn cell_is_checked(cell: &Data) -> bool {
    match cell {
        Data::Bool(value) => *value,
        Data::Int(value) => *value != 0,
        Data::Float(value) => *value != 0.0,
        value => matches!(
            value.to_string().trim().to_lowercase().as_str(),
            "true" | "yes" | "y" | "o" | "완료" | "수령"
        ),
    }
}

fn issue_from_sheet_name(name: &str) -> Option<Issue> {
    let start_month = name
        .split(|character: char| !character.is_ascii_digit())
        .find(|part| !part.is_empty())?
        .parse()
        .ok()?;
    Issue::new(2026, start_month).ok()
}

fn issue_from_cell(cell: Option<&Data>) -> Option<Issue> {
    let value = cell?;
    let excel_date = match value {
        Data::DateTime(date) => Some(*date),
        Data::Float(serial) if *serial > 30_000.0 => Some(ExcelDateTime::new(
            *serial,
            ExcelDateTimeType::DateTime,
            false,
        )),
        Data::Int(serial) if *serial > 30_000 => Some(ExcelDateTime::new(
            *serial as f64,
            ExcelDateTimeType::DateTime,
            false,
        )),
        _ => None,
    };
    if let Some(date) = excel_date {
        let (year, month, ..) = date.to_ymd_hms_milli();
        let start_month = if month % 2 == 0 { month - 1 } else { month };
        return Issue::new(i32::from(year), start_month).ok();
    }
    let display = value.to_string();
    let numbers = display
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<i32>().ok())
        .collect::<Vec<_>>();
    let year_index = numbers.iter().position(|number| *number >= 2000)?;
    let year = *numbers.get(year_index)?;
    let month = u8::try_from(*numbers.get(year_index + 1)?).ok()?;
    let start_month = if month % 2 == 0 { month - 1 } else { month };
    Issue::new(year, start_month).ok()
}

fn split_identity(raw: &str) -> (String, Option<String>) {
    let mut cohort = None;
    let mut name = Vec::new();
    for token in raw.split_whitespace() {
        let trimmed = token
            .trim_matches(|character: char| matches!(character, '(' | ')' | '[' | ']' | ',' | '/'));
        if cohort.is_none()
            && trimmed.len() == 2
            && trimmed.chars().all(|character| character.is_ascii_digit())
        {
            cohort = Some(trimmed.into());
        } else {
            name.push(token);
        }
    }
    (name.join(" ").trim().to_string(), cohort)
}

fn identity_key(name: &str, cohort: Option<&str>, phone: Option<&str>) -> String {
    format!(
        "{}|{}|{}",
        name.split_whitespace().collect::<String>(),
        cohort.unwrap_or_default(),
        phone.map(normalize_phone).unwrap_or_default()
    )
}

fn compatible_identity(
    people: &[Person],
    name: &str,
    cohort: Option<&str>,
    phone: &Option<String>,
) -> Option<usize> {
    let candidates = people
        .iter()
        .enumerate()
        .filter(|(_, person)| {
            person.name.split_whitespace().collect::<String>()
                == name.split_whitespace().collect::<String>()
                && person.cohort.as_deref() == cohort
                && (phone.is_none()
                    || person.phone.is_none()
                    || person.normalized_phone == phone.as_deref().map(normalize_phone))
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if candidates.len() == 1 {
        Some(candidates[0])
    } else {
        None
    }
}

fn merge_person_note(person: &mut Person, note: &str) {
    match &mut person.person_note {
        Some(current) if !current.contains(note) => {
            current.push_str(" / ");
            current.push_str(note);
        }
        None => person.person_note = Some(note.into()),
        _ => {}
    }
}

fn move_issue(issue: Issue, steps: i32) -> Issue {
    let absolute = issue.year * 6 + i32::from((issue.start_month - 1) / 2) + steps;
    let year = absolute.div_euclid(6);
    let index = absolute.rem_euclid(6);
    Issue::new(year, (index * 2 + 1) as u8).expect("계산된 호는 유효해야 합니다.")
}

fn add_warning_note(
    snapshot: &mut StateSnapshot,
    person_id: &str,
    operator_name: &str,
    now: &str,
    content: &str,
) {
    if snapshot
        .check_items
        .iter()
        .any(|item| item.person_id.as_deref() == Some(person_id) && item.content == content)
    {
        return;
    }
    snapshot.check_items.push(CheckItem {
        id: new_id("legacy-check"),
        person_id: Some(person_id.into()),
        content: content.into(),
        status: CheckItemStatus::NeedsCheck,
        operator_name: operator_name.into(),
        created_at: now.into(),
        updated_at: now.into(),
        checked_at: None,
    });
}

fn append_change_logs(snapshot: &mut StateSnapshot, operator_name: &str, now: &str) {
    for (entity_type, entity_ids) in [
        (
            "person",
            snapshot
                .people
                .iter()
                .map(|value| value.id.clone())
                .collect::<Vec<_>>(),
        ),
        (
            "subscription",
            snapshot
                .subscriptions
                .iter()
                .map(|value| value.id.clone())
                .collect(),
        ),
        (
            "distribution",
            snapshot
                .distributions
                .iter()
                .map(|value| value.id.clone())
                .collect(),
        ),
        (
            "one_time_purchase",
            snapshot
                .purchases
                .iter()
                .map(|value| value.id.clone())
                .collect(),
        ),
        (
            "check_item",
            snapshot
                .check_items
                .iter()
                .map(|value| value.id.clone())
                .collect(),
        ),
    ] {
        for entity_id in entity_ids {
            snapshot.changes.push(ChangeLog {
                id: new_id("legacy-change"),
                occurred_at: now.into(),
                operator_name: operator_name.into(),
                action_type: "legacy_2026_migrated".into(),
                entity_type: entity_type.into(),
                entity_id,
                summary: "2026년 기존 배부현황 최초 이전".into(),
                before_json: None,
                after_json: None,
            });
        }
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn legacy_error(message: String) -> PortError {
    PortError::new(format!("2026년 기존 배부현황을 읽지 못했습니다: {message}"))
}

fn calamine_error(error: XlsxError) -> PortError {
    legacy_error(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_identity_without_losing_leading_zero_cohort() {
        assert_eq!(
            split_identity("가상 신청자 (00)"),
            ("가상 신청자".into(), Some("00".into()))
        );
        assert_eq!(
            split_identity("94 가상 신청자"),
            ("가상 신청자".into(), Some("94".into()))
        );
    }
}
