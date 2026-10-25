import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SubscriptionCorrectionDialog } from "./SubscriptionCorrectionDialog";

it("limits correction controls to start year, issue and quantity", () => {
  const html = renderToStaticMarkup(
    <SubscriptionCorrectionDialog
      personId="person"
      target={{
        kind: "annual",
        value: {
          id: "sub",
          startIssue: "2026년 11~12월호",
          lastIssue: "2027년 9~10월호",
          quantity: 2,
          appliedAt: "2026-10-19",
          memo: "보존할 구독 메모",
          source: "직접 등록",
          archived: false,
          periodState: "current",
          revision: "revision",
        },
      }}
      onClose={vi.fn()}
      onSave={vi.fn(async () => true)}
    />,
  );
  expect(html).toContain('name="year"');
  expect(html).toContain('name="month"');
  expect(html).toContain('name="quantity"');
  expect(html).not.toContain('name="date"');
  expect(html).not.toContain('name="note"');
  expect(html).not.toContain("실제 배부 기록은 그대로 보존합니다.");
});
