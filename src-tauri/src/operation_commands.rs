use crate::{event_logger, open_operational_repository};
use qt_application::AppLogger;
use qt_application::{
    AnnualIntakeRequest, AnnualIntakeResult, CorrectPurchaseRequest, CorrectSubscriptionRequest,
    RuntimeServices,
};
use qt_infrastructure::SystemRuntime;
#[tauri::command]
pub(crate) fn annual_intake_command(
    app: tauri::AppHandle,
    request: AnnualIntakeRequest,
) -> Result<AnnualIntakeResult, String> {
    let mut repo = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("annual_intake_started");
    let result = qt_application::annual_intake(
        &mut repo,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|e| e.to_string());
    if result.is_ok() {
        logger.info("annual_intake_completed");
    } else {
        logger.error("annual_intake_failed");
    }
    result
}
#[tauri::command]
pub(crate) fn preview_subscription_correction_command(
    app: tauri::AppHandle,
    request: CorrectSubscriptionRequest,
) -> Result<Vec<String>, String> {
    let repo = open_operational_repository(&app)?;
    qt_application::preview_subscription_correction(&repo, &request).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn correct_subscription_command(
    app: tauri::AppHandle,
    request: CorrectSubscriptionRequest,
) -> Result<(), String> {
    let mut repo = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("subscription_correction_started");
    let result = qt_application::correct_subscription(
        &mut repo,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|e| e.to_string());
    if result.is_ok() {
        logger.info("subscription_correction_completed");
    } else {
        logger.error("subscription_correction_failed");
    }
    result
}
#[tauri::command]
pub(crate) fn correct_purchase_command(
    app: tauri::AppHandle,
    request: CorrectPurchaseRequest,
) -> Result<(), String> {
    let mut repo = open_operational_repository(&app)?;
    let runtime = SystemRuntime;
    let logger = event_logger(&app);
    logger.info("purchase_correction_started");
    let result = qt_application::correct_purchase(
        &mut repo,
        &RuntimeServices {
            clock: &runtime,
            ids: &runtime,
        },
        request,
    )
    .map_err(|e| e.to_string());
    if result.is_ok() {
        logger.info("purchase_correction_completed");
    } else {
        logger.error("purchase_correction_failed");
    }
    result
}
