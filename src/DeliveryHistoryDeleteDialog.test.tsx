import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  DeliveryHistoryDeleteDialog,
  HistoryDeleteButton,
} from "./DeliveryHistoryDeleteDialog";
const record = {
  id: "synthetic",
  kind: "purchase" as const,
  issue: "2026년 11~12월호",
  quantity: 24,
  processedAt: "2026-11-01T08:23:00+09:00",
};
it("identifies the exact history being removed and defaults to returning without deletion", () => {
  const html = renderToStaticMarkup(
    <DeliveryHistoryDeleteDialog
      record={record}
      busy={false}
      onClose={vi.fn()}
      onDelete={vi.fn(async () => true)}
    />,
  );
  expect(html).toContain("배부 24권");
  expect(html).toContain("2026-11-01 08:23");
  expect(html).toContain("취소 이력을 남깁니다");
  expect(html).toMatch(/autofocus=""[^>]*>돌아가기/);
  expect(html).toContain('data-testid="confirm-delete-delivery-history"');
});
it("keeps a busy history row button disabled and gives it a specific accessible name", () => {
  const html = renderToStaticMarkup(
    <HistoryDeleteButton record={record} busy onSelect={vi.fn()} />,
  );
  expect(html).toContain('disabled=""');
  expect(html).toContain('data-record-id="synthetic"');
  expect(html).toContain('aria-label="2026년 11~12월호 배부 24권');
});
