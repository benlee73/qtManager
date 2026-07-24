use serde::{Deserialize, Serialize};

use crate::DomainError;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonStatus {
    Active,
    Draft,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub normalized_phone: Option<String>,
    pub status: PersonStatus,
    pub special_note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Person {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "person_id")?;
        if self.name.trim().is_empty() {
            return Err(DomainError::EmptyName);
        }
        if let Some(cohort) = &self.cohort
            && (cohort.len() != 2 || !cohort.bytes().all(|value| value.is_ascii_digit()))
        {
            return Err(DomainError::InvalidCohort(cohort.clone()));
        }
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLog {
    pub id: String,
    pub occurred_at: String,
    pub operator_name: String,
    pub action_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub summary: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
}

impl ChangeLog {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "change_log_id")?;
        required_id(&self.entity_id, "change_log_entity_id")?;
        timestamp(&self.occurred_at, "occurred_at")?;
        if self.operator_name.trim().is_empty() {
            return Err(DomainError::EmptyRequiredId("operator_name"));
        }
        Ok(())
    }
}

pub(crate) fn required_id(value: &str, field: &'static str) -> Result<(), DomainError> {
    if value.trim().is_empty() {
        Err(DomainError::EmptyRequiredId(field))
    } else {
        Ok(())
    }
}

pub(crate) fn timestamp(value: &str, field: &'static str) -> Result<(), DomainError> {
    if value.trim().is_empty() {
        Err(DomainError::EmptyTimestamp(field))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn person_preserves_optional_leading_zero_cohort() {
        let person = Person {
            id: "person-1".into(),
            name: "가상 신청자".into(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Active,
            special_note: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
        };

        assert_eq!(person.validate(), Ok(()));
    }
}
