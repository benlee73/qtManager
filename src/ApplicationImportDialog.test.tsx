import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApplicationImportDialog } from "./ApplicationImportDialog";

describe("ApplicationImportDialog", () => {
  it("shows the paste instructions as two readable lines", () => {
    const markup = renderToStaticMarkup(
      <ApplicationImportDialog
        issueYear={2026}
        onClose={vi.fn()}
        onDirectRegister={vi.fn()}
        onImported={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain(
      "스프레드시트나 Excel에서 행을 복사해 붙여넣으세요.",
    );
    expect(markup).toContain(
      "제출 시각이 없는 행은 현재 선택한 2026년 호로 해석하며, 입금 여부는 저장하지 않습니다.",
    );
    expect(markup).toContain('class="dialog-description import-description"');
    expect(markup).toContain('data-testid="application-paste-input"');
  });
});
