import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RenewDialog } from "./Phase3Dialogs";
import type { PersonDetail } from "./phase3";

const person: PersonDetail = {
  id: "person-id",
  name: "가상 신청자",
  cohort: "00",
  phone: null,
  status: "정식 등록",
  personNote: null,
  subscriptions: [],
  distributions: [],
  checkItems: [],
  memos: [],
};

describe("RenewDialog", () => {
  it("keeps renewal year and quantity as direct inputs without suggestion lists", () => {
    const markup = renderToStaticMarkup(
      <RenewDialog
        person={person}
        issue={{ year: 2026, startMonth: 7 }}
        busy={false}
        onClose={vi.fn()}
        onSaved={vi.fn(async () => true)}
      />,
    );

    expect(markup).not.toContain('list="subscription-year-options"');
    expect(markup).not.toContain('list="subscription-quantity-options"');
    expect(markup).not.toContain("<datalist");
    expect(markup).toContain("가상 신청자 · 구독 추가");
    expect(markup).not.toContain("추가·갱신");
    expect(markup).toContain("신청 + 배부");
    expect(markup).toContain("신청만 저장");
    expect(markup).toContain('name="issueYear"');
    expect(markup).toContain('name="quantity"');
  });
});
