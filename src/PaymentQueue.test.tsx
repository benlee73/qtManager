import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaymentQueue } from "./PaymentQueue";

describe("입금 표 공통 열", () => {
  it("keeps the same seven column definitions even with no payments", () => {
    const markup = renderToStaticMarkup(
      <PaymentQueue
        rows={[]}
        query=""
        busy={false}
        onConfirm={vi.fn()}
        onViewPerson={vi.fn()}
      />,
    );
    expect(markup).toContain("<colgroup>");
    expect(markup.match(/<col class=/g)).toHaveLength(7);
    expect(markup).toContain('class="payment-col-selection"');
    expect(markup).toContain('class="payment-col-action"');
  });
});
