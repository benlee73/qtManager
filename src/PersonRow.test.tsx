import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PersonRow } from "./App";
import type { DeskPerson } from "./phase2";

const person: DeskPerson = {
  personId: "person-id",
  subscriptionId: "subscription-id",
  distributionTargets: [],
  name: "가상 신청자",
  cohort: "00",
  phone: null,
  personStatus: "정상",
  subscriptionStatus: "유효",
  distributionStatus: "미배부",
  targetQuantity: 1,
  distributedQuantity: 0,
  remainingQuantity: 1,
  lastIssue: "2026년 11~12월호",
  endDate: "2026-12-31",
  isLastIssue: false,
  hasMemo: true,
  canDistribute: true,
};

describe("PersonRow", () => {
  it("shows linked check work as a quiet status dot instead of a repeated line", () => {
    const markup = renderToStaticMarkup(
      <PersonRow
        person={person}
        selected={false}
        busy={false}
        openMenu={null}
        onOpenMenu={vi.fn()}
        onOpenContextMenu={vi.fn()}
        onSelect={vi.fn()}
        onDistribute={vi.fn()}
        onCancelDistribution={vi.fn()}
        onPartial={vi.fn()}
        onViewDetails={vi.fn()}
        onMemo={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(markup).toContain('class="person-check-indicator"');
    expect(markup).toContain('aria-label="메모 있음"');
    expect(markup).not.toContain("<small>메모 있음</small>");
  });

  it("shows the last QT issue instead of a calendar end date", () => {
    const markup = renderToStaticMarkup(
      <PersonRow
        person={person}
        selected={false}
        busy={false}
        openMenu={null}
        onOpenMenu={vi.fn()}
        onOpenContextMenu={vi.fn()}
        onSelect={vi.fn()}
        onDistribute={vi.fn()}
        onCancelDistribution={vi.fn()}
        onPartial={vi.fn()}
        onViewDetails={vi.fn()}
        onMemo={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(markup).toContain("2026년 11~12월호까지");
    expect(markup).not.toContain("2026-12-31까지");
  });

  it("keeps a management detail action in the applicant row menu", () => {
    const markup = renderToStaticMarkup(
      <PersonRow
        person={person}
        selected={false}
        busy={false}
        openMenu="person-person-id"
        onOpenMenu={vi.fn()}
        onOpenContextMenu={vi.fn()}
        onSelect={vi.fn()}
        onDistribute={vi.fn()}
        onCancelDistribution={vi.fn()}
        onPartial={vi.fn()}
        onViewDetails={vi.fn()}
        onMemo={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(markup).toContain("상세 정보 보기");
  });
});
