import { describe, expect, it } from "vitest";

import { formatApplicationDate } from "./dateFormat";

describe("application date formatting", () => {
  it("shows ISO timestamps in a readable Korean local format", () => {
    expect(formatApplicationDate("2026-08-07T01:56:21.985413Z")).toBe(
      "2026. 8. 7. 오전 10:56",
    );
  });

  it("leaves invalid values visible instead of throwing", () => {
    expect(formatApplicationDate("not-a-date")).toBe("not-a-date");
  });
});
