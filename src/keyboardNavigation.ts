export type ListDirection = "down" | "up";
export type AppScreen = "distribution" | "management" | "payments";

export function screenForShortcut(
  key: string,
  modified: boolean,
): AppScreen | null {
  if (!modified) return null;
  if (key === "1") return "distribution";
  if (key === "2") return "management";
  if (key === "3") return "payments";
  return null;
}

/** True when an upward move should return focus to the field that opened the list. */
export function shouldReturnToSearch(
  length: number,
  currentIndex: number,
  direction: ListDirection,
): boolean {
  return length > 0 && currentIndex === 0 && direction === "up";
}

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

export function rowEnterAction(person: {
  subscriptionStatus: string;
  canDistribute: boolean;
  isGroup?: boolean;
}): "renew" | "confirm-distribution" | "group-distribution" | null {
  if (person.subscriptionStatus === "구독 만료") return "renew";
  if (!person.canDistribute) return null;
  return person.isGroup ? "group-distribution" : "confirm-distribution";
}
