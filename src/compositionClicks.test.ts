import { afterEach, describe, expect, it, vi } from "vitest";
import { installCompositionClicks } from "./compositionClicks";

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const doc = new EventTarget() as Document;
  let value = "조합 중";
  const action = vi.fn(() => value);
  const button = {
    disabled: false,
    isConnected: true,
    closest: () => button,
    click: action,
  };
  const input = {
    blur: vi.fn(() => {
      value = "확정된 한글";
      doc.dispatchEvent(new Event("compositionend"));
    }),
  };
  Object.defineProperty(doc, "activeElement", { value: input });
  const send = (
    type: string,
    target: unknown,
    extras: Record<string, unknown> = {},
  ) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    for (const [key, value] of Object.entries(extras))
      Object.defineProperty(event, key, { value });
    doc.dispatchEvent(event);
    return event;
  };
  const cleanup = installCompositionClicks(doc);
  return { action, input, button, send, cleanup };
}
describe("한글 조합 중 버튼 클릭", () => {
  it("handles an IME-consumed press followed by only a mouse release, once", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    send("compositionend", input);
    vi.advanceTimersByTime(16);
    send("mouseup", button, { button: 0 });
    send("pointerup", button, { button: 0 });
    send("click", button, { detail: 1 });
    vi.runAllTimers();
    expect(action).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it("handles a release arriving before its press as reported by macOS WebKit", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    send("mouseup", button, { button: 0 });
    send("pointerdown", button, { button: 0 });
    send("mousedown", button, { button: 0 });
    vi.runAllTimers();
    expect(action).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it("does not turn a drag from another target or an expired composition into an action", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    send("pointerdown", { closest: () => null }, { button: 0 });
    send("mouseup", button, { button: 0 });
    vi.runAllTimers();
    expect(action).not.toHaveBeenCalled();
    send("compositionstart", input);
    send("compositionend", input);
    vi.advanceTimersByTime(501);
    send("mouseup", button, { button: 0 });
    vi.runAllTimers();
    expect(action).not.toHaveBeenCalled();
    cleanup();
  });
  it("commits the composition and activates once even when the native click follows", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    expect(send("pointerdown", button, { button: 0 }).defaultPrevented).toBe(
      true,
    );
    expect(send("click", button, { detail: 1 }).defaultPrevented).toBe(true);
    expect(action).not.toHaveBeenCalled();
    send("pointerup", button, { button: 0 });
    vi.runAllTimers();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.results[0].value).toBe("확정된 한글");
    cleanup();
  });
  it("handles WebKit finishing composition just before pointerdown", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    send("compositionend", input);
    send("pointerdown", button, { button: 0 });
    send("pointerup", button, { button: 0 });
    vi.runAllTimers();
    expect(action).toHaveBeenCalledTimes(1);
    cleanup();
  });
  it("does not activate when a composing pointer gesture is released elsewhere", () => {
    const { action, input, button, send, cleanup } = fixture();
    send("compositionstart", input);
    send("pointerdown", button, { button: 0 });
    send("pointerup", { closest: () => null }, { button: 0 });
    vi.runAllTimers();
    expect(action).not.toHaveBeenCalled();
    cleanup();
  });
  it("keeps ordinary clicks and disabled buttons native and cancels pending activation on unmount", () => {
    const { action, input, button, send, cleanup } = fixture();
    expect(send("pointerdown", button, { button: 0 }).defaultPrevented).toBe(
      false,
    );
    send("compositionstart", input);
    button.disabled = true;
    expect(send("pointerdown", button, { button: 0 }).defaultPrevented).toBe(
      false,
    );
    button.disabled = false;
    send("pointerdown", button, { button: 0 });
    send("pointerup", button, { button: 0 });
    cleanup();
    vi.runAllTimers();
    expect(action).not.toHaveBeenCalled();
  });
});
