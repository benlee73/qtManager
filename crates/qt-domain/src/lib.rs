use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const STATE_XLSX_FORMAT_VERSION: u16 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbePerson {
    pub id: String,
    pub name: String,
    pub cohort: String,
}

impl ProbePerson {
    pub fn anonymous_fixture() -> Self {
        Self {
            id: "00000000-0000-4000-8000-000000000001".to_owned(),
            name: "가상신청자".to_owned(),
            cohort: "00".to_owned(),
        }
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        if self.id.trim().is_empty() {
            return Err(DomainError::EmptyId);
        }
        if self.name.trim().is_empty() {
            return Err(DomainError::EmptyName);
        }
        if self.cohort.len() != 2 || !self.cohort.bytes().all(|value| value.is_ascii_digit()) {
            return Err(DomainError::InvalidCohort(self.cohort.clone()));
        }
        Ok(())
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum DomainError {
    #[error("ID는 비어 있을 수 없습니다.")]
    EmptyId,
    #[error("이름은 비어 있을 수 없습니다.")]
    EmptyName,
    #[error("또래는 선행 0을 보존하는 두 자리 문자열이어야 합니다: {0}")]
    InvalidCohort(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anonymous_fixture_preserves_leading_zero_cohort() {
        let person = ProbePerson::anonymous_fixture();

        assert_eq!(person.cohort, "00");
        assert_eq!(person.validate(), Ok(()));
    }

    #[test]
    fn rejects_numeric_like_single_digit_cohort() {
        let person = ProbePerson {
            cohort: "0".to_owned(),
            ..ProbePerson::anonymous_fixture()
        };

        assert_eq!(
            person.validate(),
            Err(DomainError::InvalidCohort("0".to_owned()))
        );
    }
}
