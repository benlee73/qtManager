export type Theme = "dark" | "light";

const THEME_KEY = "qt-manager-theme";

export function readStoredTheme(
  storage: Pick<Storage, "getItem"> = localStorage,
): Theme {
  return storage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(THEME_KEY, theme);
}
