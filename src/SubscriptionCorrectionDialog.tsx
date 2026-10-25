import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  buildCorrectionRequest,
  type CorrectionTarget,
} from "./subscriptionCorrection";
export type { CorrectionTarget } from "./subscriptionCorrection";
export function EditPencil({
  onClick,
  label,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="edit-pencil"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="m16 3 5 5L8 21H3v-5L16 3ZM14 5l5 5" />
      </svg>
    </button>
  );
}
export function SubscriptionCorrectionDialog({
  personId,
  target,
  onClose,
  onSave,
}: {
  personId: string;
  target: CorrectionTarget;
  onClose: () => void;
  onSave: (work: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  const value = target.value;
  const label =
    target.kind === "annual" ? target.value.startIssue : target.value.issue;
  const match = label.match(/(\d+)년\s*(\d+)~/);
  const year = Number(match?.[1] ?? new Date().getFullYear());
  const month = Number(match?.[2] ?? 1);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="dialog correction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-heading">
          <h2 id="correction-title">
            {target.kind === "annual" ? "1년" : "1달"} 구독 정정
          </h2>
          <button
            type="button"
            aria-label="닫기"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form
          noValidate
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229)
            )
              event.preventDefault();
          }}
          data-testid="subscription-correction-form"
          onChange={() => {
            setConflicts([]);
            setConfirm(false);
            setError("");
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget);
            const issueYear = Number(data.get("year"));
            const issueMonth = Number(data.get("month"));
            const quantity = Number(data.get("quantity"));
            try {
              if (!Number.isInteger(quantity) || quantity < 1)
                throw new Error("수량은 1권 이상 입력하세요.");
              const correction = buildCorrectionRequest(
                personId,
                target,
                { issueYear, issueMonth, quantity },
                confirm,
              );
              let work: () => Promise<unknown>;
              if (correction.kind === "annual") {
                const request = correction.request;
                const warnings = await invoke<string[]>(
                  "preview_subscription_correction_command",
                  { request },
                );
                if (warnings.length && !confirm) {
                  setConflicts(warnings);
                  return;
                }
                work = () =>
                  invoke("correct_subscription_command", { request });
              } else {
                const request = correction.request;
                work = () => invoke("correct_purchase_command", { request });
              }
              if (await onSave(work, "구독 이력을 정정했습니다.")) onClose();
            } catch (reason) {
              setError(String(reason).replace(/^Error: /, ""));
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="correction-fields">
            <div className="field-grid issue-fields">
              <label className="field">
                시작 연도
                <input
                  autoFocus
                  name="year"
                  type="number"
                  min="1"
                  defaultValue={year}
                />
              </label>
              <label className="field">
                호
                <select name="month" defaultValue={month}>
                  {[1, 3, 5, 7, 9, 11].map((m) => (
                    <option key={m} value={m}>
                      {m}~{m + 1}월호
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              {target.kind === "annual" ? "매 호 수량" : "구매·전달 수량"}
              <input
                type="number"
                name="quantity"
                min="1"
                defaultValue={value.quantity}
              />
            </label>
            {conflicts.length > 0 && (
              <div
                className="duplicate-warning"
                data-testid="correction-conflicts"
              >
                <ul>
                  {conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={confirm}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setConfirm(e.target.checked);
                    }}
                  />
                  불일치를 확인했고 실제 배부 기록을 유지하며 정정합니다
                </label>
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button submit"
              type="submit"
              disabled={busy || Boolean(conflicts.length && !confirm)}
            >
              {busy ? "저장 중…" : "정정 저장"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
