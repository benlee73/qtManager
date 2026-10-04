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
    #[serde(default)]
    pub is_group: bool,
    pub id: String,
    pub name: String,
    pub cohort: Option<String>,
    pub phone: Option<String>,
    pub normalized_phone: Option<String>,
    pub status: PersonStatus,
    pub person_note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Person {
    pub fn needs_profile_completion(&self) -> bool {
        self.status != PersonStatus::Archived
            && !self.is_group
            && self
                .cohort
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
    }

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
        if self.name.trim().is_empty() {
            return Err(DomainError::DraftNameRequired);
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

/// Returns the canonical display form used by the desktop app. Phone numbers
/// are optional, but when present they must be a Korean 010 number so that
/// operators can compare entries consistently across forms and XLSX files.
pub fn format_phone(value: &str) -> Result<Option<String>, DomainError> {
    let digits = normalize_phone(value);
    if digits.is_empty() {
        return Ok(None);
    }
    if digits.len() != 11 || !digits.starts_with("010") {
        return Err(DomainError::InvalidPhone);
    }
    Ok(Some(format!(
        "{}-{}-{}",
        &digits[..3],
        &digits[3..7],
        &digits[7..]
    )))
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
pub enum MemoStatus {
    Active,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub person_id: Option<String>,
    pub content: String,
    pub status: MemoStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    #[serde(default)]
    pub legacy_source: Option<String>,
    #[serde(default)]
    pub legacy_title: Option<String>,
}

impl Memo {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "memo_id")?;
        if self.content.trim().is_empty() {
            return Err(DomainError::EmptyContent);
        }
        if self.operator_name.trim().is_empty() {
            return Err(DomainError::EmptyRequiredId("operator_name"));
        }
        timestamp(&self.created_at, "created_at")?;
        timestamp(&self.updated_at, "updated_at")
    }

    pub fn is_active(&self) -> bool {
        self.status == MemoStatus::Active
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckItemStatus {
    NeedsCheck,
    Checked,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub id: String,
    pub person_id: Option<String>,
    pub content: String,
    pub status: CheckItemStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub checked_at: Option<String>,
}

impl CheckItem {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "check_item_id")?;
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
pub enum PinnedNoteStatus {
    Active,
    Archived,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub is_pinned: bool,
    pub status: PinnedNoteStatus,
    pub operator_name: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

impl PinnedNote {
    pub fn validate(&self) -> Result<(), DomainError> {
        required_id(&self.id, "pinned_note_id")?;
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

    pub fn is_visible(&self) -> bool {
        self.status == PinnedNoteStatus::Active
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimePurchase {
    #[serde(default)]
    pub payment_status: Option<crate::PaymentStatus>,
    #[serde(default)]
    pub is_group_distribution: bool,
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
    fn profile_completion_depends_only_on_cohort_with_group_and_archive_exceptions() {
        let mut person = Person {
            is_group: false,
            id: "person".into(),
            name: "가상 신청자".into(),
            cohort: None,
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Active,
            person_note: None,
            created_at: "2026-10-04".into(),
            updated_at: "2026-10-04".into(),
        };
        assert!(person.needs_profile_completion());
        person.cohort = Some("00".into());
        person.status = PersonStatus::Draft;
        assert!(!person.needs_profile_completion());
        person.cohort = None;
        person.is_group = true;
        assert!(!person.needs_profile_completion());
        person.is_group = false;
        person.status = PersonStatus::Archived;
        assert!(!person.needs_profile_completion());
    }

    #[test]
    fn formats_optional_010_phone_numbers_for_display() {
        assert_eq!(
            format_phone("01012345678"),
            Ok(Some("010-1234-5678".to_owned()))
        );
        assert_eq!(
            format_phone("010 1234 5678"),
            Ok(Some("010-1234-5678".to_owned()))
        );
        assert_eq!(format_phone(""), Ok(None));
        assert_eq!(
            format_phone("011-1234-5678"),
            Err(DomainError::InvalidPhone)
        );
    }

    #[test]
    fn person_preserves_optional_leading_zero_cohort() {
        let person = Person {
            is_group: false,
            id: "person-1".into(),
            name: "가상 신청자".into(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Active,
            person_note: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
        };

        assert_eq!(person.validate(), Ok(()));
    }

    #[test]
    fn search_matches_name_cohort_combination_and_normalized_phone() {
        let person = Person {
            is_group: false,
            id: "person-1".into(),
            name: "홍 길동".into(),
            cohort: Some("94".into()),
            phone: Some("010-1234-5678".into()),
            normalized_phone: Some("01012345678".into()),
            status: PersonStatus::Active,
            person_note: None,
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
    fn draft_requires_name_and_preserves_optional_leading_zero_cohort() {
        let mut person = Person {
            is_group: false,
            id: "person-1".into(),
            name: "현장 신청자".into(),
            cohort: Some("00".into()),
            phone: None,
            normalized_phone: None,
            status: PersonStatus::Draft,
            person_note: None,
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
        };
        assert_eq!(person.validate_draft(), Ok(()));
        person.cohort = None;
        assert_eq!(person.validate_draft(), Ok(()));
        person.name.clear();
        assert_eq!(person.validate_draft(), Err(DomainError::DraftNameRequired));
    }

    #[test]
    fn pinned_note_has_no_period_and_visibility_only_depends_on_archive_status() {
        let mut note = PinnedNote {
            id: "note-1".into(),
            title: "보관 위치".into(),
            content: "책장 아래".into(),
            is_pinned: true,
            status: PinnedNoteStatus::Active,
            operator_name: "담당자".into(),
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
            archived_at: None,
        };

        assert!(note.is_visible());
        note.status = PinnedNoteStatus::Archived;
        assert!(!note.is_visible());
    }

    #[test]
    fn check_item_supports_needs_check_checked_and_archived_states() {
        let mut item = CheckItem {
            id: "check-1".into(),
            person_id: None,
            content: "수량 확인".into(),
            status: CheckItemStatus::NeedsCheck,
            operator_name: "가상담당자".into(),
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
            checked_at: None,
        };
        assert_eq!(item.validate(), Ok(()));
        item.status = CheckItemStatus::Checked;
        item.checked_at = Some("2026-07-24T11:00:00+09:00".into());
        assert_eq!(item.validate(), Ok(()));
        item.status = CheckItemStatus::Archived;
        assert_eq!(item.validate(), Ok(()));
    }

    #[test]
    fn memo_has_only_active_and_archived_lifecycle() {
        let mut memo = Memo {
            id: "memo-1".into(),
            person_id: Some("person-1".into()),
            content: "다음 배부 때 수량 확인".into(),
            status: MemoStatus::Active,
            operator_name: "가상담당자".into(),
            created_at: "2026-07-24T10:00:00+09:00".into(),
            updated_at: "2026-07-24T10:00:00+09:00".into(),
            archived_at: None,
            legacy_source: None,
            legacy_title: None,
        };
        assert!(memo.is_active());
        assert_eq!(memo.validate(), Ok(()));
        memo.status = MemoStatus::Archived;
        memo.archived_at = Some("2026-07-24T11:00:00+09:00".into());
        assert!(!memo.is_active());
        assert_eq!(memo.validate(), Ok(()));
    }
}
