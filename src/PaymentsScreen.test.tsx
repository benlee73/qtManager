import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaymentsScreen } from "./PaymentsScreen";

const handlers = {
  notify: vi.fn(),
  recordAction: vi.fn(),
  onExternalChange: vi.fn(),
  onViewPerson: vi.fn(),
};

describe("PaymentsScreen", () => {
  it("provides its own heading, name/cohort search and confirmation queue", () => {
    const markup = renderToStaticMarkup(
      <PaymentsScreen active dataVersion={0} {...handlers} />,
    );
    expect(markup).toContain("<h2>입금 관리</h2>");
    expect(markup).toContain('data-testid="payment-search"');
    expect(markup).toContain('placeholder="이름, 또래 검색"');
    expect(markup).toContain('data-testid="payment-queue"');
    expect(markup).toContain("확인한 내역 보기");
    expect(markup).toContain('data-mode="pending"');
    expect(markup).toMatch(
      /class="primary-button compact"[^>]*[\s\S]*선택 입금 확인/,
    );
    expect(markup).not.toContain("정보 보완 필요");
    expect(markup).not.toContain("보관된 신청자");
  });
});
