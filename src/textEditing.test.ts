import { describe, expect, it } from "vitest";

import { insertAtSelection } from "./textEditing";

describe("insertAtSelection", () => {
  it("inserts a tab at the caret and returns the next caret position", () => {
    expect(insertAtSelection("a\tb", 1, 1, "\t")).toEqual({
      value: "a\t\tb",
      caret: 2,
    });
  });

  it("replaces a selected range without affecting surrounding cells", () => {
    expect(insertAtSelection("one two three", 3, 8, "\t")).toEqual({
      value: "one\tthree",
      caret: 4,
    });
  });
});
