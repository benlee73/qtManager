use qt_application::{
    ApplyStateImportRequest, CoreRepository, ImportMode, RestorePointView, StatePinnedNote,
    StateSetting, StateSnapshot, StateTransferRepository, StateWorkbookV1, apply_state_import,
    export_state, preview_state_import, undo_state_import,
};
use qt_domain::{
    ChangeLog, CheckItem, CheckItemStatus, Distribution, Issue, OneTimePurchase, Person,
    PersonStatus, PinnedNoteStatus, Subscription, SubscriptionSource,
};
use qt_infrastructure::{
    SqliteCoreRepository, SqliteStateTransfer, StderrEventLogger, XlsxStateWorkbook,
};
use tempfile::tempdir;

#[test]
fn full_state_round_trip_replace_merge_and_restart_safe_undo() {
    let directory = tempdir().unwrap();
    let source_path = directory.path().join("handover.xlsx");
    let backup_path = directory.path().join("automatic-backup.xlsx");
    let merge_path = directory.path().join("merge.xlsx");
    let merge_backup_path = directory.path().join("merge-backup.xlsx");
    let source_db = directory.path().join("source.sqlite");
    let target_db = directory.path().join("target.sqlite");
    let corrupt_path = directory.path().join("corrupt.xlsx");
    let initial = fixture_state("2026-07-27T10:00:00+09:00");

    let mut source_repository = SqliteCoreRepository::open(&source_db).unwrap();
    source_repository.migrate_core().unwrap();
    {
        let mut source = SqliteStateTransfer::new(&mut source_repository);
        source
            .apply_state(
                &initial,
                ImportMode::Replace,
                &[],
                &restore("seed", "seed.xlsx", "seed-backup.xlsx"),
            )
            .unwrap();
        export_state(
            &mut source,
            &XlsxStateWorkbook,
            &StderrEventLogger,
            &source_path,
            "0.1.0",
            "2026-07-27T10:05:00+09:00",
        )
        .unwrap();
    }

    let mut target_repository = SqliteCoreRepository::open(&target_db).unwrap();
    target_repository.migrate_core().unwrap();
    {
        let mut target = SqliteStateTransfer::new(&mut target_repository);
        let preview = preview_state_import(
            &mut target,
            &XlsxStateWorkbook,
            &source_path,
            "2026-07-27T10:06:00+09:00",
        )
        .unwrap();
        assert_eq!(preview.counts.people, 1);
        // 신청자 1 + 구독 1 + 배부 2 + 구매 2 + 메모 3(옛 개인 메모 포함).
        assert_eq!(preview.add_count, 9);

        apply_state_import(
            &mut target,
            &XlsxStateWorkbook,
            &StderrEventLogger,
            &ApplyStateImportRequest {
                source_path: source_path.to_string_lossy().into_owned(),
                source_file_name: "handover.xlsx".into(),
                backup_path: backup_path.to_string_lossy().into_owned(),
                mode: ImportMode::Replace,
                person_resolutions: vec![],
            },
            "replace-restore".into(),
            "2026-07-27T10:07:00+09:00".into(),
        )
        .unwrap();
        let restored = target.load_state().unwrap();
        assert_eq!(restored.people, initial.people);
        assert_eq!(restored.subscriptions, initial.subscriptions);
        assert_eq!(restored.distributions, initial.distributions);
        assert_eq!(restored.purchases, initial.purchases);
        assert_eq!(
            restored.memos,
            Some(qt_application::snapshot_memos(&initial))
        );
        std::fs::write(&corrupt_path, b"damaged workbook").unwrap();
        let before_failure = target.load_state().unwrap();
        let error = apply_state_import(
            &mut target,
            &XlsxStateWorkbook,
            &StderrEventLogger,
            &ApplyStateImportRequest {
                source_path: corrupt_path.to_string_lossy().into_owned(),
                source_file_name: "corrupt.xlsx".into(),
                backup_path: directory
                    .path()
                    .join("unused-backup.xlsx")
                    .to_string_lossy()
                    .into_owned(),
                mode: ImportMode::Replace,
                person_resolutions: vec![],
            },
            "failed-restore".into(),
            "2026-07-27T10:07:30+09:00".into(),
        )
        .unwrap_err();
        assert!(error.to_string().contains("XLSX"));
        assert_eq!(target.load_state().unwrap(), before_failure);

        let mut incoming = initial.clone();
        incoming.people[0].name = "가상 신청자 최신".into();
        incoming.people[0].updated_at = "2026-07-27T10:08:00+09:00".into();
        let mut unique = incoming.people[0].clone();
        unique.id = "person-unique".into();
        unique.name = "가상 추가 신청자".into();
        unique.phone = Some("010-1111-1111".into());
        unique.normalized_phone = Some("01011111111".into());
        incoming.people.push(unique);
        XlsxStateWorkbook
            .write_state(&merge_path, &incoming, "0.1.0", "2026-07-27T10:09:00+09:00")
            .unwrap();
        apply_state_import(
            &mut target,
            &XlsxStateWorkbook,
            &StderrEventLogger,
            &ApplyStateImportRequest {
                source_path: merge_path.to_string_lossy().into_owned(),
                source_file_name: "merge.xlsx".into(),
                backup_path: merge_backup_path.to_string_lossy().into_owned(),
                mode: ImportMode::Merge,
                person_resolutions: vec![],
            },
            "merge-restore".into(),
            "2026-07-27T10:10:00+09:00".into(),
        )
        .unwrap();
        let merged = target.load_state().unwrap();
        assert_eq!(merged.people.len(), 2);
        assert_eq!(merged.people[0].name, "가상 신청자 최신");
    }

    // 어댑터와 DB 연결을 다시 열어도 복원 지점과 자동 백업이 남아 있어야 한다.
    drop(target_repository);
    let mut reopened = SqliteCoreRepository::open(&target_db).unwrap();
    reopened.migrate_core().unwrap();
    let mut target = SqliteStateTransfer::new(&mut reopened);
    let restore = target.latest_restore_point().unwrap().unwrap();
    assert_eq!(restore.source_file_name, "merge.xlsx");
    undo_state_import(
        &mut target,
        &XlsxStateWorkbook,
        &StderrEventLogger,
        "2026-07-27T10:11:00+09:00",
    )
    .unwrap();
    let restored = target.load_state().unwrap();
    assert_eq!(restored.people.len(), 1);
    assert_eq!(restored.people[0].name, "가상 신청자");
    assert!(target.latest_restore_point().unwrap().is_none());
}

fn fixture_state(now: &str) -> StateSnapshot {
    let person = Person {
        cohort_not_applicable: false,
        is_group: false,
        id: "person-anonymous".into(),
        name: "가상 신청자".into(),
        cohort: Some("00".into()),
        phone: Some("010-0000-0000".into()),
        normalized_phone: Some("01000000000".into()),
        status: PersonStatus::Active,
        person_note: Some("가상 메모".into()),
        created_at: now.into(),
        updated_at: now.into(),
    };
    let subscription = Subscription {
        payment_status: None,
        id: "subscription-anonymous".into(),
        person_id: person.id.clone(),
        start_issue: Issue::new(2026, 1).unwrap(),
        issue_count: 6,
        quantity: 2,
        applied_at: Some(now.into()),
        source: SubscriptionSource::Manual,
        source_reference: None,
        memo: None,
        created_at: now.into(),
        updated_at: now.into(),
        archived_at: None,
    };
    StateSnapshot {
        memos: None,
        settings: vec![StateSetting {
            key: "current_operator_name".into(),
            value: "가상 담당자".into(),
            created_at: now.into(),
            updated_at: now.into(),
        }],
        people: vec![person.clone()],
        subscriptions: vec![subscription.clone()],
        distributions: vec![
            Distribution {
                // ID 정렬로는 취소가 앞서도 복원 시 원본을 먼저 넣어야 한다.
                id: "aaa-distribution-reversal".into(),
                subscription_id: subscription.id.clone(),
                issue: Issue::new(2026, 1).unwrap(),
                quantity: 1,
                distributed_at: now.into(),
                note: None,
                reversal_of: Some("distribution-anonymous".into()),
                created_at: now.into(),
                updated_at: now.into(),
            },
            Distribution {
                id: "distribution-anonymous".into(),
                subscription_id: subscription.id.clone(),
                issue: Issue::new(2026, 1).unwrap(),
                quantity: 2,
                distributed_at: now.into(),
                note: None,
                reversal_of: None,
                created_at: now.into(),
                updated_at: now.into(),
            },
        ],
        purchases: vec![
            OneTimePurchase {
                delivery_records: None,
                correction_of: None,
                payment_status: None,
                is_group_distribution: false,
                id: "aaa-purchase-reversal".into(),
                person_id: Some(person.id.clone()),
                buyer_name: None,
                issue: Issue::new(2026, 3).unwrap(),
                quantity: 1,
                purchased_at: now.into(),
                note: None,
                reversal_of: Some("purchase-anonymous".into()),
                created_at: now.into(),
                updated_at: now.into(),
            },
            OneTimePurchase {
                delivery_records: None,
                correction_of: None,
                payment_status: None,
                is_group_distribution: false,
                id: "purchase-anonymous".into(),
                person_id: Some(person.id.clone()),
                buyer_name: None,
                issue: Issue::new(2026, 3).unwrap(),
                quantity: 1,
                purchased_at: now.into(),
                note: None,
                reversal_of: None,
                created_at: now.into(),
                updated_at: now.into(),
            },
        ],
        check_items: vec![CheckItem {
            id: "check-anonymous".into(),
            person_id: Some(person.id),
            content: "가상 확인 항목".into(),
            status: CheckItemStatus::NeedsCheck,
            operator_name: "가상 담당자".into(),
            created_at: now.into(),
            updated_at: now.into(),
            checked_at: None,
        }],
        pinned_notes: vec![StatePinnedNote {
            id: "note-anonymous".into(),
            title: "가상 위치".into(),
            content: "가상 보관 위치".into(),
            is_pinned: true,
            status: PinnedNoteStatus::Active,
            operator_name: "가상 담당자".into(),
            created_at: now.into(),
            updated_at: now.into(),
            archived_at: None,
            legacy_active_from: None,
            legacy_active_until: None,
        }],
        changes: vec![ChangeLog {
            id: "change-anonymous".into(),
            occurred_at: now.into(),
            operator_name: "가상 담당자".into(),
            action_type: "fixture_created".into(),
            entity_type: "fixture".into(),
            entity_id: "fixture-anonymous".into(),
            summary: "익명 상태 생성".into(),
            before_json: None,
            after_json: None,
        }],
    }
}

fn restore(id: &str, source: &str, path: &str) -> RestorePointView {
    RestorePointView {
        id: id.into(),
        source_file_name: source.into(),
        created_at: "2026-07-27T09:00:00+09:00".into(),
        snapshot_path: path.into(),
    }
}
