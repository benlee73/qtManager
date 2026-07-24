import { describe, expect, it } from "vitest";

import type { Phase0Report } from "./phase0";

describe("Phase0Report contract", () => {
  it("keeps the UI contract explicit", () => {
    const report: Phase0Report = {
      database: "ok",
      xlsx: "ok",
      formatVersion: 1,
      verifiedRows: 1,
    };

    expect(report).toEqual({
      database: "ok",
      xlsx: "ok",
      formatVersion: 1,
      verifiedRows: 1,
    });
  });
});
