import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RestorePointCard } from "./HandoverDialog";

describe("RestorePointCard", () => {
  it("explains that restoration removes changes made after import", () => {
    const markup = renderToStaticMarkup(
      <RestorePointCard
        restore={{
          id: "restore-1",
          sourceFileName: "handover.xlsx",
          createdAt: "2026-08-04T14:35:00+09:00",
          snapshotPath: "/synthetic/restore.xlsx",
        }}
        busy={false}
        onRestore={vi.fn()}
      />,
    );

    expect(markup).toContain("가져오기 전 백업으로 복원");
    expect(markup).toContain("가져오기 이후 변경된 내용이 사라질 수 있습니다");
    expect(markup).toContain("복원하기 전 현재 작업을 확인하세요");
  });
});
