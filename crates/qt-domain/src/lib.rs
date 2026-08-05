mod distribution;
mod issue;
mod records;
mod subscription;

pub use distribution::{
    Distribution, DistributionAssessment, DistributionStatus, PlannedDistribution,
    assess_distribution, plan_distribution,
};
pub use issue::Issue;
pub use records::{ChangeLog, CheckItem, CheckItemStatus, Memo, MemoStatus, Person, PersonStatus};
pub use records::{
    OneTimePurchase, PinnedNote, PinnedNoteStatus, normalize_phone, normalize_search_text,
    person_matches_search,
};
pub use subscription::{
    Subscription, SubscriptionAssessment, SubscriptionSource, SubscriptionStatus,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const STATE_XLSX_FORMAT_VERSION: u16 = 2;
pub const DATABASE_SCHEMA_VERSION: u16 = 4;

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
    #[error("QT 호 시작 월은 1, 3, 5, 7, 9, 11 중 하나여야 합니다: {0}")]
    InvalidIssueMonth(u8),
    #[error("QT 호 연도는 1 이상이어야 합니다: {0}")]
    InvalidIssueYear(i32),
    #[error("필수 식별자는 비어 있을 수 없습니다: {0}")]
    EmptyRequiredId(&'static str),
    #[error("구독 호 수는 1 이상이어야 합니다.")]
    InvalidIssueCount,
    #[error("수량은 1 이상이어야 합니다.")]
    InvalidQuantity,
    #[error("선택한 QT 호는 이 구독의 배부 대상이 아닙니다.")]
    DistributionNotEligible,
    #[error("해당 QT 호의 배부가 이미 완료됐습니다.")]
    DistributionAlreadyComplete,
    #[error("남은 수량 {remaining}권보다 많은 {requested}권을 배부할 수 없습니다.")]
    DistributionExceedsRemaining { requested: u32, remaining: u32 },
    #[error("취소 이력 때문에 계산된 배부 수량이 0보다 작습니다.")]
    InvalidDistributionHistory,
    #[error("필수 시각 값은 비어 있을 수 없습니다: {0}")]
    EmptyTimestamp(&'static str),
    #[error("내용은 비어 있을 수 없습니다.")]
    EmptyContent,
    #[error("제목은 비어 있을 수 없습니다.")]
    EmptyTitle,
    #[error("간이 등록에는 이름이 필요합니다.")]
    DraftNameRequired,
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
