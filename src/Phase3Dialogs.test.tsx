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
  it("offers renewal year and quantity suggestions while keeping direct input", () => {
    const markup = renderToStaticMarkup(
      <RenewDialog
        person={person}
        issue={{ year: 2026, startMonth: 7 }}
        busy={false}
        onClose={vi.fn()}
        onSaved={vi.fn(async () => true)}
      />,
    );

    expect(markup).toContain('list="subscription-year-options"');
    expect(markup).toContain('list="subscription-quantity-options"');
    expect(markup).toContain('<datalist id="subscription-year-options">');
    expect(markup).toContain('<option value="2026"');
    expect(markup).toContain('<option value="10"');
  });
});
