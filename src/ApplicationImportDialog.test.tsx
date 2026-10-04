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
      "제출 시각이 없는 행은 현재 선택한 2026년 호로 해석합니다. 마지막 안내 확인 응답은 무시하고 새 구독은 입금 확인 전으로 등록합니다.",
    );
    expect(markup).toContain('class="dialog-description import-description"');
    expect(markup).toContain('data-testid="application-paste-input"');
  });
});
