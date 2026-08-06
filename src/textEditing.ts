/** Inserts text at the current selection without changing the surrounding value. */
export function insertAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return {
    value: `${value.slice(0, start)}${insertion}${value.slice(end)}`,
    caret: start + insertion.length,
  };
}
