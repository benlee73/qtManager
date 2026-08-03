import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PersonFilterMenu } from "./PersonFilterMenu";

describe("PersonFilterMenu", () => {
  it("renders all status checkboxes and quick presets", () => {
    const markup = renderToStaticMarkup(
      <PersonFilterMenu
        filters={new Set(["undistributed", "partial"])}
        open
        onChange={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(markup).toContain("남은 배부");
    expect(markup).toContain("전체");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(4);
    expect(markup).toContain("미배부");
    expect(markup).toContain("일부 배부");
    expect(markup).toContain("배부 완료");
    expect(markup).toContain("구독 만료");
  });
});
