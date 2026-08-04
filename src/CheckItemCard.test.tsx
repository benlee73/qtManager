import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CheckItemCard } from "./CheckItemCard";
import { CheckItemDetail } from "./Phase2Dialogs";
import type { CheckItemView } from "./phase2";

const longItem: CheckItemView = {
  id: "check-long",
  personId: "person-1",
  summary:
    "신청 수량과 권별 구독 기간을 확인하고 다음 담당자에게 전달할 내용을 적습니다.",
  operatorName: "가상 담당자",
  updatedAt: "2026-08-04T14:35:00+09:00",
  status: "확인 필요",
  personName: "가상 신청자",
};

describe("CheckItemCard", () => {
  it("renders a multi-line summary with an explicit full-content action", () => {
    const markup = renderToStaticMarkup(
      <CheckItemCard
        item={longItem}
        busy={false}
        onToggle={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(markup).toContain('class="check-item-summary"');
    expect(markup).toContain('data-testid="open-check-item-detail"');
    expect(markup).toContain(longItem.summary);
    expect(markup).toContain("전문 보기");
    expect(markup.indexOf("전문 보기")).toBeLessThan(markup.indexOf("보관"));
    expect(markup.indexOf("보관")).toBeLessThan(markup.indexOf("삭제"));
  });

  it("shows the complete summary in the detail view", () => {
    const markup = renderToStaticMarkup(
      <CheckItemDetail item={longItem} onClose={vi.fn()} />,
    );

    expect(markup).toContain('data-testid="check-item-detail"');
    expect(markup).toContain(longItem.summary);
    expect(markup).toContain("가상 신청자");
  });
});
