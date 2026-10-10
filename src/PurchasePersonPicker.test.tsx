import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PurchasePersonPicker } from "./PurchasePersonPicker";
import type { PersonSummary } from "./phase3";

const person: PersonSummary = {
  id: "example",
  name: "가상구매자",
  cohort: "00",
  phone: null,
  status: "정식 등록",
  personNote: null,
  subscriptionCount: 1,
  latestLastIssue: null,
};
const props = {
  query: "가상",
  matches: [person],
  selected: null,
  loading: false,
  failed: false,
  newPerson: false,
  onQuery: vi.fn(),
  onSelect: vi.fn(),
  onNew: vi.fn(),
};
describe("구매자 후보 선택 접근성", () => {
  it("includes the new-person choice as the last option in the controlled list", () => {
    const markup = renderToStaticMarkup(<PurchasePersonPicker {...props} />);
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-controls="purchase-options"');
    expect(markup.match(/role="option"/g)).toHaveLength(2);
    expect(
      markup.indexOf('data-testid="purchase-new-person-toggle"'),
    ).toBeGreaterThan(markup.indexOf('data-testid="purchase-person-result"'));
    expect(markup).toMatch(/신규 인원으로 추가<\/span><\/button><\/div>/);
  });
  it("shows an explicit new-person selection and closes the results", () => {
    const markup = renderToStaticMarkup(
      <PurchasePersonPicker {...props} newPerson />,
    );
    expect(markup).not.toContain('role="listbox"');
    expect(markup).toContain("신규 인원:");
    expect(markup).toContain("다시 검색");
  });
  it("does not offer new-person selection during loading, errors or anonymous entry", () => {
    for (const state of [{ loading: true }, { failed: true }, { query: "" }]) {
      const markup = renderToStaticMarkup(
        <PurchasePersonPicker {...props} {...state} />,
      );
      expect(markup).not.toContain('role="option"');
      expect(markup).toContain('aria-expanded="false"');
    }
  });
});
