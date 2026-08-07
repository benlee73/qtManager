import { useEffect, useState, type ReactNode } from "react";

import type { ReversibleAction } from "./actionHistory";
import { validateDraftInput } from "./draftValidation";
import { distributionAllocations } from "./distributionView";
import {
  type DeskPerson,
  type DistributionAllocation,
  type Issue,
  cancelLatestPurchase,
  cancelPersonDistribution,
  createMemo,
  createDraft,
  distributeAllocations,
  recordPurchase,
  setOperator,
  undoDistributionAllocations,
  updateMemoStatus,
} from "./phase2";

export type Phase2Dialog =
  | { type: "operator" }
  | { type: "draft" }
  | { type: "memo"; personId: string | null }
  | { type: "purchase" }
  | { type: "partial"; person: DeskPerson }
  | { type: "cancel-distribution"; person: DeskPerson }
  | { type: "confirm-distribution"; person: DeskPerson }
  | null;

export function Phase2DialogContent({
  dialog,
  issue,
  busy,
  onClose,
  mutate,
  recordAction,
}: {
  dialog: Exclude<Phase2Dialog, null>;
  issue: Issue;
  busy: boolean;
  onClose: () => void;
  mutate: (
    work: () => Promise<unknown>,
    success: string,
    options?: { preserveHistory?: boolean },
  ) => Promise<boolean>;
  recordAction: (action: ReversibleAction) => void;
}) {
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftError) return;
    const timeout = window.setTimeout(() => setDraftError(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [draftError]);

  if (dialog.type === "operator") {
    return (
      <FormDialog title="현재 담당자 설정" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate(
              () => setOperator(String(data.get("name") ?? "")),
              "담당자를 설정했습니다.",
            );
          }}
        >
          <p className="dialog-description">
            로그인은 필요 없습니다. 배부와 기록 이력에 당시 담당자 이름만
            남습니다.
          </p>
          <Field label="담당자 이름">
            <input name="name" required autoFocus placeholder="예: 김담당" />
          </Field>
          <SubmitButton busy={busy}>저장하고 시작</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "draft") {
    return (
      <FormDialog title="현장 간이 등록" onClose={onClose}>
        <form
          data-testid="draft-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const input = {
              name: String(data.get("name") ?? ""),
              cohort: String(data.get("cohort") ?? ""),
              phone: String(data.get("phone") ?? ""),
              quantity: Number(data.get("quantity")),
            };
            const validationError = validateDraftInput(input);
            if (validationError) {
              setDraftError(validationError);
              if (!input.name.trim()) {
                (
                  event.currentTarget.elements.namedItem(
                    "name",
                  ) as HTMLInputElement | null
                )?.focus();
              }
              return;
            }
            setDraftError(null);
            void mutate(
              () => createDraft(issue, input),
              "현장 신청자를 추가했습니다. 목록에서 바로 배부할 수 있습니다.",
            );
          }}
        >
          <p className="dialog-description">
            이름은 반드시 입력해야 합니다. 또래와 연락처는 나중에 보완할 수
            있으며, 현재 호부터 연속 6개 호 구독으로 기록합니다.
          </p>
          <div className="field-grid">
            <Field label="이름">
              <input
                name="name"
                required
                autoFocus
                placeholder="이름을 입력하세요"
                onChange={() => setDraftError(null)}
              />
            </Field>
            <Field label="또래">
              <input
                name="cohort"
                inputMode="numeric"
                pattern="[0-9]{2}"
                maxLength={2}
                placeholder="94"
                onInput={(event) => {
                  const input = event.currentTarget;
                  const digits = input.value.replace(/[^0-9]/g, "").slice(0, 2);
                  if (digits !== input.value) input.value = digits;
                  setDraftError(null);
                }}
              />
            </Field>
          </div>
          <Field label="연락처">
            <input
              name="phone"
              inputMode="tel"
              placeholder="선택 입력"
              onChange={() => setDraftError(null)}
            />
          </Field>
          <Field label="매 호 받을 수량">
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={1}
              required
              onChange={() => setDraftError(null)}
            />
          </Field>
          {draftError && (
            <p
              className="form-error draft-form-error"
              role="alert"
              data-testid="draft-form-error"
            >
              {draftError}
            </p>
          )}
          <SubmitButton busy={busy}>간이 등록</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "memo") {
    return (
      <FormDialog title="메모 추가" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            let createdId = "";
            void mutate(async () => {
              createdId = await createMemo(
                dialog.personId,
                String(data.get("content") ?? ""),
              );
            }, "메모를 저장했습니다.").then((saved) => {
              if (saved && createdId) {
                recordAction({
                  description: "메모 추가",
                  undo: () => updateMemoStatus(createdId, true),
                  redo: () => updateMemoStatus(createdId, false),
                });
              }
            });
          }}
        >
          <p className="dialog-description">
            처리할 내용이나 신청자에게만 적용되는 참고사항을 한 곳에 기록합니다.
          </p>
          <Field label="메모 내용">
            <textarea name="content" required autoFocus rows={6} />
          </Field>
          <SubmitButton busy={busy}>메모 저장</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "purchase") {
    return (
      <FormDialog title="현장 개별 구매" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const input = {
              buyerName: String(data.get("buyerName") ?? ""),
              quantity: Number(data.get("quantity")),
              note: String(data.get("note") ?? ""),
            };
            void mutate(
              () => recordPurchase(issue, input),
              "개별 구매와 전달을 기록했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: "현장 개별 구매",
                  undo: () => cancelLatestPurchase(issue),
                  redo: () => recordPurchase(issue, input),
                });
              }
            });
          }}
        >
          <p className="dialog-description">
            연간 구독과 별개로 이번 호를 현장에서 구매해 바로 전달한 경우에만
            사용합니다.
          </p>
          <Field label="구매자 이름">
            <input name="buyerName" autoFocus placeholder="모르면 비워두세요" />
          </Field>
          <Field label="수량">
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
          </Field>
          <Field label="선택 메모">
            <input name="note" />
          </Field>
          <SubmitButton busy={busy}>구매·전달 기록</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "cancel-distribution") {
    return (
      <FormDialog title="배부를 취소할까요?" onClose={onClose}>
        <p className="dialog-description">
          {dialog.person.name}님의 이번 호 최근 배부 기록을 취소합니다. 취소
          이력은 남으며 필요한 경우 다시 배부할 수 있습니다.
        </p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            돌아가기
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => {
              let cancelled: DistributionAllocation[] = [];
              void mutate(async () => {
                cancelled = await cancelPersonDistribution(
                  issue,
                  dialog.person,
                );
              }, `${dialog.person.name}님의 최근 배부를 취소했습니다.`).then(
                (saved) => {
                  if (saved && cancelled.length > 0) {
                    recordAction({
                      description: `${dialog.person.name} 배부 취소`,
                      undo: () => distributeAllocations(issue, cancelled),
                      redo: () => undoDistributionAllocations(issue, cancelled),
                    });
                  }
                },
              );
            }}
          >
            배부 취소
          </button>
        </div>
      </FormDialog>
    );
  }
  if (dialog.type === "confirm-distribution") {
    return (
      <FormDialog title="배부하시겠습니까?" onClose={onClose}>
        <form
          data-testid="confirm-distribution-form"
          onSubmit={(event) => {
            event.preventDefault();
            const allocations = distributionAllocations(dialog.person);
            void mutate(
              () => distributeAllocations(issue, allocations),
              `${dialog.person.name} · ${dialog.person.remainingQuantity}권 배부했습니다.`,
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: `${dialog.person.name} 배부`,
                  undo: () => undoDistributionAllocations(issue, allocations),
                  redo: () => distributeAllocations(issue, allocations),
                });
              }
            });
          }}
        >
          <p className="dialog-description">
            {dialog.person.name}님에게 이번 호 {dialog.person.remainingQuantity}
            권을 배부합니다.
          </p>
          <div className="confirm-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              돌아가기
            </button>
            <button
              className="primary-button"
              type="submit"
              autoFocus
              disabled={busy}
            >
              {busy ? "배부 중…" : "배부하기"}
            </button>
          </div>
        </form>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title="일부 수량만 배부"
      className="partial-distribution-dialog"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const quantity = Number(data.get("quantity"));
          const allocations = distributionAllocations(dialog.person, quantity);
          void mutate(
            () => distributeAllocations(issue, allocations),
            `${dialog.person.name} · 일부 배부를 기록했습니다.`,
          ).then((saved) => {
            if (saved) {
              recordAction({
                description: `${dialog.person.name} 일부 배부`,
                undo: () => undoDistributionAllocations(issue, allocations),
                redo: () => distributeAllocations(issue, allocations),
              });
            }
          });
        }}
      >
        <p className="dialog-description">
          {dialog.person.name}님에게 남은 {dialog.person.remainingQuantity}권 중
          실제 전달한 수량을 선택하세요.
        </p>
        <Field label="이번에 배부한 수량">
          <input
            name="quantity"
            type="number"
            min={1}
            max={dialog.person.remainingQuantity - 1}
            defaultValue={1}
            required
            autoFocus
          />
        </Field>
        <SubmitButton busy={busy}>일부 배부 기록</SubmitButton>
      </form>
    </FormDialog>
  );
}

function FormDialog({
  title,
  children,
  className,
  onClose,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={className ? `dialog ${className}` : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="primary-button submit" type="submit" disabled={busy}>
      {busy ? "저장 중…" : children}
    </button>
  );
}
