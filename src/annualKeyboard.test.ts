import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { handleAnnualFormKeyDown } from "./annualKeyboard";

function key(overrides = {}) {
  const button = { disabled: false };
  return {
    key: "Enter",
    defaultPrevented: false,
    repeat: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    target: { tagName: "INPUT", type: "number" },
    currentTarget: {
      querySelector: vi.fn(() => button),
      requestSubmit: vi.fn(),
    },
    preventDefault: vi.fn(),
    button,
    ...overrides,
  };
}
function handle(event: ReturnType<typeof key>, sameIssue = true) {
  handleAnnualFormKeyDown(
    event as unknown as KeyboardEvent<HTMLFormElement>,
    sameIssue,
  );
}
describe("annual form Enter", () => {
  it("submits registration plus delivery for this issue, and saves only for another start", () => {
    for (const sameIssue of [true, false]) {
      const event = key();
      handle(event, sameIssue);
      expect(event.currentTarget.querySelector).toHaveBeenCalledWith(
        `[data-testid="annual-submit-${sameIssue ? "distribute" : "save"}"]`,
      );
      expect(event.currentTarget.requestSubmit).toHaveBeenCalledExactlyOnceWith(
        event.button,
      );
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });
  it("does not substitute save-only when delivery is disabled", () => {
    const event = key();
    event.button.disabled = true;
    handle(event);
    expect(event.currentTarget.requestSubmit).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });
  it("does not submit for IME confirmation, repeat, picker handling, or non-text controls", () => {
    for (const overrides of [
      { repeat: true },
      { nativeEvent: { isComposing: true, keyCode: 13 } },
      { nativeEvent: { isComposing: false, keyCode: 229 } },
      { defaultPrevented: true },
      { target: { tagName: "INPUT", type: "checkbox" } },
      { target: { tagName: "TEXTAREA", type: "textarea" } },
      { target: { tagName: "BUTTON", type: "submit" } },
      { ctrlKey: true },
    ]) {
      const event = key(overrides);
      handle(event);
      expect(event.currentTarget.requestSubmit).not.toHaveBeenCalled();
    }
  });
});
