import { invoke } from "@tauri-apps/api/core";

export type AppSupportInfo = {
  appVersion: string;
  dataDirectory: string;
  logDirectory: string;
  logFile: string;
};

export function loadAppSupportInfo() {
  return invoke<AppSupportInfo>("app_support_info_command");
}

export function openLogDirectory() {
  return invoke<void>("open_log_directory_command");
}
