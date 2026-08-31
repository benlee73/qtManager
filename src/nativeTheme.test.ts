import { describe, expect, it, vi } from "vitest";

import {
  syncNativeTheme,
  type NativeThemeSyncEnvironment,
} from "./nativeTheme";

function environment(
  overrides: Partial<NativeThemeSyncEnvironment> = {},
): NativeThemeSyncEnvironment {
  return {
    isTauri: () => true,
    setTheme: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("native theme synchronization", () => {
  it("applies the selected theme to the native shell", async () => {
    const native = environment();

    await expect(syncNativeTheme("light", native)).resolves.toBe(true);
    expect(native.setTheme).toHaveBeenCalledWith("light");
  });

  it("skips the native API outside the Tauri runtime", async () => {
    const setTheme = vi.fn().mockResolvedValue(undefined);
    const native = environment({ isTauri: () => false, setTheme });

    await expect(syncNativeTheme("dark", native)).resolves.toBe(false);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("keeps the webview theme usable when the native API is unavailable", async () => {
    const native = environment({
      setTheme: vi
        .fn()
        .mockRejectedValue(new Error("native shell unavailable")),
    });

    await expect(syncNativeTheme("dark", native)).resolves.toBe(false);
  });
});
