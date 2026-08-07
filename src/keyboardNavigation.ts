export type ListDirection = "down" | "up";

export function listIndexAfterKey(
  length: number,
  currentIndex: number,
  direction: ListDirection,
): number | null {
  if (length <= 0) return null;
  if (currentIndex < 0) return direction === "down" ? 0 : length - 1;
  if (direction === "down") return Math.min(currentIndex + 1, length - 1);
  return Math.max(currentIndex - 1, 0);
}
