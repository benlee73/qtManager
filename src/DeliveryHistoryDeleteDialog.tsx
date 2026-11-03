import { useEffect, useRef, useState } from "react";
export type DeliveryHistoryRecord = {
  id: string;
  kind: "distribution" | "purchase" | "purchase_delivery";
  purchaseId?: string | null;
  issue: string;
  quantity: number;
  processedAt: string;
};
export function HistoryDeleteButton({
  record,
  busy,
  onSelect,
}: {
  record: DeliveryHistoryRecord;
  busy: boolean;
  onSelect: (record: DeliveryHistoryRecord) => void;
}) {
  return (
    <button
      type="button"
      className="history-delete"
      data-testid="delete-delivery-history"
      data-record-id={record.id}
      aria-label={`${record.issue} 배부 ${record.quantity}권 ${record.processedAt} 삭제`}
      title="배부 이력 삭제"
      disabled={busy}
      onClick={() => onSelect(record)}
    >
      ×
    </button>
  );
}
export function DeliveryHistoryDeleteDialog({
  record,
  busy,
  onClose,
  onDelete,
}: {
  record: DeliveryHistoryRecord;
  busy: boolean;
  onClose: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [locked, onClose]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-history-delete-title"
        className="dialog delivery-history-delete-dialog"
        data-testid="delivery-history-delete-dialog"
      >
        <header className="dialog-heading">
          <h2 id="delivery-history-delete-title">이 배부 이력을 삭제할까요?</h2>
          <button
            type="button"
            aria-label="닫기"
            disabled={locked}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p>
          {record.issue} · 배부 {record.quantity}권
        </p>
        <time dateTime={record.processedAt}>
          {record.processedAt.replace("T", " ").slice(0, 16)}
        </time>
        <p className="delivery-history-delete-note">
          배부 합계에서 {record.quantity}권을 빼고 취소 이력을 남깁니다.
        </p>
        <div className="confirm-actions">
          <button
            type="button"
            autoFocus
            className="secondary-button"
            disabled={locked}
            onClick={onClose}
          >
            돌아가기
          </button>
          <button
            type="button"
            className="danger-button"
            data-testid="confirm-delete-delivery-history"
            disabled={locked}
            onClick={async () => {
              if (submitting.current || locked) return;
              submitting.current = true;
              setSaving(true);
              try {
                if (await onDelete()) onClose();
              } finally {
                submitting.current = false;
                setSaving(false);
              }
            }}
          >
            삭제
          </button>
        </div>
      </section>
    </div>
  );
}
