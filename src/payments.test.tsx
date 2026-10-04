import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentQueue } from "./PaymentQueue";
import { filterPayments, type PaymentView } from "./payments";
const rows: PaymentView[] = [
  {
    id: "annual",
    kind: "subscription",
    personId: "person",
    name: "가상 신청자",
    cohort: "00",
    issue: "2026년 11~12월호",
    quantity: 2,
    appliedAt: "2026-10-04T12:00:00+09:00",
    updatedAt: "2026-10-04T12:00:00+09:00",
    status: "pending",
  },
  {
    id: "monthly",
    kind: "purchase",
    personId: "person",
    name: "가상 신청자",
    cohort: "00",
    issue: "2026년 11~12월호",
    quantity: 1,
    appliedAt: "2026-10-04T12:00:00+09:00",
    updatedAt: "2026-10-04T12:00:00+09:00",
    status: "pending",
  },
  {
    id: "confirmed",
    kind: "purchase",
    personId: null,
    name: "익명 구매",
    cohort: null,
    issue: "2026년 11~12월호",
    quantity: 1,
    appliedAt: "2026-10-04T12:00:00+09:00",
    updatedAt: "2026-10-04T12:00:00+09:00",
    status: "confirmed",
  },
];
describe("입금 확인 대기", () => {
  it("keeps separate annual and one-issue intake rows for the same applicant", () => {
    const markup = renderToStaticMarkup(
      <PaymentQueue
        rows={rows}
        query=""
        busy={false}
        onConfirm={vi.fn()}
        onViewPerson={vi.fn()}
      />,
    );
    expect(markup).toContain("1년 구독");
    expect(markup).toContain("1달 구독");
    expect(markup.match(/data-testid="payment-row"/g)).toHaveLength(2);
    expect(markup).not.toContain("익명 구매");
    expect(markup).not.toContain("무료");
  });
  it("searches name and cohort within the chosen payment state", () => {
    expect(filterPayments(rows, "00 가상신청", false)).toHaveLength(2);
    expect(filterPayments(rows, "익명", false)).toHaveLength(0);
    expect(filterPayments(rows, "익명", true)).toHaveLength(1);
  });
});
