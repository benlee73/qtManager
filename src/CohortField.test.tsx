import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CohortField } from "./CohortField";

it("shows an empty disabled cohort for an explicit exemption even with an old value", () => {
  const html = renderToStaticMarkup(<CohortField value="94" notApplicable />);
  const input = html.match(/<input[^>]*name="cohort"[^>]*>/)?.[0];
  expect(input).toContain('disabled=""');
  expect(input).toContain('value=""');
  expect(html).not.toContain('value="94"');
});
