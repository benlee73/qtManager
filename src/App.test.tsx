import { describe, expect, it } from "vitest";

import type { Phase0Report } from "./phase0";
import type { Phase1Report } from "./phase1";

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

describe("Phase1Report contract", () => {
  it("exposes the persisted subscription and distribution result", () => {
    const report: Phase1Report = {
      schemaVersion: 2,
      subscriptionStatus: "유효",
      distributionStatus: "배부 완료",
      targetQuantity: 2,
      distributedQuantity: 2,
      lastIssue: "2026년 11~12월호",
      changeCount: 2,
    };

    expect(report.distributedQuantity).toBe(report.targetQuantity);
    expect(report.changeCount).toBe(2);
  });
});
