use std::{collections::HashMap, path::Path};

use calamine::{Data, DataType, Reader, Xlsx, open_workbook};
use qt_application::{
    PortError, StatePinnedNote, StateSetting, StateSnapshot, StateWorkbookMetadata, StateWorkbookV1,
};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, Issue, Memo, MemoStatus,
    OneTimePurchase, Person, PersonStatus, PinnedNoteStatus, ProbePerson,
    STATE_XLSX_FORMAT_VERSION, Subscription,
    SubscriptionSource,
};
use rust_xlsxwriter::{Format, Workbook, Worksheet};

use qt_application::StateWorkbook;

const INFO: &str = "안내";
const SETTINGS: &str = "설정";
const PEOPLE: &str = "QT신청자";
const SUBSCRIPTIONS: &str = "구독";
const DISTRIBUTIONS: &str = "배부";
const PURCHASES: &str = "개별구매";
const MEMOS: &str = "메모";
// 버전 1 파일을 읽기 위한 호환 시트 이름이다. 새 파일에는 쓰지 않는다.
const CHECK_ITEMS: &str = "확인할일";
const PINNED_NOTES: &str = "고정메모";
const CHANGES: &str = "변경이력";
const ISSUE_REPORT: &str = "호별현황";

pub struct XlsxStateWorkbook;

impl StateWorkbookV1 for XlsxStateWorkbook {
    fn write_state(
        &self,
        path: &Path,
        snapshot: &StateSnapshot,
        app_version: &str,
        created_at: &str,
    ) -> Result<(), PortError> {
        let mut workbook = Workbook::new();
        let header = header_format();
        write_info(
            workbook.add_worksheet(),
            snapshot,
            app_version,
            created_at,
            &header,
        )?;
        write_settings(workbook.add_worksheet(), &snapshot.settings, &header)?;
        write_people(workbook.add_worksheet(), &snapshot.people, &header)?;
        write_subscriptions(workbook.add_worksheet(), &snapshot.subscriptions, &header)?;
        write_distributions(workbook.add_worksheet(), &snapshot.distributions, &header)?;
        write_purchases(workbook.add_worksheet(), &snapshot.purchases, &header)?;
        write_memos(workbook.add_worksheet(), &snapshot_memos(snapshot), &header)?;
        write_changes(workbook.add_worksheet(), &snapshot.changes, &header)?;
        write_issue_report(workbook.add_worksheet(), snapshot, &header)?;
        workbook.save(path).map_err(xlsx_error)
    }

    fn read_state(&self, path: &Path) -> Result<(StateWorkbookMetadata, StateSnapshot), PortError> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(calamine_error)?;
        let info = workbook.worksheet_range(INFO).map_err(calamine_error)?;
        let info_values = key_values(&info);
        let version = info_values
            .get("format_version")
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| PortError::new("XLSX 안내 시트의 format_version이 없습니다."))?;
        if version != 1 && version != STATE_XLSX_FORMAT_VERSION {
            return Err(PortError::new(format!(
                "지원하지 않는 XLSX 형식 버전입니다: {version}"
            )));
        }
        let metadata = StateWorkbookMetadata {
            format_version: version,
            app_version: required_map(&info_values, "app_version")?,
            created_at: required_map(&info_values, "created_at")?,
        };
        let mut snapshot = StateSnapshot {
            settings: parse_rows(&mut workbook, SETTINGS, parse_setting)?,
            people: parse_rows(&mut workbook, PEOPLE, parse_person)?,
            subscriptions: parse_rows(&mut workbook, SUBSCRIPTIONS, parse_subscription)?,
            distributions: parse_rows(&mut workbook, DISTRIBUTIONS, parse_distribution)?,
            purchases: parse_rows(&mut workbook, PURCHASES, parse_purchase)?,
            check_items: Vec::new(),
            pinned_notes: Vec::new(),
            changes: parse_rows(&mut workbook, CHANGES, parse_change)?,
        };
        if version == 1 {
            require_sheets(&workbook, true)?;
            snapshot.check_items = parse_rows(&mut workbook, "확인할일", parse_check_item)?;
            snapshot.pinned_notes = parse_rows(&mut workbook, "고정메모", parse_pinned_note)?;
        } else {
            require_sheets(&workbook, false)?;
            let memos = parse_rows(&mut workbook, MEMOS, parse_memo)?;
            snapshot_from_memos(&mut snapshot, memos)?;
        }
        validate_relations(&snapshot)?;
        Ok((metadata, snapshot))
    }
}

// Phase 0 수직 검증 계약은 전체 상태 writer의 일부를 이용해 계속 유지한다.
impl StateWorkbook for XlsxStateWorkbook {
    fn export_person(&self, path: &Path, person: &ProbePerson) -> Result<(), PortError> {
        let timestamp = "2026-01-01T00:00:00+09:00";
        let snapshot = StateSnapshot {
            people: vec![Person {
                id: person.id.clone(),
                name: person.name.clone(),
                cohort: Some(person.cohort.clone()),
                phone: None,
                normalized_phone: None,
                status: PersonStatus::Active,
                person_note: None,
                created_at: timestamp.into(),
                updated_at: timestamp.into(),
            }],
            ..StateSnapshot::default()
        };
        self.write_state(path, &snapshot, env!("CARGO_PKG_VERSION"), timestamp)
    }

    fn import_people(&self, path: &Path) -> Result<Vec<ProbePerson>, PortError> {
        let (_, snapshot) = self.read_state(path)?;
        snapshot
            .people
            .into_iter()
            .map(|person| {
                let cohort = person
                    .cohort
                    .ok_or_else(|| PortError::new("XLSX QT신청자의 또래가 없습니다."))?;
                let probe = ProbePerson {
                    id: person.id,
                    name: person.name,
                    cohort,
                };
                probe
                    .validate()
                    .map_err(|error| PortError::new(error.to_string()))?;
                Ok(probe)
            })
            .collect()
    }
}

fn header_format() -> Format {
    Format::new().set_bold().set_background_color("#D9E2F3")
}

fn set_sheet(
    worksheet: &mut Worksheet,
    name: &str,
    headers: &[&str],
    header: &Format,
) -> Result<(), PortError> {
    worksheet.set_name(name).map_err(xlsx_error)?;
    worksheet.set_freeze_panes(1, 0).map_err(xlsx_error)?;
    for (column, value) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, column as u16, *value, header)
            .map_err(xlsx_error)?;
    }
    Ok(())
}

fn write_info(
    sheet: &mut Worksheet,
    snapshot: &StateSnapshot,
    app_version: &str,
    created_at: &str,
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(sheet, INFO, &["항목", "값"], header)?;
    let counts = snapshot.counts();
    let values = [
        ("format_version", STATE_XLSX_FORMAT_VERSION.to_string()),
        ("app_version", app_version.into()),
        ("created_at", created_at.into()),
        ("timezone", "Asia/Seoul".into()),
        ("ministry", "맑은샘광천교회 교육국 QT".into()),
        ("QT신청자 수", counts.people.to_string()),
        ("구독 수", counts.subscriptions.to_string()),
        ("배부 기록 수", counts.distributions.to_string()),
        ("개별구매 수", counts.purchases.to_string()),
        ("메모 수", snapshot_memos(snapshot).len().to_string()),
        (
            "개인정보 주의",
            "이 파일에는 이름·연락처 등 개인정보가 포함됩니다. 안전하게 전달·보관하고 사용 후 불필요한 사본은 삭제하세요.".into(),
        ),
    ];
    for (row, (key, value)) in values.iter().enumerate() {
        sheet
            .write_string((row + 1) as u32, 0, *key)
            .map_err(xlsx_error)?;
        sheet
            .write_string((row + 1) as u32, 1, value)
            .map_err(xlsx_error)?;
    }
    sheet.set_column_width(0, 22).map_err(xlsx_error)?;
    sheet.set_column_width(1, 80).map_err(xlsx_error)?;
    Ok(())
}

fn write_settings(
    sheet: &mut Worksheet,
    values: &[StateSetting],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        SETTINGS,
        &["key", "value", "created_at", "updated_at"],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(
            sheet,
            row,
            &[
                &value.key,
                &value.value,
                &value.created_at,
                &value.updated_at,
            ],
        )?;
    }
    Ok(())
}

fn write_people(
    sheet: &mut Worksheet,
    values: &[Person],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        PEOPLE,
        &[
            "person_id",
            "이름",
            "또래",
            "연락처",
            "normalized_phone",
            "상태",
            "created_at",
            "updated_at",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(sheet, row, &[&value.id, &value.name])?;
        optional(sheet, row, 2, value.cohort.as_deref())?;
        optional(sheet, row, 3, value.phone.as_deref())?;
        optional(sheet, row, 4, value.normalized_phone.as_deref())?;
        sheet
            .write_string(row, 5, person_status(value.status))
            .map_err(xlsx_error)?;
        strings_at(sheet, row, 6, &[&value.created_at, &value.updated_at])?;
    }
    Ok(())
}

fn write_subscriptions(
    sheet: &mut Worksheet,
    values: &[Subscription],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        SUBSCRIPTIONS,
        &[
            "subscription_id",
            "person_id",
            "start_issue_year",
            "start_issue_month",
            "issue_count",
            "quantity",
            "applied_at",
            "source",
            "source_reference",
            "memo",
            "created_at",
            "updated_at",
            "archived_at",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(sheet, row, &[&value.id, &value.person_id])?;
        numbers(
            sheet,
            row,
            2,
            &[
                value.start_issue.year as f64,
                value.start_issue.start_month as f64,
                value.issue_count as f64,
                value.quantity as f64,
            ],
        )?;
        optional(sheet, row, 6, value.applied_at.as_deref())?;
        sheet
            .write_string(row, 7, subscription_source(value.source))
            .map_err(xlsx_error)?;
        optional(sheet, row, 8, value.source_reference.as_deref())?;
        optional(sheet, row, 9, value.memo.as_deref())?;
        strings_at(sheet, row, 10, &[&value.created_at, &value.updated_at])?;
        optional(sheet, row, 12, value.archived_at.as_deref())?;
    }
    Ok(())
}

fn write_distributions(
    sheet: &mut Worksheet,
    values: &[Distribution],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        DISTRIBUTIONS,
        &[
            "distribution_id",
            "subscription_id",
            "issue_year",
            "issue_month",
            "quantity",
            "distributed_at",
            "note",
            "reversal_of",
            "created_at",
            "updated_at",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(sheet, row, &[&value.id, &value.subscription_id])?;
        numbers(
            sheet,
            row,
            2,
            &[
                value.issue.year as f64,
                value.issue.start_month as f64,
                value.quantity as f64,
            ],
        )?;
        sheet
            .write_string(row, 5, &value.distributed_at)
            .map_err(xlsx_error)?;
        optional(sheet, row, 6, value.note.as_deref())?;
        optional(sheet, row, 7, value.reversal_of.as_deref())?;
        strings_at(sheet, row, 8, &[&value.created_at, &value.updated_at])?;
    }
    Ok(())
}

fn write_purchases(
    sheet: &mut Worksheet,
    values: &[OneTimePurchase],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        PURCHASES,
        &[
            "purchase_id",
            "person_id",
            "buyer_name",
            "issue_year",
            "issue_month",
            "quantity",
            "purchased_at",
            "note",
            "reversal_of",
            "created_at",
            "updated_at",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        sheet.write_string(row, 0, &value.id).map_err(xlsx_error)?;
        optional(sheet, row, 1, value.person_id.as_deref())?;
        optional(sheet, row, 2, value.buyer_name.as_deref())?;
        numbers(
            sheet,
            row,
            3,
            &[
                value.issue.year as f64,
                value.issue.start_month as f64,
                value.quantity as f64,
            ],
        )?;
        sheet
            .write_string(row, 6, &value.purchased_at)
            .map_err(xlsx_error)?;
        optional(sheet, row, 7, value.note.as_deref())?;
        optional(sheet, row, 8, value.reversal_of.as_deref())?;
        strings_at(sheet, row, 9, &[&value.created_at, &value.updated_at])?;
    }
    Ok(())
}

fn snapshot_memos(snapshot: &StateSnapshot) -> Vec<Memo> {
    let mut values = Vec::new();
    for person in &snapshot.people {
        if let Some(content) = person
            .person_note
            .as_deref()
            .map(str::trim)
            .filter(|content| !content.is_empty())
        {
            values.push(Memo {
                id: format!("legacy-person:{}", person.id),
                person_id: Some(person.id.clone()),
                content: content.into(),
                status: MemoStatus::Active,
                operator_name: "이전 데이터".into(),
                created_at: person.created_at.clone(),
                updated_at: person.updated_at.clone(),
                archived_at: None,
                legacy_source: Some("person_note".into()),
                legacy_title: None,
            });
        }
    }
    values.extend(snapshot.check_items.iter().map(|item| Memo {
        id: format!("legacy-check:{}", item.id),
        person_id: item.person_id.clone(),
        content: item.content.clone(),
        status: if item.status == CheckItemStatus::NeedsCheck {
            MemoStatus::Active
        } else {
            MemoStatus::Archived
        },
        operator_name: item.operator_name.clone(),
        created_at: item.created_at.clone(),
        updated_at: item.updated_at.clone(),
        archived_at: if item.status == CheckItemStatus::NeedsCheck {
            None
        } else {
            item.checked_at.clone().or_else(|| Some(item.updated_at.clone()))
        },
        legacy_source: Some("check_item".into()),
        legacy_title: None,
    }));
    values.extend(snapshot.pinned_notes.iter().map(|note| Memo {
        id: format!("legacy-pinned:{}", note.id),
        person_id: None,
        content: if note.content.trim().is_empty() {
            note.title.clone()
        } else {
            format!("{}\n{}", note.title.trim(), note.content.trim())
        },
        status: if note.status == PinnedNoteStatus::Active {
            MemoStatus::Active
        } else {
            MemoStatus::Archived
        },
        operator_name: note.operator_name.clone(),
        created_at: note.created_at.clone(),
        updated_at: note.updated_at.clone(),
        archived_at: note.archived_at.clone(),
        legacy_source: Some(if note.is_pinned {
            "pinned_note:pinned".into()
        } else {
            "pinned_note".into()
        }),
        legacy_title: Some(note.title.clone()),
    }));
    values.sort_by(|left, right| left.id.cmp(&right.id));
    values
}

fn write_memos(
    sheet: &mut Worksheet,
    values: &[Memo],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        MEMOS,
        &[
            "memo_id",
            "person_id",
            "내용",
            "상태",
            "operator_name",
            "created_at",
            "updated_at",
            "archived_at",
            "legacy_source",
            "legacy_title",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(sheet, row, &[&value.id])?;
        optional(sheet, row, 1, value.person_id.as_deref())?;
        strings_at(
            sheet,
            row,
            2,
            &[
                &value.content,
                memo_status(value.status),
                &value.operator_name,
                &value.created_at,
                &value.updated_at,
            ],
        )?;
        optional(sheet, row, 7, value.archived_at.as_deref())?;
        optional(sheet, row, 8, value.legacy_source.as_deref())?;
        optional(sheet, row, 9, value.legacy_title.as_deref())?;
    }
    Ok(())
}

fn memo_status(status: MemoStatus) -> &'static str {
    match status {
        MemoStatus::Active => "active",
        MemoStatus::Archived => "archived",
    }
}

fn write_changes(
    sheet: &mut Worksheet,
    values: &[ChangeLog],
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        CHANGES,
        &[
            "change_id",
            "occurred_at",
            "operator_name",
            "action_type",
            "entity_type",
            "entity_id",
            "summary",
            "before_json",
            "after_json",
        ],
        header,
    )?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        strings(
            sheet,
            row,
            &[
                &value.id,
                &value.occurred_at,
                &value.operator_name,
                &value.action_type,
                &value.entity_type,
                &value.entity_id,
                &value.summary,
            ],
        )?;
        optional(sheet, row, 7, value.before_json.as_deref())?;
        optional(sheet, row, 8, value.after_json.as_deref())?;
    }
    Ok(())
}

fn write_issue_report(
    sheet: &mut Worksheet,
    snapshot: &StateSnapshot,
    header: &Format,
) -> Result<(), PortError> {
    set_sheet(
        sheet,
        ISSUE_REPORT,
        &["QT호", "대상 구독 수", "목표 권수", "배부 기록 권수"],
        header,
    )?;
    let mut report: HashMap<(i32, u8), (u32, u32, i64)> = HashMap::new();
    for subscription in &snapshot.subscriptions {
        for offset in 0..subscription.issue_count {
            let issue = subscription.start_issue.advance(offset);
            let entry = report.entry((issue.year, issue.start_month)).or_default();
            entry.0 += 1;
            entry.1 += subscription.quantity;
        }
    }
    for distribution in &snapshot.distributions {
        let entry = report
            .entry((distribution.issue.year, distribution.issue.start_month))
            .or_default();
        let quantity = i64::from(distribution.quantity);
        entry.2 += if distribution.reversal_of.is_some() {
            -quantity
        } else {
            quantity
        };
    }
    let mut report: Vec<_> = report.into_iter().collect();
    report.sort_by_key(|((year, month), _)| (*year, *month));
    for (index, ((year, month), (subscriptions, target, distributed))) in report.iter().enumerate()
    {
        let row = (index + 1) as u32;
        sheet
            .write_string(row, 0, format!("{year}년 {month}~{}월호", month + 1))
            .map_err(xlsx_error)?;
        numbers(
            sheet,
            row,
            1,
            &[*subscriptions as f64, *target as f64, *distributed as f64],
        )?;
    }
    Ok(())
}
