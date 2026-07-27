fn parse_rows<T>(
    workbook: &mut Xlsx<std::io::BufReader<std::fs::File>>,
    sheet: &str,
    parser: fn(&RowValues<'_>) -> Result<T, PortError>,
) -> Result<Vec<T>, PortError> {
    let range = workbook.worksheet_range(sheet).map_err(calamine_error)?;
    let headers = range
        .rows()
        .next()
        .ok_or_else(|| PortError::new(format!("{sheet} 시트가 비어 있습니다.")))?;
    let positions: HashMap<String, usize> = headers
        .iter()
        .enumerate()
        .filter_map(|(index, cell)| cell.as_string().map(|value| (value, index)))
        .collect();
    range
        .rows()
        .skip(1)
        .filter(|row| row.iter().any(|cell| !cell.is_empty()))
        .map(|row| {
            parser(&RowValues {
                sheet,
                positions: &positions,
                row,
            })
        })
        .collect()
}

struct RowValues<'a> {
    sheet: &'a str,
    positions: &'a HashMap<String, usize>,
    row: &'a [Data],
}

impl RowValues<'_> {
    fn cell(&self, name: &str) -> Result<&Data, PortError> {
        let index = self.positions.get(name).ok_or_else(|| {
            PortError::new(format!("{} 시트의 {name} 열이 없습니다.", self.sheet))
        })?;
        self.row
            .get(*index)
            .ok_or_else(|| PortError::new(format!("{} 시트의 {name} 값이 없습니다.", self.sheet)))
    }
    fn text(&self, name: &str) -> Result<String, PortError> {
        let value = self.cell(name)?;
        match value {
            Data::String(value) if !value.trim().is_empty() => Ok(value.clone()),
            _ => Err(PortError::new(format!(
                "{} 시트의 {name} 값이 문자열이 아닙니다.",
                self.sheet
            ))),
        }
    }
    fn optional(&self, name: &str) -> Result<Option<String>, PortError> {
        match self.cell(name)? {
            Data::Empty => Ok(None),
            Data::String(value) if value.trim().is_empty() => Ok(None),
            Data::String(value) => Ok(Some(value.clone())),
            _ => Err(PortError::new(format!(
                "{} 시트의 {name} 값이 문자열이 아닙니다.",
                self.sheet
            ))),
        }
    }
    fn integer(&self, name: &str) -> Result<i64, PortError> {
        self.cell(name)?.as_i64().ok_or_else(|| {
            PortError::new(format!(
                "{} 시트의 {name} 값이 정수가 아닙니다.",
                self.sheet
            ))
        })
    }
    fn boolean(&self, name: &str) -> Result<bool, PortError> {
        self.cell(name)?.get_bool().ok_or_else(|| {
            PortError::new(format!(
                "{} 시트의 {name} 값이 논리값이 아닙니다.",
                self.sheet
            ))
        })
    }
}

fn parse_setting(row: &RowValues<'_>) -> Result<StateSetting, PortError> {
    Ok(StateSetting {
        key: row.text("key")?,
        value: row.text("value")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
    })
}
fn parse_person(row: &RowValues<'_>) -> Result<Person, PortError> {
    let value = Person {
        id: row.text("person_id")?,
        name: row.text("이름")?,
        cohort: row.optional("또래")?,
        phone: row.optional("연락처")?,
        normalized_phone: row.optional("normalized_phone")?,
        status: parse_person_status(&row.text("상태")?)?,
        person_note: row.optional("신청자메모")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
    };
    if value.status == PersonStatus::Draft {
        value.validate_draft()
    } else {
        value.validate()
    }
    .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}
fn parse_subscription(row: &RowValues<'_>) -> Result<Subscription, PortError> {
    let value = Subscription {
        id: row.text("subscription_id")?,
        person_id: row.text("person_id")?,
        start_issue: Issue::new(
            row.integer("start_issue_year")? as i32,
            row.integer("start_issue_month")? as u8,
        )
        .map_err(|error| PortError::new(error.to_string()))?,
        issue_count: row.integer("issue_count")? as u16,
        quantity: row.integer("quantity")? as u32,
        applied_at: row.optional("applied_at")?,
        source: parse_source(&row.text("source")?)?,
        source_reference: row.optional("source_reference")?,
        memo: row.optional("memo")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
        archived_at: row.optional("archived_at")?,
    };
    value
        .validate()
        .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}
fn parse_distribution(row: &RowValues<'_>) -> Result<Distribution, PortError> {
    let value = Distribution {
        id: row.text("distribution_id")?,
        subscription_id: row.text("subscription_id")?,
        issue: issue(row)?,
        quantity: row.integer("quantity")? as u32,
        distributed_at: row.text("distributed_at")?,
        note: row.optional("note")?,
        reversal_of: row.optional("reversal_of")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
    };
    value
        .validate()
        .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}
fn parse_purchase(row: &RowValues<'_>) -> Result<OneTimePurchase, PortError> {
    let value = OneTimePurchase {
        id: row.text("purchase_id")?,
        person_id: row.optional("person_id")?,
        buyer_name: row.optional("buyer_name")?,
        issue: issue(row)?,
        quantity: row.integer("quantity")? as u32,
        purchased_at: row.text("purchased_at")?,
        note: row.optional("note")?,
        reversal_of: row.optional("reversal_of")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
    };
    value
        .validate()
        .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}
fn parse_check_item(row: &RowValues<'_>) -> Result<CheckItem, PortError> {
    let value = CheckItem {
        id: row.text("check_item_id")?,
        person_id: row.optional("person_id")?,
        content: row.text("content")?,
        status: parse_check_status(&row.text("status")?)?,
        operator_name: row.text("operator_name")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
        checked_at: row.optional("checked_at")?,
    };
    value
        .validate()
        .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}
fn parse_pinned_note(row: &RowValues<'_>) -> Result<StatePinnedNote, PortError> {
    Ok(StatePinnedNote {
        id: row.text("pinned_note_id")?,
        title: row.text("title")?,
        content: row.text("content")?,
        is_pinned: row.boolean("is_pinned")?,
        status: parse_pinned_status(&row.text("status")?)?,
        operator_name: row.text("operator_name")?,
        created_at: row.text("created_at")?,
        updated_at: row.text("updated_at")?,
        archived_at: row.optional("archived_at")?,
        legacy_active_from: row.optional("legacy_active_from")?,
        legacy_active_until: row.optional("legacy_active_until")?,
    })
}
fn parse_change(row: &RowValues<'_>) -> Result<ChangeLog, PortError> {
    let value = ChangeLog {
        id: row.text("change_id")?,
        occurred_at: row.text("occurred_at")?,
        operator_name: row.text("operator_name")?,
        action_type: row.text("action_type")?,
        entity_type: row.text("entity_type")?,
        entity_id: row.text("entity_id")?,
        summary: row.text("summary")?,
        before_json: row.optional("before_json")?,
        after_json: row.optional("after_json")?,
    };
    value
        .validate()
        .map_err(|error| PortError::new(error.to_string()))?;
    Ok(value)
}

fn issue(row: &RowValues<'_>) -> Result<Issue, PortError> {
    Issue::new(
        row.integer("issue_year")? as i32,
        row.integer("issue_month")? as u8,
    )
    .map_err(|error| PortError::new(error.to_string()))
}

fn validate_relations(snapshot: &StateSnapshot) -> Result<(), PortError> {
    for subscription in &snapshot.subscriptions {
        if !snapshot
            .people
            .iter()
            .any(|value| value.id == subscription.person_id)
        {
            return Err(PortError::new(
                "구독이 존재하지 않는 QT 신청자를 참조합니다.",
            ));
        }
    }
    for distribution in &snapshot.distributions {
        if !snapshot
            .subscriptions
            .iter()
            .any(|value| value.id == distribution.subscription_id)
        {
            return Err(PortError::new("배부가 존재하지 않는 구독을 참조합니다."));
        }
        if let Some(reversal_of) = &distribution.reversal_of
            && !snapshot
                .distributions
                .iter()
                .any(|value| value.id == *reversal_of)
        {
            return Err(PortError::new(
                "배부 취소가 존재하지 않는 원본 배부를 참조합니다.",
            ));
        }
    }
    for purchase in &snapshot.purchases {
        if let Some(reversal_of) = &purchase.reversal_of
            && !snapshot
                .purchases
                .iter()
                .any(|value| value.id == *reversal_of)
        {
            return Err(PortError::new(
                "개별 구매 취소가 존재하지 않는 원본 구매를 참조합니다.",
            ));
        }
    }
    Ok(())
}

fn require_sheets(workbook: &Xlsx<std::io::BufReader<std::fs::File>>) -> Result<(), PortError> {
    for name in [
        INFO,
        SETTINGS,
        PEOPLE,
        SUBSCRIPTIONS,
        DISTRIBUTIONS,
        PURCHASES,
        CHECK_ITEMS,
        PINNED_NOTES,
        CHANGES,
        ISSUE_REPORT,
    ] {
        if !workbook.sheet_names().iter().any(|value| value == name) {
            return Err(PortError::new(format!("필수 시트가 없습니다: {name}")));
        }
    }
    Ok(())
}

fn key_values(range: &calamine::Range<Data>) -> HashMap<String, String> {
    range
        .rows()
        .skip(1)
        .filter_map(|row| Some((row.first()?.as_string()?, row.get(1)?.to_string())))
        .collect()
}
fn required_map(values: &HashMap<String, String>, key: &str) -> Result<String, PortError> {
    values
        .get(key)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| PortError::new(format!("XLSX 안내 시트의 {key} 값이 없습니다.")))
}
fn strings(sheet: &mut Worksheet, row: u32, values: &[&str]) -> Result<(), PortError> {
    strings_at(sheet, row, 0, values)
}
fn strings_at(
    sheet: &mut Worksheet,
    row: u32,
    start: u16,
    values: &[&str],
) -> Result<(), PortError> {
    for (offset, value) in values.iter().enumerate() {
        sheet
            .write_string(row, start + offset as u16, *value)
            .map_err(xlsx_error)?;
    }
    Ok(())
}
fn numbers(sheet: &mut Worksheet, row: u32, start: u16, values: &[f64]) -> Result<(), PortError> {
    for (offset, value) in values.iter().enumerate() {
        sheet
            .write_number(row, start + offset as u16, *value)
            .map_err(xlsx_error)?;
    }
    Ok(())
}
fn optional(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<&str>,
) -> Result<(), PortError> {
    if let Some(value) = value {
        sheet.write_string(row, column, value).map_err(xlsx_error)?;
    }
    Ok(())
}
fn person_status(value: PersonStatus) -> &'static str {
    match value {
        PersonStatus::Active => "active",
        PersonStatus::Draft => "draft",
        PersonStatus::Archived => "archived",
    }
}
fn parse_person_status(value: &str) -> Result<PersonStatus, PortError> {
    match value {
        "active" => Ok(PersonStatus::Active),
        "draft" => Ok(PersonStatus::Draft),
        "archived" => Ok(PersonStatus::Archived),
        _ => Err(PortError::new("QT신청자 상태 값이 올바르지 않습니다.")),
    }
}
fn subscription_source(value: SubscriptionSource) -> &'static str {
    match value {
        SubscriptionSource::GoogleForm => "google_form",
        SubscriptionSource::OnSite => "on_site",
        SubscriptionSource::LegacyXlsx => "legacy_xlsx",
        SubscriptionSource::Manual => "manual",
    }
}
fn parse_source(value: &str) -> Result<SubscriptionSource, PortError> {
    match value {
        "google_form" => Ok(SubscriptionSource::GoogleForm),
        "on_site" => Ok(SubscriptionSource::OnSite),
        "legacy_xlsx" => Ok(SubscriptionSource::LegacyXlsx),
        "manual" => Ok(SubscriptionSource::Manual),
        _ => Err(PortError::new("구독 출처 값이 올바르지 않습니다.")),
    }
}
fn check_status(value: CheckItemStatus) -> &'static str {
    match value {
        CheckItemStatus::NeedsCheck => "needs_check",
        CheckItemStatus::Checked => "checked",
        CheckItemStatus::Archived => "archived",
    }
}
fn parse_check_status(value: &str) -> Result<CheckItemStatus, PortError> {
    match value {
        "needs_check" => Ok(CheckItemStatus::NeedsCheck),
        "checked" => Ok(CheckItemStatus::Checked),
        "archived" => Ok(CheckItemStatus::Archived),
        _ => Err(PortError::new("확인할 일 상태 값이 올바르지 않습니다.")),
    }
}
fn pinned_status(value: PinnedNoteStatus) -> &'static str {
    match value {
        PinnedNoteStatus::Active => "active",
        PinnedNoteStatus::Archived => "archived",
    }
}
fn parse_pinned_status(value: &str) -> Result<PinnedNoteStatus, PortError> {
    match value {
        "active" => Ok(PinnedNoteStatus::Active),
        "archived" => Ok(PinnedNoteStatus::Archived),
        _ => Err(PortError::new("고정 메모 상태 값이 올바르지 않습니다.")),
    }
}
fn xlsx_error(error: rust_xlsxwriter::XlsxError) -> PortError {
    PortError::new(format!("XLSX 내보내기에 실패했습니다: {error}"))
}
fn calamine_error(error: calamine::XlsxError) -> PortError {
    PortError::new(format!("XLSX 가져오기에 실패했습니다: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trip_preserves_text_cohort_and_all_required_sheets() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.xlsx");
        let workbook = XlsxStateWorkbook;
        let expected = ProbePerson::anonymous_fixture();
        workbook.export_person(&path, &expected).unwrap();
        let actual = workbook.import_people(&path).unwrap();
        assert_eq!(actual, vec![expected]);
        assert_eq!(actual[0].cohort, "00");

        let file: Xlsx<_> = open_workbook(path).unwrap();
        for sheet in [
            INFO,
            SETTINGS,
            PEOPLE,
            SUBSCRIPTIONS,
            DISTRIBUTIONS,
            PURCHASES,
            CHECK_ITEMS,
            PINNED_NOTES,
            CHANGES,
            ISSUE_REPORT,
        ] {
            assert!(file.sheet_names().iter().any(|value| value == sheet));
        }
        let bytes = std::fs::read(directory.path().join("state.xlsx")).unwrap();
        assert_eq!(&bytes[..2], b"PK", "암호화하지 않은 표준 XLSX ZIP이어야 함");
    }

    #[test]
    fn rejects_a_newer_format_without_guessing() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("future.xlsx");
        let mut workbook = Workbook::new();
        let info = workbook.add_worksheet();
        info.set_name(INFO).unwrap();
        info.write_string(0, 0, "항목").unwrap();
        info.write_string(0, 1, "값").unwrap();
        info.write_string(1, 0, "format_version").unwrap();
        info.write_number(1, 1, 2).unwrap();
        for sheet in [
            SETTINGS,
            PEOPLE,
            SUBSCRIPTIONS,
            DISTRIBUTIONS,
            PURCHASES,
            CHECK_ITEMS,
            PINNED_NOTES,
            CHANGES,
            ISSUE_REPORT,
        ] {
            workbook.add_worksheet().set_name(sheet).unwrap();
        }
        workbook.save(&path).unwrap();

        let error = XlsxStateWorkbook.read_state(&path).unwrap_err();

        assert!(error.to_string().contains("지원하지 않는 XLSX 형식 버전"));
    }
}

