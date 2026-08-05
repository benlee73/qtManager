import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoArchiveDialog } from "./MemoArchiveDialog";

describe("MemoArchiveDialog", () => {
  it("offers both restore and permanent delete actions", () => {
    const markup = renderToStaticMarkup(
      <MemoArchiveDialog
        memos={[
          {
            id: "memo-1",
            personId: null,
            content: "보관된 메모",
            operatorName: "가상담당자",
            updatedAt: "2026-08-05T10:00:00+09:00",
            status: "보관",
            personName: null,
          },
        ]}
        busy={false}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain(">복원<");
    expect(markup).toContain(">삭제<");
    expect(markup).toContain('class="memo-archive-actions"');
  });
});
