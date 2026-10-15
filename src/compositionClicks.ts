/** Commit a Korean IME draft before activating a button, once per pointer gesture. */
export function installCompositionClicks(doc: Document): () => void {
  let composing: EventTarget | null = null;
  let justCommitted: EventTarget | null = null;
  let pending: HTMLButtonElement | null = null;
  let activating = false;
  let pressSeen = false;
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  const start = (event: Event) => {
    clearTimeout(timer);
    pending = null;
    pressSeen = false;
    released = false;
    clearTimeout(commitTimer);
    justCommitted = null;
    composing = event.target;
  };
  const end = (event: Event) => {
    composing = null;
    justCommitted = event.target;
    clearTimeout(commitTimer);
    // Native IME can consume the press and deliver compositionend then mouseup
    // in separate event-loop turns. Keep this window bounded to that gesture.
    commitTimer = setTimeout(() => {
      justCommitted = null;
    }, 500);
  };
  const buttonAt = (event: Event) =>
    (event.target as Element | null)?.closest?.(
      "button",
    ) as HTMLButtonElement | null;
  const down = (event: Event) => {
    // With some macOS IMEs the matching press arrives after release. Do not
    // cancel the already queued activation for that reversed event sequence.
    if (released && pending === buttonAt(event) && timer !== undefined) return;
    if (event.type === "mousedown" && pressSeen && !released) return;
    clearTimeout(timer);
    pressSeen = true;
    released = false;
    pending = null;
    const pointer = event as PointerEvent;
    const button = buttonAt(event);
    if (
      pointer.button !== 0 ||
      !button ||
      button.disabled ||
      (!composing && !justCommitted) ||
      (composing !== doc.activeElement && justCommitted !== doc.activeElement)
    )
      return;
    event.preventDefault();
    pending = button;
    (doc.activeElement as HTMLElement).blur();
  };
  const up = (event: Event) => {
    if (released) return;
    const target = buttonAt(event);
    if (
      !pending &&
      !pressSeen &&
      target &&
      !target.disabled &&
      (event as MouseEvent).button === 0 &&
      (composing === doc.activeElement ||
        justCommitted === doc.activeElement) &&
      (composing || justCommitted)
    ) {
      pending = target;
      (doc.activeElement as HTMLElement).blur();
    }
    const button = pending;
    released = true;
    if (!button || button !== target || (event as PointerEvent).button !== 0) {
      pending = null;
      return;
    }
    // Let compositionend/input and React's state update finish before reading form values.
    timer = setTimeout(() => {
      timer = undefined;
      if (!button.isConnected || button.disabled) return;
      activating = true;
      try {
        button.click();
      } finally {
        activating = false;
      }
    }, 0);
  };
  const cancel = () => {
    pending = null;
    released = true;
    clearTimeout(timer);
  };
  const click = (event: Event) => {
    if (
      !activating &&
      pending !== null &&
      pending === buttonAt(event) &&
      (event as MouseEvent).detail > 0
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  doc.addEventListener("compositionstart", start, true);
  doc.addEventListener("compositionend", end, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("mousedown", down, true);
  doc.addEventListener("pointerup", up, true);
  doc.addEventListener("mouseup", up, true);
  doc.addEventListener("pointercancel", cancel, true);
  doc.addEventListener("click", click, true);
  return () => {
    clearTimeout(timer);
    clearTimeout(commitTimer);
    doc.removeEventListener("compositionstart", start, true);
    doc.removeEventListener("compositionend", end, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("mousedown", down, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("mouseup", up, true);
    doc.removeEventListener("pointercancel", cancel, true);
    doc.removeEventListener("click", click, true);
  };
}
