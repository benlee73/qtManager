import { describe, expect, it } from "vitest";

import { defaultExportName } from "./handover";

describe("인수인계 파일명", () => {
  it("연도와 내보낸 날짜와 시각을 포함한다", () => {
    expect(defaultExportName(new Date(2026, 6, 27, 14, 35))).toBe(
      "2026 청년부 QT배부현황_2026-07-27_14-35.xlsx",
    );
  });
});
