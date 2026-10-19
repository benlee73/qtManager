import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PersonDetail } from "./phase3";
export type CorrectionTarget =
  | { kind: "annual"; value: PersonDetail["subscriptions"][number] }
  | { kind: "purchase"; value: NonNullable<PersonDetail["purchases"]>[number] };
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
  const applied =
    target.kind === "annual"
      ? target.value.appliedAt
      : target.value.purchasedAt;
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
              const base = {
                personId,
                expectedRevision: value.revision,
                issueYear,
                issueMonth,
                quantity,
              };
              let work: () => Promise<unknown>;
              if (target.kind === "annual") {
                const request = {
                  ...base,
                  subscriptionId: target.value.id,
                  appliedAt: String(data.get("date") ?? "").trim() || null,
                  memo: String(data.get("note") ?? "").trim() || null,
                  confirmConflicts: confirm,
                };
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
                const request = {
                  ...base,
                  purchaseId: target.value.id,
                  purchasedAt: String(data.get("date") ?? "").trim(),
                  note: String(data.get("note") ?? "").trim() || null,
                };
                if (!request.purchasedAt)
                  throw new Error("구매·전달 시각을 입력하세요.");
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
            <div className="field-grid">
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
            <label className="field">
              {target.kind === "annual" ? "신청일" : "구매·전달 시각"}
              <input
                name="date"
                defaultValue={applied ?? ""}
                placeholder="YYYY-MM-DD 또는 기존 시각"
              />
            </label>
            <label className="field">
              메모
              <input
                name="note"
                defaultValue={
                  (target.kind === "annual"
                    ? target.value.memo
                    : target.value.note) ?? ""
                }
              />
            </label>
            <p>
              {target.kind === "annual"
                ? "실제 배부 기록은 그대로 보존합니다."
                : "원본과 정정 기록을 보존하고 정정한 구매·전달 수량을 합계에 반영합니다."}
            </p>
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
