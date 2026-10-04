import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Phase2DialogContent } from "./Phase2Dialogs";
import type { DeskPerson, MemoView } from "./phase2";

const person: DeskPerson = {
  personId: "memo-recipient",
  subscriptionId: "subscription",
  distributionTargets: [],
  name: "가상 신청자",
  cohort: "00",
  phone: null,
  personStatus: "정상",
  subscriptionStatus: "유효",
  distributionStatus: "미배부",
  targetQuantity: 3,
  distributedQuantity: 0,
  remainingQuantity: 3,
  lastIssue: null,
  endDate: null,
  isLastIssue: false,
  hasMemo: true,
  canDistribute: true,
};

function memo(
  id: string,
  personId: string | null,
  status: MemoView["status"] = "활성",
): MemoView {
  return {
    id,
    personId,
    status,
    content: `메모 본문 ${id}\n둘째 줄`,
    personName: person.name,
    operatorName: "가상담당자",
    updatedAt: "2026-10-04T10:00:00+09:00",
  };
}

const memos = [
  memo("first", person.personId),
  memo("second", person.personId),
  memo("archived", person.personId, "보관"),
  memo("other-person", "other-person"),
  memo("unlinked", null),
];

function renderConfirmation(
  type: "confirm-distribution" | "partial",
  items = memos,
) {
  return renderToStaticMarkup(
    <Phase2DialogContent
      dialog={{ type, person }}
      memos={items}
      issue={{ year: 2026, startMonth: 9 }}
      busy={false}
      onClose={vi.fn()}
      mutate={vi.fn().mockResolvedValue(true)}
      recordAction={vi.fn()}
    />,
  );
}

describe("배부 전 메모 확인", () => {
  it.each(["confirm-distribution", "partial"] as const)(
    "shows all active linked memos before submitting %s",
    (type) => {
      const markup = renderConfirmation(type);
      expect(markup).toContain("메모 본문 first\n둘째 줄");
      expect(markup).toContain("메모 본문 second\n둘째 줄");
      expect(markup).not.toContain("메모 본문 archived");
      expect(markup).not.toContain("메모 본문 other-person");
      expect(markup).not.toContain("메모 본문 unlinked");
      expect(markup).toContain("확인 후");
      expect(markup).toContain("가상 신청자");
    },
  );

  it("keeps the ordinary keyboard confirmation when no active linked memo exists", () => {
    const markup = renderConfirmation("confirm-distribution", memos.slice(2));
    expect(markup).toContain("배부하시겠습니까?");
    expect(markup).toContain("배부하기");
    expect(markup).not.toContain('data-testid="distribution-memos"');
  });
});
