import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoCard } from "./MemoCard";

describe("MemoCard", () => {
  it("keeps multiline content visible and shows only a linked person's name", () => {
    const markup = renderToStaticMarkup(
      <MemoCard
        memo={{
          id: "memo-1",
          personId: "person-1",
          content: "첫 줄\n둘째 줄\n긴 운영 참고",
          operatorName: "가상담당자",
          updatedAt: "2026-08-05T10:00:00+09:00",
          status: "활성",
          personName: "가상 신청자",
        }}
        onOpenDetail={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="memo-card"');
    expect(markup).toContain("첫 줄");
    expect(markup).toContain("둘째 줄");
    expect(markup).toContain("가상 신청자");
    expect(markup).not.toContain("일반");
    expect(markup).toContain('title="클릭하면 메모 상세를 엽니다"');
  });
});
