import { useRef, useState } from "react";
import { filterPayments, type PaymentView } from "./payments";
import { formatApplicationDate } from "./dateFormat";

export function PaymentQueue({
  rows,
  query,
  busy,
  onConfirm,
  onViewPerson,
}: {
  rows: PaymentView[];
  query: string;
  busy: boolean;
  onConfirm: (rows: PaymentView[], confirmed: boolean) => Promise<boolean>;
  onViewPerson: (id: string) => void;
}) {
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = filterPayments(rows, query, showConfirmed);
  const selection = visible.filter((row) =>
    selected.has(`${row.kind}:${row.id}`),
  );
  const confirming = useRef(false);
  async function confirm(targets: PaymentView[]) {
    if (busy || confirming.current) return;
    confirming.current = true;
    try {
      if (await onConfirm(targets, !showConfirmed)) setSelected(new Set());
    } finally {
      confirming.current = false;
    }
  }
  return (
    <section
      className="payment-queue"
      data-testid="payment-queue"
      data-mode={showConfirmed ? "history" : "pending"}
    >
      <header>
        <div className="payment-queue-title">
          <h3>
            {showConfirmed ? "입금 확인 내역" : "입금 확인 필요"}{" "}
            {visible.length}건
          </h3>
          {showConfirmed && (
            <p>확인이 끝난 신청입니다. 잘못 확인한 건은 취소할 수 있습니다.</p>
          )}
        </div>
        <button
          type="button"
          className={`${showConfirmed ? "secondary-button" : "primary-button"} compact`}
          disabled={busy || !selection.length}
          onClick={() => void confirm(selection)}
        >
          {showConfirmed ? "선택 확인 취소" : "선택 입금 확인"}
        </button>
        {showConfirmed && (
          <button
            type="button"
            className="secondary-button compact payment-return"
            onClick={() => {
              setShowConfirmed(false);
              setSelected(new Set());
            }}
          >
            <span aria-hidden="true">← </span>확인 대기 보기
          </button>
        )}
        {!showConfirmed && (
          <button
            type="button"
            className="text-button payment-history-link"
            onClick={() => {
              setShowConfirmed(true);
              setSelected(new Set());
            }}
          >
            확인한 내역 보기
          </button>
        )}
      </header>
      <div className="payment-table-scroll">
        <table>
          <colgroup>
            <col className="payment-col-selection" />
            <col className="payment-col-person" />
            <col className="payment-col-kind" />
            <col className="payment-col-issue" />
            <col className="payment-col-quantity" />
            <col className="payment-col-date" />
            <col className="payment-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="보이는 입금 건 모두 선택"
                  checked={
                    visible.length > 0 && selection.length === visible.length
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(visible.map((row) => `${row.kind}:${row.id}`))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th>신청자</th>
              <th>신청</th>
              <th>시작·구매 호</th>
              <th>권수</th>
              <th>신청일</th>
              <th>입금</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = `${row.kind}:${row.id}`;
              return (
                <tr key={key} data-testid="payment-row">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${row.name} ${row.issue} 선택`}
                      checked={selected.has(key)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    {row.personId ? (
                      <button
                        type="button"
                        className="text-button payment-person-link"
                        title={
                          row.cohort ? `${row.cohort} ${row.name}` : row.name
                        }
                        onClick={() => onViewPerson(row.personId!)}
                      >
                        {row.cohort ? `${row.cohort} ` : ""}
                        {row.name}
                      </button>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td>
                    {row.kind === "subscription" ? "1년 구독" : "1달 구독"}
                  </td>
                  <td>{row.issue}</td>
                  <td>{row.quantity}권</td>
                  <td title={formatApplicationDate(row.appliedAt)}>
                    {formatApplicationDate(row.appliedAt)}
                  </td>
                  <td>
                    <div className="payment-row-actions">
                      {showConfirmed && (
                        <span className="payment-confirmed-status">확인됨</span>
                      )}
                      <button
                        type="button"
                        className={
                          showConfirmed
                            ? "text-button payment-cancel"
                            : "primary-button compact"
                        }
                        disabled={busy}
                        data-testid="confirm-payment"
                        onClick={() => void confirm([row])}
                      >
                        {showConfirmed ? "확인 취소" : "입금 확인"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <p className="empty-state">
            {showConfirmed
              ? "확인한 입금 내역이 없습니다."
              : "입금 확인이 필요한 신청이 없습니다."}
          </p>
        )}
      </div>
    </section>
  );
}
