import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PersonContextMenu } from "./PersonContextMenu";

describe("PersonContextMenu", () => {
  it("renders applicant actions as a pointer-positioned menu", () => {
    const markup = renderToStaticMarkup(
      <PersonContextMenu
        x={120}
        y={240}
        onClose={vi.fn()}
        actions={[
          { label: "상세 정보 보기", onSelect: vi.fn() },
          { label: "메모 추가", onSelect: vi.fn() },
          { label: "신청자 정보 수정", onSelect: vi.fn() },
        ]}
      />,
    );

    expect(markup).toContain('data-testid="person-context-menu"');
    expect(markup).toContain('role="menu"');
    expect(markup).toContain("상세 정보 보기");
    expect(markup).toContain("메모 추가");
    expect(markup).toContain("신청자 정보 수정");
    expect(markup).toContain('style="left:120px;top:240px"');
  });
});
