import type { KeyboardEvent } from "react";

/** Choose the annual form's explicit default without relying on WebView implicit submission. */
export function handleAnnualFormKeyDown(
  event: KeyboardEvent<HTMLFormElement>,
  sameIssue: boolean,
) {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  if (
    event.repeat ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  ) {
    event.preventDefault();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLInputElement;
  if (
    target.tagName !== "INPUT" ||
    ["checkbox", "radio", "button", "submit"].includes(target.type)
  )
    return;
  event.preventDefault();
  const button = event.currentTarget.querySelector<HTMLButtonElement>(
    sameIssue
      ? '[data-testid="annual-submit-distribute"]'
      : '[data-testid="annual-submit-save"]',
  );
  // A disabled default must not fall through to the other action (e.g. unread memos).
  if (button && !button.disabled) event.currentTarget.requestSubmit(button);
}
