use std::fs;

use qt_application::{
    AppLogger, CreateDraftRequest, CreateOperationalNoteRequest, CreateQuickNoteRequest,
    DistributionDesk, Phase0Report, Phase1Report, RecordDistributionRequest, RecordPurchaseRequest,
    RunPhase0Probe, RunPhase1Probe, RuntimeServices, UndoDistributionRequest,
    cancel_latest_purchase, complete_quick_note, create_draft, create_operational_note,
    create_quick_note, load_distribution_desk, record_distribution, record_purchase, save_operator,
    undo_last_distribution,
};
use qt_domain::Issue;
use qt_infrastructure::{
    SqliteCoreRepository, SqliteProbeRepository, StderrEventLogger, SystemRuntime,
    XlsxStateWorkbook,
};
use tauri::Manager;

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
fn create_quick_note_command(
    app: tauri::AppHandle,
    request: CreateQuickNoteRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    create_quick_note(
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
fn complete_quick_note_command(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    complete_quick_note(
        &mut repository,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        &id,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_operational_note_command(
    app: tauri::AppHandle,
    request: CreateOperationalNoteRequest,
) -> Result<(), String> {
    let mut repository = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    create_operational_note(
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
            load_distribution_desk_command,
            save_operator_command,
            record_distribution_command,
            undo_distribution_command,
            create_draft_command,
            create_quick_note_command,
            complete_quick_note_command,
            create_operational_note_command,
            record_purchase_command,
            cancel_latest_purchase_command
        ])
        .run(tauri::generate_context!())
        .expect("QT Manager 실행에 실패했습니다.");
}
