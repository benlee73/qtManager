import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoDetailDialog } from "./MemoDetailDialog";

describe("MemoDetailDialog", () => {
  it("opens in read mode and exposes the full body as the edit entry point", () => {
    const markup = renderToStaticMarkup(
      <MemoDetailDialog
        memo={{
          id: "memo-1",
          personId: null,
          content: "첫 줄\n둘째 줄\n전체 내용",
          operatorName: "가상담당자",
          updatedAt: "2026-08-05T10:00:00+09:00",
          status: "활성",
          personName: null,
        }}
        busy={false}
        onClose={vi.fn()}
        onSave={vi.fn(async () => true)}
        onArchive={vi.fn(async () => true)}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain('class="memo-detail-content"');
    expect(markup).toContain("첫 줄");
    expect(markup).toContain("둘째 줄");
    expect(markup).toContain("전체 내용");
    expect(markup).not.toContain('class="memo-detail-editor"');
    expect(markup).toContain(">보관<");
    expect(markup).toContain(">삭제<");
  });
});
