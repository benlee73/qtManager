use std::fs;

use qt_application::{Phase0Report, RunPhase0Probe};
use qt_infrastructure::{SqliteProbeRepository, StderrEventLogger, XlsxStateWorkbook};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(debug_assertions, feature = "e2e"))]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![run_phase0_probe])
        .run(tauri::generate_context!())
        .expect("QT Manager 실행에 실패했습니다.");
}
