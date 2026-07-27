import { useCallback, useEffect, useRef, useState } from "react";

import type { Notification } from "./Notifications";

export function useNotifications() {
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, kind: Notification["kind"] = "success") => {
      const id = ++nextId.current;
      setNotifications((current) =>
        [{ id, message, kind }, ...current].slice(0, 3),
      );
      if (kind === "success") {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), 4000),
        );
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
    },
    [],
  );

  return { notifications, notify, dismiss };
}
