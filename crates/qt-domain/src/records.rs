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

    pub fn validate_draft(&self) -> Result<(), DomainError> {
        required_id(&self.id, "person_id")?;
        let has_name = !self.name.trim().is_empty();
        let has_cohort = self
            .cohort
            .as_deref()
            .is_some_and(|cohort| !cohort.trim().is_empty());
        if !has_name && !has_cohort {
            return Err(DomainError::DraftIdentityRequired);
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

pub fn normalize_phone(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}

pub fn normalize_search_text(value: &str) -> String {
    value.split_whitespace().collect::<String>().to_lowercase()
}

pub fn person_matches_search(person: &Person, query: &str) -> bool {
    let normalized = normalize_search_text(query);
    if normalized.is_empty() {
        return true;
    }
    let name = normalize_search_text(&person.name);
    let cohort = person.cohort.as_deref().unwrap_or_default();
    let combined = format!("{cohort}{name}");
    let phone = person
        .normalized_phone
        .clone()
        .unwrap_or_else(|| normalize_phone(person.phone.as_deref().unwrap_or_default()));
    let phone_query = normalize_phone(&normalized);
    name.contains(&normalized)
        || cohort.contains(&normalized)
        || combined.contains(&normalized)
        || (!phone_query.is_empty() && phone.contains(&phone_query))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickNoteStatus {
    Open,
    Completed,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNote {
    pub id: String,
    pub person_id: Option<String>,
    pub content: String,
    pub status: QuickNoteStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

impl QuickNote {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "quick_note_id")?;
        if self.content.trim().is_empty() {
            return Err(DomainError::EmptyContent);
        }
        if self.operator_name.trim().is_empty() {
            return Err(DomainError::EmptyRequiredId("operator_name"));
        }
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationalNoteStatus {
    Active,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub active_from: String,
    pub active_until: Option<String>,
    pub is_pinned: bool,
    pub status: OperationalNoteStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

impl OperationalNote {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "operational_note_id")?;
        if self.title.trim().is_empty() {
            return Err(DomainError::EmptyTitle);
        }
        if self.content.trim().is_empty() {
            return Err(DomainError::EmptyContent);
        }
        if self.operator_name.trim().is_empty() {
            return Err(DomainError::EmptyRequiredId("operator_name"));
        }
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }

    pub fn is_active_on(&self, date: &str) -> bool {
        self.status == OperationalNoteStatus::Active
            && self.active_from.as_str() <= date
            && self
                .active_until
                .as_deref()
                .is_none_or(|until| date <= until)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimePurchase {
    pub id: String,
    pub person_id: Option<String>,
    pub buyer_name: Option<String>,
    pub issue: crate::Issue,
    pub quantity: u32,
    pub purchased_at: String,
    pub note: Option<String>,
    pub reversal_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl OneTimePurchase {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "one_time_purchase_id")?;
        if self.quantity == 0 {
            return Err(DomainError::InvalidQuantity);
        }
        timestamp(&self.purchased_at, "purchased_at")?;
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

    #[test]
    fn search_matches_name_cohort_combination_and_normalized_phone() {
        let person = Person {
            id: "person-1".into(),
            name: "홍 길동".into(),
            cohort: Some("94".into()),
            phone: Some("010-1234-5678".into()),
            normalized_phone: Some("01012345678".into()),
            status: PersonStatus::Active,
            special_note: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
        };

        assert!(person_matches_search(&person, "홍"));
        assert!(person_matches_search(&person, "94 홍"));
        assert!(person_matches_search(&person, "94 홍"));
        assert!(person_matches_search(&person, "12345678"));
        assert!(!person_matches_search(&person, "민지"));
    }

    #[test]
    fn draft_requires_name_or_cohort_and_preserves_leading_zero() {
        let mut person = Person {
            id: "person-1".into(),
            name: String::new(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Draft,
            special_note: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
        };
        assert_eq!(person.validate_draft(), Ok(()));
        person.cohort = None;
        assert_eq!(
            person.validate_draft(),
            Err(DomainError::DraftIdentityRequired)
        );
    }

    #[test]
    fn operational_note_respects_active_period() {
        let note = OperationalNote {
            id: "note-1".into(),
            title: "보관 위치".into(),
            content: "책장 아래".into(),
            active_from: "2026-07-01".into(),
            active_until: Some("2026-09-30".into()),
            is_pinned: true,
            status: OperationalNoteStatus::Active,
            operator_name: "담당자".into(),
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
            archived_at: None,
        };

        assert!(note.is_active_on("2026-07-24"));
        assert!(!note.is_active_on("2026-10-01"));
    }
}
