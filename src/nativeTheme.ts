import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Theme } from "./appearance";

export type NativeThemeSyncEnvironment = {
  isTauri: () => boolean;
  setTheme: (theme: Theme) => Promise<void>;
};

const defaultEnvironment: NativeThemeSyncEnvironment = {
  isTauri: () =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
  setTheme: (theme) => getCurrentWindow().setTheme(theme),
};

/**
 * Keeps the native title bar and system window controls aligned with the
 * selected webview theme. Browser development and unit tests do not have a
 * native shell, so the CSS theme remains their only source of appearance.
 */
export async function syncNativeTheme(
  theme: Theme,
  environment: NativeThemeSyncEnvironment = defaultEnvironment,
): Promise<boolean> {
  if (!environment.isTauri()) return false;

  try {
    await environment.setTheme(theme);
    return true;
  } catch {
    // Native appearance is best effort; the webview theme has already been
    // applied and remains usable if the platform API is unavailable.
    return false;
  }
}
