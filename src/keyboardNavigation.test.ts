import { describe, expect, it } from "vitest";

import {
  listIndexAfterKey,
  screenForShortcut,
  shouldReturnToSearch,
} from "./keyboardNavigation";

describe("keyboard list navigation", () => {
  it("maps modified number shortcuts to all three primary screens", () => {
    expect(screenForShortcut("1", true)).toBe("distribution");
    expect(screenForShortcut("2", true)).toBe("management");
    expect(screenForShortcut("1", false)).toBeNull();
    expect(screenForShortcut("3", true)).toBe("payments");
    expect(screenForShortcut("3", false)).toBeNull();
    expect(screenForShortcut("4", true)).toBeNull();
  });

  it("enters at the first item and moves down without passing the end", () => {
    expect(listIndexAfterKey(3, -1, "down")).toBe(0);
    expect(listIndexAfterKey(3, 1, "down")).toBe(2);
    expect(listIndexAfterKey(3, 2, "down")).toBe(2);
  });

  it("moves up without passing the beginning and enters at the end", () => {
    expect(listIndexAfterKey(3, -1, "up")).toBe(2);
    expect(listIndexAfterKey(3, 1, "up")).toBe(0);
    expect(listIndexAfterKey(3, 0, "up")).toBe(0);
  });

  it("returns no index for an empty list", () => {
    expect(listIndexAfterKey(0, -1, "down")).toBeNull();
  });

  it("returns focus to the search field above the first row", () => {
    expect(shouldReturnToSearch(3, 0, "up")).toBe(true);
    expect(shouldReturnToSearch(3, 1, "up")).toBe(false);
    expect(shouldReturnToSearch(3, 0, "down")).toBe(false);
  });
});
