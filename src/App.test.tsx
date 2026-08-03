import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LinkedCheckItems } from "./Phase3Dialogs";
import { persistTheme, readStoredTheme } from "./appearance";
import type { Phase0Report } from "./phase0";
import type { Phase1Report } from "./phase1";
import { moveIssue, recommendedIssue } from "./phase2";

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
      schemaVersion: 3,
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

describe("Phase 2 issue navigation", () => {
  it("moves across year boundaries in two-month issues", () => {
    expect(moveIssue({ year: 2026, startMonth: 11 }, 1)).toEqual({
      year: 2027,
      startMonth: 1,
    });
    expect(moveIssue({ year: 2026, startMonth: 1 }, -1)).toEqual({
      year: 2025,
      startMonth: 11,
    });
  });

  it("recommends the next issue during the even-month handout window", () => {
    expect(recommendedIssue(new Date(2026, 1, 22))).toEqual({
      year: 2026,
      startMonth: 3,
    });
    expect(recommendedIssue(new Date(2026, 11, 22))).toEqual({
      year: 2027,
      startMonth: 1,
    });
  });
});

describe("appearance preference", () => {
  it("defaults to dark and restores a saved light theme", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(readStoredTheme(storage)).toBe("dark");
    persistTheme("light", storage);
    expect(readStoredTheme(storage)).toBe("light");
  });
});

describe("linked check items", () => {
  it("shows the full linked content and its current state in the person dialog", () => {
    const markup = renderToStaticMarkup(
      <LinkedCheckItems
        items={[
          {
            id: "check-1",
            personId: "person-1",
            summary: "익명 권별 구독 기간 확인 전문",
            operatorName: "가상 담당자",
            updatedAt: "2026-08-03T00:00:00+09:00",
            status: "확인 필요",
            personName: "가상 신청자",
          },
        ]}
      />,
    );

    expect(markup).toContain("연결된 확인할 일");
    expect(markup).toContain("익명 권별 구독 기간 확인 전문");
    expect(markup).toContain("확인 필요");
  });
});
