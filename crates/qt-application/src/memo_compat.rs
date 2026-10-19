//! Old snapshots are converted at the transfer boundary; current Memo fields remain exact.
use crate::{StatePinnedNote, StateSnapshot};
use qt_domain::{CheckItem, CheckItemStatus, Memo, MemoStatus, PinnedNoteStatus};
pub fn snapshot_memos(snapshot: &StateSnapshot) -> Vec<Memo> {
    if let Some(memos) = &snapshot.memos {
        return memos.clone();
    }
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
        id: item.id.clone(),
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
            item.checked_at
                .clone()
                .or_else(|| Some(item.updated_at.clone()))
        },
        legacy_source: Some("check_item".into()),
        legacy_title: None,
    }));
    values.extend(snapshot.pinned_notes.iter().map(|note| Memo {
        id: note.id.clone(),
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

pub fn populate_snapshot_memos(snapshot: &mut StateSnapshot, memos: Vec<Memo>) {
    snapshot.memos = Some(memos.clone());
    snapshot.check_items.clear();
    snapshot.pinned_notes.clear();
    for person in &mut snapshot.people {
        person.person_note = None;
    }
    for memo in memos {
        match memo.legacy_source.as_deref() {
            Some("person_note") => {
                if let Some(person_id) = memo.person_id.as_deref()
                    && let Some(person) = snapshot
                        .people
                        .iter_mut()
                        .find(|person| person.id == person_id)
                {
                    person.person_note = Some(memo.content);
                }
            }
            Some("pinned_note") | Some("pinned_note:pinned") => {
                let title = memo.legacy_title.unwrap_or_else(|| "메모".to_string());
                let content = memo
                    .content
                    .strip_prefix(&title)
                    .unwrap_or(&memo.content)
                    .trim_start_matches('\n')
                    .to_string();
                snapshot.pinned_notes.push(StatePinnedNote {
                    id: memo.id,
                    title,
                    content,
                    is_pinned: memo.legacy_source.as_deref() == Some("pinned_note:pinned"),
                    status: if memo.status == MemoStatus::Archived {
                        PinnedNoteStatus::Archived
                    } else {
                        PinnedNoteStatus::Active
                    },
                    operator_name: memo.operator_name,
                    created_at: memo.created_at,
                    updated_at: memo.updated_at,
                    archived_at: memo.archived_at,
                    legacy_active_from: None,
                    legacy_active_until: None,
                });
            }
            _ => {
                snapshot.check_items.push(CheckItem {
                    id: memo.id,
                    person_id: memo.person_id,
                    content: memo.content,
                    status: if memo.status == MemoStatus::Archived {
                        CheckItemStatus::Archived
                    } else {
                        CheckItemStatus::NeedsCheck
                    },
                    operator_name: memo.operator_name,
                    created_at: memo.created_at,
                    updated_at: memo.updated_at,
                    checked_at: memo.archived_at,
                });
            }
        }
    }
}
