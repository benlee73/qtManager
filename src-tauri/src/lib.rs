use std::{fs, path::PathBuf, process::Command};

use qt_application::{
    AppLogger, ApplicationsPreview, ApplyStateImportRequest, Clock, CreateCheckItemRequest,
    CreateDraftRequest, CreatePinnedNoteRequest, DistributionDesk, DuplicateCandidate, IdGenerator,
    ImportApplicationsRequest, ImportApplicationsResult, ImportMode, ImportPreview,
    MergePersonResolution, PeopleManagement, PersonDetail, Phase0Report, Phase1Report,
    PreviewApplicationsRequest, RecordDistributionRequest, RecordPurchaseRequest,
    RegisterPersonRequest, RenewSubscriptionRequest, RestorePointView, RunPhase0Probe,
    RunPhase1Probe, RuntimeServices, StateCounts, UndoDistributionRequest, UndoDistributionResult,
    UpdateCheckItemStatusRequest, UpdatePersonRequest, UpdatePinnedNoteRequest, apply_state_import,
    cancel_latest_purchase, create_check_item, create_draft, create_pinned_note, delete_check_item,
    delete_pinned_note, export_state, import_applications, issue_containing_date,
    load_distribution_desk, load_people_management, load_person_detail, preview_applications,
    preview_duplicates, preview_state_import, record_distribution, record_purchase,
    register_person, renew_subscription, save_operator, set_person_archived,
    undo_last_distribution, undo_state_import, update_check_item_status, update_person,
    update_pinned_note,
};
use qt_domain::Issue;
use qt_infrastructure::{
    RotatingFileEventLogger, SqliteCoreRepository, SqliteProbeRepository, SqliteStateTransfer,
    SystemRuntime, TsvApplicationClipboardParser, XlsxStateWorkbook,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateTransferE2ePaths {
    export_path: String,
    corrupt_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSupportInfo {
    app_version: &'static str,
    data_directory: String,
    log_directory: String,
    log_file: String,
}

fn log_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|error| format!("앱 로그 경로를 찾지 못했습니다: {error}"))
}

fn event_logger(app: &tauri::AppHandle) -> RotatingFileEventLogger {
    let directory =
        log_directory(app).unwrap_or_else(|_| std::env::temp_dir().join("qt-manager").join("logs"));
    RotatingFileEventLogger::new(directory.join("qt-manager.log"))
}

#[tauri::command]
fn app_support_info_command(app: tauri::AppHandle) -> Result<AppSupportInfo, String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 경로를 찾지 못했습니다: {error}"))?;
    let log_directory = log_directory(&app)?;
    let log_file = log_directory.join("qt-manager.log");
    Ok(AppSupportInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        data_directory: data_directory.to_string_lossy().into_owned(),
        log_directory: log_directory.to_string_lossy().into_owned(),
        log_file: log_file.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn open_log_directory_command(app: tauri::AppHandle) -> Result<(), String> {
    let directory = log_directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("로그 폴더를 만들지 못했습니다: {error}"))?;
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&directory).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&directory).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "지원하지 않는 운영체제",
    ));
    status
        .map_err(|error| format!("로그 폴더를 열지 못했습니다: {error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "운영체제가 로그 폴더를 열지 못했습니다.".to_owned())
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
fn state_transfer_e2e_paths_command(
    app: tauri::AppHandle,
) -> Result<StateTransferE2ePaths, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("테스트 경로를 찾지 못했습니다: {error}"))?
        .join("phase4-e2e");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("테스트 폴더를 만들지 못했습니다: {error}"))?;
    let corrupt_path = directory.join("corrupt.xlsx");
    fs::write(&corrupt_path, b"not an xlsx workbook")
        .map_err(|error| format!("손상 XLSX fixture를 만들지 못했습니다: {error}"))?;
    Ok(StateTransferE2ePaths {
        export_path: directory
            .join("handover.xlsx")
            .to_string_lossy()
            .into_owned(),
        corrupt_path: corrupt_path.to_string_lossy().into_owned(),
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
    let logger = event_logger(&app);
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
    let logger = event_logger(&app);
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
    show_all: bool,
) -> Result<DistributionDesk, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    load_distribution_desk(
        &mut repository,
        &runtime,
        Issue::new(issue_year, issue_month).map_err(|error| error.to_string())?,
        &query,
        show_all,
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
    let logger = event_logger(&app);
    logger.info("distribution_record_started");
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
        logger.info("distribution_record_completed");
    } else {
        logger.error("distribution_record_failed");
    }
    result
}

#[tauri::command]
fn undo_distribution_command(
    app: tauri::AppHandle,
    request: UndoDistributionRequest,
) -> Result<UndoDistributionResult, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("distribution_cancel_started");
    let result = undo_last_distribution(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        logger.info("distribution_cancel_completed");
    } else {
        logger.error("distribution_cancel_failed");
    }
    result
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
) -> Result<String, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("check_item_create_started");
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
        logger.info("check_item_create_completed");
    } else {
        logger.error("check_item_create_failed");
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
    let logger = event_logger(&app);
    logger.info("check_item_status_update_started");
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
        logger.info("check_item_status_update_completed");
    } else {
        logger.error("check_item_status_update_failed");
    }
    result
}

#[tauri::command]
fn delete_check_item_command(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("check_item_delete_started");
    let result = delete_check_item(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        &id,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        logger.info("check_item_delete_completed");
    } else {
        logger.error("check_item_delete_failed");
    }
    result
}

#[tauri::command]
fn create_pinned_note_command(
    app: tauri::AppHandle,
    request: CreatePinnedNoteRequest,
) -> Result<String, String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("pinned_note_create_started");
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
        logger.info("pinned_note_create_completed");
    } else {
        logger.error("pinned_note_create_failed");
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
    let logger = event_logger(&app);
    logger.info("pinned_note_update_started");
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
        logger.info("pinned_note_update_completed");
    } else {
        logger.error("pinned_note_update_failed");
    }
    result
}

#[tauri::command]
fn delete_pinned_note_command(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("pinned_note_delete_started");
    let result = delete_pinned_note(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        &id,
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        logger.info("pinned_note_delete_completed");
    } else {
        logger.error("pinned_note_delete_failed");
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
    let runtime = SystemRuntime;
    let reference_issue =
        issue_containing_date(&runtime.today()).map_err(|error| error.to_string())?;
    load_person_detail(&mut repository, &person_id, reference_issue)
        .map_err(|error| error.to_string())
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
    let logger = event_logger(&app);
    logger.info("person_register_started");
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
        logger.info("person_register_completed");
    } else {
        logger.error("person_register_failed");
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
    let logger = event_logger(&app);
    logger.info("person_update_started");
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
        logger.info("person_update_completed");
    } else {
        logger.error("person_update_failed");
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
    let logger = event_logger(&app);
    logger.info("person_archive_state_started");
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
        logger.info("person_archive_state_completed");
    } else {
        logger.error("person_archive_state_failed");
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
    let logger = event_logger(&app);
    logger.info("subscription_renew_started");
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
        logger.info("subscription_renew_completed");
    } else {
        logger.error("subscription_renew_failed");
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
    let logger = event_logger(&app);
    logger.info("google_form_application_import_started");
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
        logger.info("google_form_application_import_completed");
    } else {
        logger.error("google_form_application_import_failed");
    }
    result
}

#[tauri::command]
fn export_state_command(app: tauri::AppHandle, path: String) -> Result<StateCounts, String> {
    let mut repository = open_operational_repository(&app)?;
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    export_state(
        &mut transfer,
        &XlsxStateWorkbook,
        &logger,
        std::path::Path::new(&path),
        env!("CARGO_PKG_VERSION"),
        &runtime.now(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_state_import_command(
    app: tauri::AppHandle,
    path: String,
) -> Result<ImportPreview, String> {
    let logger = event_logger(&app);
    logger.info("state_import_preview_started");
    let mut repository = open_operational_repository(&app)?;
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    let runtime = SystemRuntime;
    let result = preview_state_import(
        &mut transfer,
        &XlsxStateWorkbook,
        std::path::Path::new(&path),
        &runtime.now(),
    )
    .map_err(|error| error.to_string());
    if result.is_ok() {
        logger.info("state_import_preview_completed");
    } else {
        logger.error("state_import_preview_failed");
    }
    result
}

#[tauri::command]
fn apply_state_import_command(
    app: tauri::AppHandle,
    source_path: String,
    source_file_name: String,
    mode: ImportMode,
    person_resolutions: Vec<MergePersonResolution>,
) -> Result<StateCounts, String> {
    let backups = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 경로를 찾지 못했습니다: {error}"))?
        .join("restore-points");
    fs::create_dir_all(&backups)
        .map_err(|error| format!("자동 백업 폴더를 만들지 못했습니다: {error}"))?;
    let runtime = SystemRuntime;
    let restore_id = runtime.next_id();
    let backup_path = backups.join(format!("{restore_id}.xlsx"));
    let request = ApplyStateImportRequest {
        source_path,
        source_file_name,
        backup_path: backup_path.to_string_lossy().into_owned(),
        mode,
        person_resolutions,
    };
    let mut repository = open_operational_repository(&app)?;
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    let logger = event_logger(&app);
    apply_state_import(
        &mut transfer,
        &XlsxStateWorkbook,
        &logger,
        &request,
        restore_id,
        runtime.now(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn latest_restore_point_command(app: tauri::AppHandle) -> Result<Option<RestorePointView>, String> {
    let mut repository = open_operational_repository(&app)?;
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    qt_application::StateTransferRepository::latest_restore_point(&mut transfer)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn undo_state_import_command(app: tauri::AppHandle) -> Result<RestorePointView, String> {
    let mut repository = open_operational_repository(&app)?;
    let mut transfer = SqliteStateTransfer::new(&mut repository);
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    undo_state_import(&mut transfer, &XlsxStateWorkbook, &logger, &runtime.now())
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    let builder = builder.plugin(tauri_plugin_dialog::init());

    #[cfg(any(debug_assertions, feature = "e2e"))]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .setup(|app| {
            let logger = event_logger(app.handle());
            logger.info("app_started");
            logger.info(concat!("app_version_", env!("CARGO_PKG_VERSION")));
            logger.info("database_migration_started");
            match open_operational_repository(app.handle()) {
                Ok(_) => {
                    logger.info("database_schema_version_3");
                    logger.info("database_migration_completed");
                }
                Err(error) => {
                    logger.error("database_migration_failed");
                    return Err(std::io::Error::other(error).into());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_phase0_probe,
            run_phase1_probe,
            main_window_contract_command,
            app_support_info_command,
            open_log_directory_command,
            state_transfer_e2e_paths_command,
            load_distribution_desk_command,
            save_operator_command,
            record_distribution_command,
            undo_distribution_command,
            create_draft_command,
            create_check_item_command,
            update_check_item_status_command,
            delete_check_item_command,
            create_pinned_note_command,
            update_pinned_note_command,
            delete_pinned_note_command,
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
            import_applications_command,
            export_state_command,
            preview_state_import_command,
            apply_state_import_command,
            latest_restore_point_command,
            undo_state_import_command
        ])
        .build(tauri::generate_context!())
        .expect("QT Manager 빌드에 실패했습니다.");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            event_logger(handle).info("app_stopped");
        }
    });
}
