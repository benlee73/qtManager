import { describe, expect, it } from "vitest";

import { listIndexAfterKey } from "./keyboardNavigation";

describe("keyboard list navigation", () => {
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
});
