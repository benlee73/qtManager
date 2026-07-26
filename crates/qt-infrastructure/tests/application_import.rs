use std::cell::Cell;

use qt_application::{
    Clock, IdGenerator, ImportApplicationRowRequest, ImportApplicationsRequest,
    PeopleManagementRepository, PreviewApplicationsRequest, RuntimeServices, import_applications,
    load_people_management, load_person_detail, preview_applications,
};
use qt_infrastructure::{SqliteCoreRepository, TsvApplicationClipboardParser};
use tempfile::tempdir;

struct FixedRuntime(Cell<u32>);

impl Clock for FixedRuntime {
    fn now(&self) -> String {
        "2026-07-26T20:00:00+09:00".into()
    }

    fn today(&self) -> String {
        "2026-07-26".into()
    }
}

impl IdGenerator for FixedRuntime {
    fn next_id(&self) -> String {
        let next = self.0.get() + 1;
        self.0.set(next);
        format!("application-import-{next}")
    }
}

#[test]
fn previews_imports_links_candidates_and_rejects_a_repeated_response_after_restart() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("applications.sqlite");
    let runtime = FixedRuntime(Cell::new(0));
    let services = RuntimeServices {
        clock: &runtime,
        ids: &runtime,
    };
    let parser = TsvApplicationClipboardParser;
    let first_text =
        "2026. 2. 1 오후 7:48:08\t가상응답자\t00\t010-0000-1234\t1-2월호\t2\t네 입금했습니다.";

    let person_id = {
        let mut repository = SqliteCoreRepository::open(&path).unwrap();
        PeopleManagementRepository::migrate(&mut repository).unwrap();
        qt_application::DistributionDeskRepository::save_operator(
            &mut repository,
            "가상담당자",
            &runtime.now(),
        )
        .unwrap();
        let preview = preview_applications(
            &parser,
            &mut repository,
            PreviewApplicationsRequest {
                text: first_text.into(),
                default_issue_year: 2027,
                mapping: None,
            },
        )
        .unwrap();
        assert_eq!(preview.ready_count, 1);
        assert!(preview.ignored_payment_column);
        assert_eq!(preview.rows[0].issue_year, Some(2026));
        let repeated_in_paste = preview_applications(
            &parser,
            &mut repository,
            PreviewApplicationsRequest {
                text: format!("{first_text}\n{first_text}"),
                default_issue_year: 2027,
                mapping: None,
            },
        )
        .unwrap();
        assert_eq!(repeated_in_paste.ready_count, 1);
        assert_eq!(repeated_in_paste.rows[1].status, "already_imported");
        let row = request_from_preview(&preview.rows[0], None, true);
        let imported = import_applications(
            &mut repository,
            &services,
            ImportApplicationsRequest { rows: vec![row] },
        )
        .unwrap();
        assert_eq!((imported.imported_count, imported.new_people_count), (1, 1));
        load_people_management(&mut repository, "1234", false)
            .unwrap()
            .people[0]
            .id
            .clone()
    };

    let second_text = "2027. 7. 1 오전 9:00:00\t가상응답자\t00\t01000001234\t7-8월호\t1";
    {
        let mut repository = SqliteCoreRepository::open(&path).unwrap();
        let preview = preview_applications(
            &parser,
            &mut repository,
            PreviewApplicationsRequest {
                text: second_text.into(),
                default_issue_year: 2026,
                mapping: None,
            },
        )
        .unwrap();
        assert_eq!(preview.rows[0].status, "candidate");
        assert_eq!(preview.rows[0].candidates[0].person_id, person_id);
        let row = request_from_preview(&preview.rows[0], Some(person_id.clone()), false);
        import_applications(
            &mut repository,
            &services,
            ImportApplicationsRequest { rows: vec![row] },
        )
        .unwrap();
    }

    let mut reopened = SqliteCoreRepository::open(&path).unwrap();
    let repeated = preview_applications(
        &parser,
        &mut reopened,
        PreviewApplicationsRequest {
            text: first_text.into(),
            default_issue_year: 2026,
            mapping: None,
        },
    )
    .unwrap();
    assert_eq!(repeated.rows[0].status, "already_imported");
    let detail = load_person_detail(&mut reopened, &person_id).unwrap();
    assert_eq!(detail.subscriptions.len(), 2);
    assert_eq!(detail.subscriptions[0].quantity, 1);
    assert_eq!(detail.subscriptions[1].quantity, 2);
}

fn request_from_preview(
    row: &qt_application::ApplicationPreviewRow,
    existing_person_id: Option<String>,
    create_as_new: bool,
) -> ImportApplicationRowRequest {
    ImportApplicationRowRequest {
        row_number: row.row_number,
        submitted_at: row.submitted_at.clone(),
        name: row.name.clone().unwrap(),
        cohort: row.cohort.clone().unwrap(),
        phone: row.phone.clone().unwrap(),
        issue_year: row.issue_year.unwrap(),
        issue_month: row.issue_month.unwrap(),
        quantity: row.quantity.unwrap(),
        fingerprint: row.fingerprint.clone().unwrap(),
        existing_person_id,
        create_as_new,
    }
}
