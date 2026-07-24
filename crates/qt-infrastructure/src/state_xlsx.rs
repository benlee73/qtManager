use std::path::Path;

use calamine::{Data, DataType, Reader, Xlsx, open_workbook};
use qt_application::{PortError, StateWorkbook};
use qt_domain::{ProbePerson, STATE_XLSX_FORMAT_VERSION};
use rust_xlsxwriter::{Format, Workbook};

const INFO_SHEET: &str = "안내";
const PEOPLE_SHEET: &str = "QT신청자";

pub struct XlsxStateWorkbook;

impl StateWorkbook for XlsxStateWorkbook {
    fn export_person(&self, path: &Path, person: &ProbePerson) -> Result<(), PortError> {
        let mut workbook = Workbook::new();
        let header = Format::new().set_bold();

        let info = workbook.add_worksheet();
        info.set_name(INFO_SHEET).map_err(port_error)?;
        info.write_string_with_format(0, 0, "항목", &header)
            .map_err(port_error)?;
        info.write_string_with_format(0, 1, "값", &header)
            .map_err(port_error)?;
        info.write_string(1, 0, "format_version")
            .map_err(port_error)?;
        info.write_number(1, 1, f64::from(STATE_XLSX_FORMAT_VERSION))
            .map_err(port_error)?;
        info.write_string(2, 0, "개인정보 주의")
            .map_err(port_error)?;
        info.write_string(
            2,
            1,
            "이 파일에는 개인정보가 포함될 수 있습니다. 안전하게 전달·보관하고 불필요한 사본은 삭제하세요.",
        )
        .map_err(port_error)?;

        let people = workbook.add_worksheet();
        people.set_name(PEOPLE_SHEET).map_err(port_error)?;
        for (column, value) in ["person_id", "이름", "또래"].iter().enumerate() {
            people
                .write_string_with_format(0, column as u16, *value, &header)
                .map_err(port_error)?;
        }
        people.write_string(1, 0, &person.id).map_err(port_error)?;
        people
            .write_string(1, 1, &person.name)
            .map_err(port_error)?;
        // 문자열 쓰기를 유지해야 `00` 같은 또래의 선행 0이 보존된다.
        people
            .write_string(1, 2, &person.cohort)
            .map_err(port_error)?;

        workbook.save(path).map_err(port_error)
    }

    fn import_people(&self, path: &Path) -> Result<Vec<ProbePerson>, PortError> {
        let mut workbook: Xlsx<_> = open_workbook(path).map_err(calamine_error)?;
        let info = workbook
            .worksheet_range(INFO_SHEET)
            .map_err(calamine_error)?;
        let version = info
            .get((1, 1))
            .and_then(DataType::as_i64)
            .ok_or_else(|| PortError::new("XLSX 안내 시트의 format_version이 없습니다."))?;
        if version != i64::from(STATE_XLSX_FORMAT_VERSION) {
            return Err(PortError::new(format!(
                "지원하지 않는 XLSX 형식 버전입니다: {version}"
            )));
        }

        let people = workbook
            .worksheet_range(PEOPLE_SHEET)
            .map_err(calamine_error)?;
        people
            .rows()
            .skip(1)
            .filter(|row| row.iter().any(|cell| !cell.is_empty()))
            .map(|row| {
                let person = ProbePerson {
                    id: string_cell(row.first(), "person_id")?,
                    name: string_cell(row.get(1), "이름")?,
                    cohort: string_cell(row.get(2), "또래")?,
                };
                person
                    .validate()
                    .map_err(|error| PortError::new(error.to_string()))?;
                Ok(person)
            })
            .collect()
    }
}

fn string_cell(cell: Option<&Data>, field: &str) -> Result<String, PortError> {
    match cell {
        Some(Data::String(value)) if !value.trim().is_empty() => Ok(value.clone()),
        _ => Err(PortError::new(format!(
            "XLSX QT신청자 시트의 {field} 값이 없거나 문자열이 아닙니다."
        ))),
    }
}

fn port_error(error: rust_xlsxwriter::XlsxError) -> PortError {
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
    fn round_trip_preserves_text_cohort_and_format_version() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.xlsx");
        let workbook = XlsxStateWorkbook;
        let expected = ProbePerson::anonymous_fixture();

        workbook.export_person(&path, &expected).unwrap();
        let actual = workbook.import_people(&path).unwrap();

        assert_eq!(actual, vec![expected]);
        assert_eq!(actual[0].cohort, "00");
    }
}
