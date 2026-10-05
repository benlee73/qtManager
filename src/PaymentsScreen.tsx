import { useCallback, useEffect, useRef, useState } from "react";
import type { ReversibleAction } from "./actionHistory";
import { PaymentQueue } from "./PaymentQueue";
import {
  loadPayments,
  setPaymentConfirmed,
  type PaymentView,
} from "./payments";

export function PaymentsScreen({
  active,
  dataVersion,
  notify,
  recordAction,
  onExternalChange,
  onViewPerson,
}: {
  active: boolean;
  dataVersion: number;
  notify: (message: string, kind?: "success" | "error") => void;
  recordAction: (action: ReversibleAction) => void;
  onExternalChange: () => void;
  onViewPerson: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PaymentView[]>([]);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const result = await loadPayments();
      if (requestId.current === currentRequest) setRows(result);
    } catch (reason) {
      if (requestId.current === currentRequest)
        notifyRef.current(errorMessage(reason), "error");
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [active, dataVersion, refresh]);

  async function confirm(targets: PaymentView[], confirmed: boolean) {
    const selections = targets.map(({ id, kind }) => ({ id, kind }));
    setBusy(true);
    try {
      await setPaymentConfirmed(selections, confirmed);
      onExternalChange();
      recordAction({
        description: confirmed ? "입금 확인" : "입금 확인 취소",
        undo: () => setPaymentConfirmed(selections, !confirmed),
        redo: () => setPaymentConfirmed(selections, confirmed),
      });
      notify(confirmed ? "입금을 확인했습니다." : "입금 확인을 취소했습니다.");
      await refresh();
      return true;
    } catch (reason) {
      notify(errorMessage(reason), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="management-shell payments-screen"
      data-testid="payments-screen"
    >
      <section className="management-heading">
        <h2>입금 관리</h2>
        <label className="search-box payment-search">
          <span aria-hidden="true">⌕</span>
          <input
            data-testid="payment-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름, 또래 검색"
            aria-label="입금 내역 검색"
          />
        </label>
      </section>
      <PaymentQueue
        rows={rows}
        query={query}
        busy={busy}
        onConfirm={confirm}
        onViewPerson={onViewPerson}
      />
    </main>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
