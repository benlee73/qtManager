use std::fs;

use qt_application::{
    AppLogger, ApplicationsPreview, CreateCheckItemRequest, CreateDraftRequest,
    CreatePinnedNoteRequest, DistributionDesk, DuplicateCandidate, ImportApplicationsRequest,
    ImportApplicationsResult, PeopleManagement, PersonDetail, Phase0Report, Phase1Report,
    PreviewApplicationsRequest, RecordDistributionRequest, RecordPurchaseRequest,
    RegisterPersonRequest, RenewSubscriptionRequest, RunPhase0Probe, RunPhase1Probe,
    RuntimeServices, UndoDistributionRequest, UpdateCheckItemStatusRequest, UpdatePersonRequest,
    UpdatePinnedNoteRequest, cancel_latest_purchase, create_check_item, create_draft,
    create_pinned_note, import_applications, load_distribution_desk, load_people_management,
    load_person_detail, preview_applications, preview_duplicates, record_distribution,
    record_purchase, register_person, renew_subscription, save_operator, set_person_archived,
    undo_last_distribution, update_check_item_status, update_person, update_pinned_note,
};
use qt_domain::Issue;
use qt_infrastructure::{
    SqliteCoreRepository, SqliteProbeRepository, StderrEventLogger, SystemRuntime,
    TsvApplicationClipboardParser, XlsxStateWorkbook,
};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowContract {
    width: u32,
    height: u32,
    resizable: bool,
}

#[tauri::command]
fn main_window_contract_command(app: tauri::AppHandle) -> Result<WindowContract, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "메인 창을 찾지 못했습니다.".to_owned())?;
    let physical = window
        .inner_size()
        .map_err(|error| format!("메인 창 크기를 읽지 못했습니다: {error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("메인 창 배율을 읽지 못했습니다: {error}"))?;
    Ok(WindowContract {
        width: (f64::from(physical.width) / scale).round() as u32,
        height: (f64::from(physical.height) / scale).round() as u32,
        resizable: window
            .is_resizable()
            .map_err(|error| format!("메인 창 설정을 읽지 못했습니다: {error}"))?,
    })
}

#[tauri::command]
fn run_phase0_probe(app: tauri::AppHandle) -> Result<Phase0Report, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("앱 임시 데이터 경로를 찾지 못했습니다: {error}"))?
        .join("phase0-probe");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("기술 검증 폴더를 만들지 못했습니다: {error}"))?;

    let mut repository = SqliteProbeRepository::open(&directory.join("probe.sqlite"))
        .map_err(|error| error.to_string())?;
    let workbook = XlsxStateWorkbook;
    let logger = StderrEventLogger;
    let mut use_case = RunPhase0Probe::new(&mut repository, &workbook, &logger);

    use_case
        .execute(&directory.join("probe.xlsx"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn run_phase1_probe(app: tauri::AppHandle) -> Result<Phase1Report, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("앱 임시 데이터 경로를 찾지 못했습니다: {error}"))?
        .join("phase1-probe");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("핵심 검증 폴더를 만들지 못했습니다: {error}"))?;

    let mut repository = SqliteCoreRepository::open(&directory.join("core.sqlite"))
        .map_err(|error| error.to_string())?;
    let logger = StderrEventLogger;
    let mut use_case = RunPhase1Probe::new(&mut repository, &logger);
    use_case.execute().map_err(|error| error.to_string())
}

fn open_operational_repository(app: &tauri::AppHandle) -> Result<SqliteCoreRepository, String> {
    #[cfg(feature = "e2e")]
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("테스트 데이터 경로를 찾지 못했습니다: {error}"))?
        .join("phase2-e2e");
    #[cfg(not(feature = "e2e"))]
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 경로를 찾지 못했습니다: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("앱 데이터 폴더를 만들지 못했습니다: {error}"))?;
    SqliteCoreRepository::open(&directory.join("qt-manager.sqlite"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_distribution_desk_command(
    app: tauri::AppHandle,
    issue_year: i32,
    issue_month: u8,
    query: String,
) -> Result<DistributionDesk, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    load_distribution_desk(
        &mut repository,
        &runtime,
        Issue::new(issue_year, issue_month).map_err(|error| error.to_string())?,
        &query,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_operator_command(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    save_operator(&mut repository, &runtime, &name).map_err(|error| error.to_string())
}

#[tauri::command]
fn record_distribution_command(
    app: tauri::AppHandle,
    request: RecordDistributionRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("distribution_record_started");
    let result = record_distribution(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("distribution_record_completed");
    } else {
        StderrEventLogger.error("distribution_record_failed");
    }
    result
}

#[tauri::command]
fn undo_distribution_command(
    app: tauri::AppHandle,
    request: UndoDistributionRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    undo_last_distribution(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_draft_command(app: tauri::AppHandle, request: CreateDraftRequest) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    create_draft(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_check_item_command(
    app: tauri::AppHandle,
    request: CreateCheckItemRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("check_item_create_started");
    let result = create_check_item(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("check_item_create_completed");
    } else {
        StderrEventLogger.error("check_item_create_failed");
    }
    result
}

#[tauri::command]
fn update_check_item_status_command(
    app: tauri::AppHandle,
    request: UpdateCheckItemStatusRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("check_item_status_update_started");
    let result = update_check_item_status(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("check_item_status_update_completed");
    } else {
        StderrEventLogger.error("check_item_status_update_failed");
    }
    result
}

#[tauri::command]
fn create_pinned_note_command(
    app: tauri::AppHandle,
    request: CreatePinnedNoteRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("pinned_note_create_started");
    let result = create_pinned_note(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("pinned_note_create_completed");
    } else {
        StderrEventLogger.error("pinned_note_create_failed");
    }
    result
}

#[tauri::command]
fn update_pinned_note_command(
    app: tauri::AppHandle,
    request: UpdatePinnedNoteRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("pinned_note_update_started");
    let result = update_pinned_note(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("pinned_note_update_completed");
    } else {
        StderrEventLogger.error("pinned_note_update_failed");
    }
    result
}

#[tauri::command]
fn record_purchase_command(
    app: tauri::AppHandle,
    request: RecordPurchaseRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    record_purchase(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_latest_purchase_command(
    app: tauri::AppHandle,
    issue_year: i32,
    issue_month: u8,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    cancel_latest_purchase(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        Issue::new(issue_year, issue_month).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_people_management_command(
    app: tauri::AppHandle,
    query: String,
    include_archived: bool,
) -> Result<PeopleManagement, String> {
    let mut repository = open_operational_repository(&app)?;
    load_people_management(&mut repository, &query, include_archived)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_person_detail_command(
    app: tauri::AppHandle,
    person_id: String,
) -> Result<PersonDetail, String> {
    let mut repository = open_operational_repository(&app)?;
    load_person_detail(&mut repository, &person_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_duplicates_command(
    app: tauri::AppHandle,
    name: String,
    cohort: Option<String>,
    phone: Option<String>,
    excluding_id: Option<String>,
) -> Result<Vec<DuplicateCandidate>, String> {
    let mut repository = open_operational_repository(&app)?;
    preview_duplicates(
        &mut repository,
        &name,
        cohort.as_deref(),
        phone.as_deref(),
        excluding_id.as_deref(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn register_person_command(
    app: tauri::AppHandle,
    request: RegisterPersonRequest,
) -> Result<String, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("person_register_started");
    let result = register_person(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("person_register_completed");
    } else {
        StderrEventLogger.error("person_register_failed");
    }
    result
}

#[tauri::command]
fn update_person_command(
    app: tauri::AppHandle,
    request: UpdatePersonRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("person_update_started");
    let result = update_person(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("person_update_completed");
    } else {
        StderrEventLogger.error("person_update_failed");
    }
    result
}

#[tauri::command]
fn set_person_archived_command(
    app: tauri::AppHandle,
    person_id: String,
    archived: bool,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("person_archive_state_started");
    let result = set_person_archived(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        &person_id,
        archived,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("person_archive_state_completed");
    } else {
        StderrEventLogger.error("person_archive_state_failed");
    }
    result
}

#[tauri::command]
fn renew_subscription_command(
    app: tauri::AppHandle,
    request: RenewSubscriptionRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("subscription_renew_started");
    let result = renew_subscription(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("subscription_renew_completed");
    } else {
        StderrEventLogger.error("subscription_renew_failed");
    }
    result
}

#[tauri::command]
fn preview_applications_command(
    app: tauri::AppHandle,
    request: PreviewApplicationsRequest,
) -> Result<ApplicationsPreview, String> {
    let mut repository = open_operational_repository(&app)?;
    preview_applications(&TsvApplicationClipboardParser, &mut repository, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_applications_command(
    app: tauri::AppHandle,
    request: ImportApplicationsRequest,
) -> Result<ImportApplicationsResult, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    StderrEventLogger.info("google_form_application_import_started");
    let result = import_applications(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        StderrEventLogger.info("google_form_application_import_completed");
    } else {
        StderrEventLogger.error("google_form_application_import_failed");
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(debug_assertions, feature = "e2e"))]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            run_phase0_probe,
            run_phase1_probe,
            main_window_contract_command,
            load_distribution_desk_command,
            save_operator_command,
            record_distribution_command,
            undo_distribution_command,
            create_draft_command,
            create_check_item_command,
            update_check_item_status_command,
            create_pinned_note_command,
            update_pinned_note_command,
            record_purchase_command,
            cancel_latest_purchase_command,
            load_people_management_command,
            load_person_detail_command,
            preview_duplicates_command,
            register_person_command,
            update_person_command,
            set_person_archived_command,
            renew_subscription_command,
            preview_applications_command,
            import_applications_command
        ])
        .run(tauri::generate_context!())
        .expect("QT Manager 실행에 실패했습니다.");
}
