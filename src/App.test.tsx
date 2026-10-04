import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
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

describe("현장 배부 상단 도구", () => {
  it("offers search and both subscription buttons without an extra menu", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    try {
      const markup = renderToStaticMarkup(<App />);
      const toolbar = markup
        .split('class="table-toolbar"')[1]
        .split('class="table-title"')[0];
      expect(toolbar).toContain('data-testid="people-search"');
      expect(toolbar).toContain('data-testid="open-draft"');
      expect(toolbar).toContain('data-testid="open-purchase"');
      expect(toolbar).not.toContain('aria-label="기타 기능"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
