import type { ReactNode } from "react";

import type { ReversibleAction } from "./actionHistory";
import {
  type DeskPerson,
  type Issue,
  createCheckItem,
  createDraft,
  createPinnedNote,
  distribute,
  recordPurchase,
  setOperator,
  undoDistribution,
  updateCheckItemStatus,
  updatePinnedNote,
} from "./phase2";

export type Phase2Dialog =
  | { type: "operator" }
  | { type: "draft" }
  | { type: "check-item"; personId: string | null }
  | { type: "pinned-note" }
  | { type: "purchase" }
  | { type: "partial"; person: DeskPerson }
  | { type: "cancel-distribution"; person: DeskPerson }
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
  mutate: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  recordAction: (action: ReversibleAction) => void;
}) {
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
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate(
              () =>
                createDraft(issue, {
                  name: String(data.get("name") ?? ""),
                  cohort: String(data.get("cohort") ?? ""),
                  phone: String(data.get("phone") ?? ""),
                  quantity: Number(data.get("quantity")),
                }),
              "현장 신청자를 추가했습니다. 목록에서 바로 배부할 수 있습니다.",
            );
          }}
        >
          <p className="dialog-description">
            이름 또는 또래만 알아도 등록할 수 있습니다. 현재 호부터 연속 6개 호
            구독으로 기록합니다.
          </p>
          <div className="field-grid">
            <Field label="이름">
              <input name="name" autoFocus placeholder="모르면 비워두세요" />
            </Field>
            <Field label="또래">
              <input
                name="cohort"
                inputMode="numeric"
                pattern="[0-9]{2}"
                maxLength={2}
                placeholder="94"
              />
            </Field>
          </div>
          <Field label="연락처">
            <input name="phone" inputMode="tel" placeholder="선택 입력" />
          </Field>
          <Field label="매 호 받을 수량">
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
          </Field>
          <SubmitButton busy={busy}>간이 등록</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "check-item") {
    return (
      <FormDialog title="확인할 일 추가" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            let createdId = "";
            void mutate(async () => {
              createdId = await createCheckItem(
                dialog.personId,
                String(data.get("content") ?? ""),
              );
            }, "확인할 일을 저장했습니다.").then((saved) => {
              if (saved && createdId) {
                recordAction({
                  description: "확인할 일 추가",
                  undo: () => updateCheckItemStatus(createdId, "archived"),
                  redo: () => updateCheckItemStatus(createdId, "needs_check"),
                });
              }
            });
          }}
        >
          <p className="dialog-description">
            신청 누락 확인처럼 곧 처리할 일을 적습니다. 완료하기 전까지 기본
            화면에 남습니다.
          </p>
          <Field label="확인할 내용">
            <textarea name="content" required autoFocus rows={5} />
          </Field>
          <SubmitButton busy={busy}>확인할 일 저장</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "pinned-note") {
    return (
      <FormDialog title="고정 메모" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            let createdId = "";
            void mutate(async () => {
              createdId = await createPinnedNote({
                title: String(data.get("title") ?? ""),
                content: String(data.get("content") ?? ""),
                isPinned: data.get("isPinned") === "on",
              });
            }, "고정 메모를 저장했습니다.").then((saved) => {
              if (saved && createdId) {
                recordAction({
                  description: "고정 메모 추가",
                  undo: () => updatePinnedNote(createdId, { archived: true }),
                  redo: () => updatePinnedNote(createdId, { archived: false }),
                });
              }
            });
          }}
        >
          <p className="dialog-description">
            책 보관 위치처럼 여러 주 또는 몇 달 동안 확인할 안내를 적습니다.
          </p>
          <Field label="제목">
            <input name="title" required autoFocus />
          </Field>
          <Field label="내용">
            <textarea name="content" required rows={4} />
          </Field>
          <label className="check-field">
            <input name="isPinned" type="checkbox" defaultChecked /> 기본 화면에
            고정
          </label>
          <SubmitButton busy={busy}>고정 메모 저장</SubmitButton>
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
            void mutate(
              () =>
                recordPurchase(issue, {
                  buyerName: String(data.get("buyerName") ?? ""),
                  quantity: Number(data.get("quantity")),
                  note: String(data.get("note") ?? ""),
                }),
              "개별 구매와 전달을 기록했습니다.",
            );
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
            onClick={() =>
              void mutate(
                () =>
                  undoDistribution(
                    issue,
                    dialog.person.subscriptionId ?? undefined,
                  ),
                `${dialog.person.name}님의 최근 배부를 취소했습니다.`,
              )
            }
          >
            배부 취소
          </button>
        </div>
      </FormDialog>
    );
  }
  return (
    <FormDialog title="일부 수량만 배부" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate(
            () =>
              distribute(
                issue,
                dialog.person.subscriptionId!,
                Number(data.get("quantity")),
              ),
            `${dialog.person.name} · 일부 배부를 기록했습니다.`,
          );
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
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
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
