import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LinkedCheckItemsEditor } from "./LinkedCheckItemsEditor";

const item = {
  id: "check-1",
  summary: "첫 줄\n둘째 줄의 확인 내용",
  status: "확인 필요" as const,
};

describe("LinkedCheckItemsEditor", () => {
  it("keeps multiline content and exposes edit, archive, and delete actions", () => {
    const markup = renderToStaticMarkup(
      <LinkedCheckItemsEditor
        items={[item]}
        busy={false}
        onUpdate={vi.fn(async () => true)}
        onToggle={vi.fn(async () => true)}
        onArchive={vi.fn(async () => true)}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain("첫 줄\n둘째 줄의 확인 내용");
    expect(markup).toContain('aria-label="연결된 확인할 일 수정"');
    expect(markup).toContain('aria-label="연결된 확인할 일 보관"');
    expect(markup).toContain('aria-label="연결된 확인할 일 삭제"');
    expect(markup).not.toContain('data-testid="edit-linked-check-item"');
  });

  it("keeps linked items read-only when no mutation callbacks are provided", () => {
    const markup = renderToStaticMarkup(
      <LinkedCheckItemsEditor items={[item]} busy={false} />,
    );

    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("연결된 확인할 일 수정");
  });
});
