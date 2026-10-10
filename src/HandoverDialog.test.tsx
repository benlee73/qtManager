import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HandoverDialog } from "./HandoverDialog";

describe("HandoverDialog", () => {
  it("gives export and import the same action hierarchy", () => {
    const markup = renderToStaticMarkup(
      <HandoverDialog
        onClose={vi.fn()}
        onChanged={vi.fn(async () => undefined)}
      />,
    );

    expect(
      markup.match(
        /class="(?:secondary-button|primary-button) handover-action"/g,
      ),
    ).toHaveLength(2);
    expect(markup).toContain('data-testid="export-state"');
    expect(markup).toContain("<li>파일에는 이름과 연락처가 포함됩니다.</li>");
    expect(markup).toContain("<li>파일은 암호화되지 않습니다.</li>");
    expect(markup).toContain('data-testid="choose-state-import"');
  });
});
