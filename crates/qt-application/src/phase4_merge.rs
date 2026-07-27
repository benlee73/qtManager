pub fn merge_snapshots(
    current: &StateSnapshot,
    incoming: &StateSnapshot,
    resolutions: &[MergePersonResolution],
) -> StateSnapshot {
    let mut incoming = incoming.clone();
    for resolution in resolutions {
        if let MergePersonResolution::LinkToExisting {
            incoming_person_id,
            existing_person_id,
        } = resolution
        {
            if let Some(person) = incoming
                .people
                .iter_mut()
                .find(|person| person.id == *incoming_person_id)
            {
                person.id = existing_person_id.clone();
            }
            for subscription in &mut incoming.subscriptions {
                if subscription.person_id == *incoming_person_id {
                    subscription.person_id = existing_person_id.clone();
                }
            }
            for purchase in &mut incoming.purchases {
                if purchase.person_id.as_deref() == Some(incoming_person_id) {
                    purchase.person_id = Some(existing_person_id.clone());
                }
            }
            for item in &mut incoming.check_items {
                if item.person_id.as_deref() == Some(incoming_person_id) {
                    item.person_id = Some(existing_person_id.clone());
                }
            }
        }
    }

    StateSnapshot {
        settings: merge_by_updated(
            &current.settings,
            &incoming.settings,
            |value| &value.key,
            |value| &value.updated_at,
        ),
        people: merge_by_updated(
            &current.people,
            &incoming.people,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        subscriptions: merge_by_updated(
            &current.subscriptions,
            &incoming.subscriptions,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        distributions: merge_by_updated(
            &current.distributions,
            &incoming.distributions,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        purchases: merge_by_updated(
            &current.purchases,
            &incoming.purchases,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        check_items: merge_by_updated(
            &current.check_items,
            &incoming.check_items,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        pinned_notes: merge_by_updated(
            &current.pinned_notes,
            &incoming.pinned_notes,
            |value| &value.id,
            |value| &value.updated_at,
        ),
        changes: merge_by_id(&current.changes, &incoming.changes, |value| &value.id),
    }
}

fn merge_by_updated<T: Clone, I, U>(current: &[T], incoming: &[T], id: I, updated_at: U) -> Vec<T>
where
    I: Fn(&T) -> &str,
    U: Fn(&T) -> &str,
{
    let mut merged = current.to_vec();
    for candidate in incoming {
        match merged.iter().position(|value| id(value) == id(candidate)) {
            Some(index) if is_newer(updated_at(candidate), updated_at(&merged[index])) => {
                merged[index] = candidate.clone();
            }
            Some(_) => {}
            None => merged.push(candidate.clone()),
        }
    }
    merged
}

fn merge_by_id<T: Clone, I>(current: &[T], incoming: &[T], id: I) -> Vec<T>
where
    I: Fn(&T) -> &str,
{
    let mut merged = current.to_vec();
    for candidate in incoming {
        if !merged.iter().any(|value| id(value) == id(candidate)) {
            merged.push(candidate.clone());
        }
    }
    merged
}

fn clock_skew_warning(now: &str, created_at: &str) -> bool {
    let Ok(now) = OffsetDateTime::parse(now, &time::format_description::well_known::Rfc3339) else {
        return false;
    };
    let Ok(created_at) =
        OffsetDateTime::parse(created_at, &time::format_description::well_known::Rfc3339)
    else {
        return false;
    };
    (created_at - now).whole_hours() > 24
}

#[cfg(test)]
mod tests {
    use super::*;
    use qt_domain::{PersonStatus, normalize_phone};

    fn person(id: &str, updated_at: &str) -> Person {
        Person {
            id: id.into(),
            name: "가상 신청자".into(),
            cohort: Some("00".into()),
            phone: Some("010-0000-0000".into()),
            normalized_phone: Some(normalize_phone("010-0000-0000")),
            status: PersonStatus::Active,
            person_note: None,
            created_at: "2026-01-01T00:00:00+09:00".into(),
            updated_at: updated_at.into(),
        }
    }

    #[test]
    fn compares_absolute_timestamps_instead_of_text_offsets() {
        assert!(is_newer(
            "2026-01-01T01:00:00Z",
            "2026-01-01T09:30:00+09:00"
        ));
    }

    #[test]
    fn different_ids_with_same_identity_require_explicit_resolution() {
        let conflicts = find_person_conflicts(
            &[person("existing", "2026-01-01T00:00:00+09:00")],
            &[person("incoming", "2026-01-02T00:00:00+09:00")],
        );
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].incoming_person_id, "incoming");
    }

    #[test]
    fn merge_keeps_unique_people_and_uses_latest_same_id_record() {
        let current = StateSnapshot {
            people: vec![person("same", "2026-01-01T00:00:00+09:00")],
            ..StateSnapshot::default()
        };
        let mut latest = person("same", "2026-01-03T00:00:00+09:00");
        latest.name = "가상 신청자 수정".into();
        let incoming = StateSnapshot {
            people: vec![latest, person("unique", "2026-01-02T00:00:00+09:00")],
            ..StateSnapshot::default()
        };

        let merged = merge_snapshots(&current, &incoming, &[]);

        assert_eq!(merged.people.len(), 2);
        assert_eq!(merged.people[0].name, "가상 신청자 수정");
    }

    #[test]
    fn explicit_person_link_remaps_related_records_without_losing_history() {
        let current = StateSnapshot {
            people: vec![person("existing", "2026-01-01T00:00:00+09:00")],
            ..StateSnapshot::default()
        };
        let incoming_person = person("incoming", "2026-01-02T00:00:00+09:00");
        let incoming = StateSnapshot {
            people: vec![incoming_person],
            subscriptions: vec![qt_domain::Subscription {
                id: "subscription-incoming".into(),
                person_id: "incoming".into(),
                start_issue: qt_domain::Issue::new(2026, 1).unwrap(),
                issue_count: 6,
                quantity: 1,
                applied_at: None,
                source: qt_domain::SubscriptionSource::Manual,
                source_reference: None,
                memo: None,
                created_at: "2026-01-02T00:00:00+09:00".into(),
                updated_at: "2026-01-02T00:00:00+09:00".into(),
                archived_at: None,
            }],
            ..StateSnapshot::default()
        };

        let merged = merge_snapshots(
            &current,
            &incoming,
            &[MergePersonResolution::LinkToExisting {
                incoming_person_id: "incoming".into(),
                existing_person_id: "existing".into(),
            }],
        );

        assert_eq!(merged.people.len(), 1);
        assert_eq!(merged.people[0].id, "existing");
        assert_eq!(merged.subscriptions[0].person_id, "existing");
    }
}

