import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoArchiveDialog } from "./MemoArchiveDialog";

describe("MemoArchiveDialog", () => {
  it("opens an archived memo from a single click", () => {
    const markup = renderToStaticMarkup(
      <MemoArchiveDialog
        memos={[
          {
            id: "memo-1",
            personId: null,
            personName: null,
            content: "보관된 메모",
            operatorName: "가상담당자",
            updatedAt: "2026-08-08T10:00:00+09:00",
            status: "보관",
          },
        ]}
        busy={false}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain('title="클릭하면 메모 상세를 엽니다"');
    expect(markup).not.toContain("두 번 클릭하면");
    expect(markup).toContain(">복원<");
    expect(markup).toContain(">삭제<");
    expect(markup).toContain('class="memo-archive-actions"');
  });
});
