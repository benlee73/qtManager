import { useCallback, useEffect, useState } from "react";

const DRAFT_PREFIX = "qt-manager:draft:";

function storageKey(key: string) {
  return `${DRAFT_PREFIX}${key}`;
}

export function readDraft(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey(key)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) window.localStorage.setItem(storageKey(key), value);
    else window.localStorage.removeItem(storageKey(key));
  } catch {
    // 저장소를 사용할 수 없는 환경에서도 입력은 계속 동작해야 한다.
  }
}

export function clearDraft(key: string) {
  writeDraft(key, "");
}

export function useTextDraft(key: string, fallback = "") {
  const [value, setValue] = useState(() => readDraft(key) || fallback);

  useEffect(() => {
    writeDraft(key, value);
  }, [key, value]);

  const clear = useCallback(() => {
    clearDraft(key);
    setValue("");
  }, [key]);

  return { value, setValue, clear };
}
