import {
  validatePurchaseInput,
  type PurchaseInput,
} from "./purchaseValidation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ReversibleAction } from "./actionHistory";
import { AnnualSubscriptionForm } from "./AnnualSubscriptionForm";
import { CohortField } from "./CohortField";
import { handlePhoneInput } from "./phone";
import { filterPurchasePeople } from "./purchasePeople";
import { PurchasePersonPicker } from "./PurchasePersonPicker";
import {
  activeDistributionMemos,
  distributionAllocations,
} from "./distributionView";
import { DistributionMemoNotice } from "./DistributionMemoNotice";
import {
  type DeskPerson,
  type DistributionAllocation,
  type Issue,
  type MemoView,
  cancelLatestPurchase,
  cancelPersonDistribution,
  createMemo,
  distributeAllocations,
  recordPurchase,
  recordGroupDistribution,
  cancelGroupDistribution,
  recordPurchaseForNewPerson,
  setOperator,
  undoDistributionAllocations,
  updateMemoStatus,
} from "./phase2";
import { loadManagement, type PersonSummary } from "./phase3";

export type Phase2Dialog =
  | { type: "operator" }
  | { type: "draft" }
  | { type: "memo"; personId: string | null }
  | { type: "purchase" }
  | { type: "group-distribution"; person: DeskPerson }
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
  memos = [],
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
  memos?: MemoView[];
}) {
  const distributionSubmitting = useRef(false);
  const distributionMemos =
    dialog.type === "confirm-distribution" ||
    dialog.type === "partial" ||
    dialog.type === "group-distribution"
      ? activeDistributionMemos(memos, dialog.person.personId)
      : [];
  const [purchasePeople, setPurchasePeople] = useState<PersonSummary[]>([]);
  const [purchasePeopleLoading, setPurchasePeopleLoading] = useState(true);
  const [purchasePeopleError, setPurchasePeopleError] = useState(false);
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [selectedPurchasePerson, setSelectedPurchasePerson] =
    useState<PersonSummary | null>(null);
  const [purchaseNewPersonMode, setPurchaseNewPersonMode] = useState(false);
  const [purchaseErrors, setPurchaseErrors] = useState<
    Partial<Record<keyof PurchaseInput, string>>
  >({});
  const clearPurchaseError = (field: keyof PurchaseInput) =>
    setPurchaseErrors((current) => ({ ...current, [field]: undefined }));

  useEffect(() => {
    if (dialog.type !== "purchase") return;
    let active = true;
    void loadManagement("", false)
      .then((management) => {
        if (active) setPurchasePeople(management.people);
      })
      .catch(() => {
        if (active) setPurchasePeopleError(true);
      })
      .finally(() => {
        if (active) setPurchasePeopleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dialog.type]);

  if (dialog.type === "group-distribution") {
    return (
      <FormDialog title="군지체 배부" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (distributionSubmitting.current || busy) return;
            distributionSubmitting.current = true;
            const quantity = Number(
              new FormData(event.currentTarget).get("quantity"),
            );
            let purchaseId = "";
            const work = async () => {
              purchaseId = await recordGroupDistribution(
                issue,
                dialog.person.personId,
                quantity,
              );
            };
            void mutate(work, `군지체 · ${quantity}권 배부를 기록했습니다.`)
              .then((saved) => {
                if (saved)
                  recordAction({
                    description: `군지체 ${quantity}권 배부`,
                    undo: () =>
                      cancelGroupDistribution(
                        issue,
                        dialog.person.personId,
                        purchaseId,
                      ),
                    redo: work,
                  });
              })
              .finally(() => {
                distributionSubmitting.current = false;
              });
          }}
        >
          <DistributionMemoNotice memos={distributionMemos} />
          <Field label="이번에 배부한 권수">
            <input
              name="quantity"
              type="number"
              min="1"
              max="10000"
              required
              autoFocus
              defaultValue="1"
            />
          </Field>
          <SubmitButton busy={busy}>
            {distributionMemos.length ? "메모 확인 후 배부 기록" : "배부 기록"}
          </SubmitButton>
        </form>
      </FormDialog>
    );
  }
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
      <FormDialog
        title="1년 구독"
        className="purchase-dialog"
        onClose={onClose}
      >
        <AnnualSubscriptionForm
          issue={issue}
          busy={busy}
          mutate={mutate}
          recordAction={recordAction}
        />
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
    const purchaseMatches = filterPurchasePeople(purchasePeople, purchaseQuery);
    const addNewPerson =
      !selectedPurchasePerson &&
      (purchaseNewPersonMode ||
        (!purchasePeopleLoading &&
          !purchasePeopleError &&
          Boolean(purchaseQuery.trim()) &&
          purchaseMatches.length === 0));
    return (
      <FormDialog
        title="1달 구독"
        className="purchase-dialog"
        onClose={onClose}
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (busy || purchasePeopleLoading || purchasePeopleError) return;
            const buyerName = String(data.get("buyerName") ?? "").trim();
            const quantity = Number(data.get("quantity"));
            const note = String(data.get("note") ?? "");
            const input = {
              buyerName,
              personId: selectedPurchasePerson?.id ?? null,
              quantity,
              note,
            };
            const newPersonInput = {
              name: buyerName,
              cohort: String(data.get("purchaseCohort") ?? ""),
              cohortNotApplicable: data.get("cohortNotApplicable") === "on",
              phone: String(data.get("purchasePhone") ?? ""),
              quantity,
              note,
            };
            const invalid = validatePurchaseInput(
              {
                buyerName,
                purchaseCohort: newPersonInput.cohort,
                purchasePhone: newPersonInput.phone,
                quantity,
              },
              addNewPerson,
            );
            setPurchaseErrors(invalid);
            if (Object.keys(invalid).length) {
              (
                event.currentTarget.elements.namedItem(
                  Object.keys(invalid)[0],
                ) as HTMLInputElement | null
              )?.focus();
              return;
            }
            // Undo/redo keeps the newly created applicant identity stable. A
            // redo must add another purchase to the same record, rather than
            // creating a second applicant with the same name.
            let createdPersonId: string | null = null;
            const work: () => Promise<void> = addNewPerson
              ? async () => {
                  if (createdPersonId) {
                    await recordPurchase(issue, {
                      ...input,
                      personId: createdPersonId,
                    });
                    return;
                  }
                  createdPersonId = await recordPurchaseForNewPerson(
                    issue,
                    newPersonInput,
                  );
                }
              : () => recordPurchase(issue, input);
            void mutate(work, "개별 구매와 전달을 기록했습니다.").then(
              (saved) => {
                if (saved) {
                  recordAction({
                    description: "1달 구독",
                    undo: () => cancelLatestPurchase(issue),
                    redo: work,
                  });
                }
              },
            );
          }}
        >
          <p className="dialog-description">
            {issue.year}년 {issue.startMonth}~{issue.startMonth + 1}월호
          </p>
          <div className="purchase-person-picker">
            <PurchasePersonPicker
              query={purchaseQuery}
              matches={purchaseMatches}
              selected={selectedPurchasePerson}
              loading={purchasePeopleLoading}
              failed={purchasePeopleError}
              newPerson={addNewPerson}
              error={purchaseErrors.buyerName}
              onQuery={(query) => {
                setPurchaseQuery(query);
                setPurchaseErrors({});
                setSelectedPurchasePerson(null);
                setPurchaseNewPersonMode(false);
              }}
              onSelect={(person) => {
                setSelectedPurchasePerson(person);
                setPurchaseErrors({});
                setPurchaseQuery(person?.name ?? "");
                setPurchaseNewPersonMode(false);
              }}
              onNew={() => setPurchaseNewPersonMode(true)}
            />
            {addNewPerson && !selectedPurchasePerson && (
              <div className="purchase-new-person-fields">
                <div className="field-grid">
                  <div className="field">
                    <span>또래 (선택)</span>
                    <CohortField name="purchaseCohort" />
                    {purchaseErrors.purchaseCohort && (
                      <span
                        className="form-error"
                        id="purchase-cohort-error"
                        role="alert"
                      >
                        {purchaseErrors.purchaseCohort}
                      </span>
                    )}
                  </div>
                  <Field label="연락처 (선택)">
                    <input
                      name="purchasePhone"
                      aria-invalid={Boolean(purchaseErrors.purchasePhone)}
                      aria-describedby={
                        purchaseErrors.purchasePhone
                          ? "purchase-phone-error"
                          : undefined
                      }
                      onChange={() => clearPurchaseError("purchasePhone")}
                      inputMode="tel"
                      placeholder="010-1234-5678"
                      maxLength={13}
                      pattern="010-[0-9]{4}-[0-9]{4}"
                      onInput={handlePhoneInput}
                    />
                    {purchaseErrors.purchasePhone && (
                      <span
                        className="form-error"
                        id="purchase-phone-error"
                        role="alert"
                      >
                        {purchaseErrors.purchasePhone}
                      </span>
                    )}
                  </Field>
                </div>
              </div>
            )}
          </div>
          <Field label="수량">
            <input
              name="quantity"
              aria-invalid={Boolean(purchaseErrors.quantity)}
              aria-describedby={
                purchaseErrors.quantity ? "purchase-quantity-error" : undefined
              }
              onChange={() => clearPurchaseError("quantity")}
              type="number"
              min={1}
              defaultValue={1}
              required
            />
            {purchaseErrors.quantity && (
              <span
                className="form-error"
                id="purchase-quantity-error"
                role="alert"
              >
                {purchaseErrors.quantity}
              </span>
            )}
          </Field>
          <Field label="선택 메모">
            <input name="note" />
          </Field>
          <SubmitButton
            busy={busy || purchasePeopleLoading || purchasePeopleError}
          >
            구매·전달 기록
          </SubmitButton>
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
              if (
                dialog.person.isGroup &&
                dialog.person.latestGroupDistributionId
              ) {
                let purchaseId = dialog.person.latestGroupDistributionId;
                void mutate(
                  () =>
                    cancelGroupDistribution(
                      issue,
                      dialog.person.personId,
                      purchaseId,
                    ),
                  "군지체의 최근 배부를 취소했습니다.",
                ).then((saved) => {
                  if (saved)
                    recordAction({
                      description: "군지체 배부 취소",
                      undo: async () => {
                        purchaseId = await recordGroupDistribution(
                          issue,
                          dialog.person.personId,
                          dialog.person.latestGroupDistributionQuantity ?? 1,
                        );
                      },
                      redo: () =>
                        cancelGroupDistribution(
                          issue,
                          dialog.person.personId,
                          purchaseId,
                        ),
                    });
                });
                return;
              }
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
      <FormDialog
        title={
          distributionMemos.length ? "배부 전 메모 확인" : "배부하시겠습니까?"
        }
        onClose={onClose}
      >
        <form
          data-testid="confirm-distribution-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || distributionSubmitting.current) return;
            distributionSubmitting.current = true;
            const allocations = distributionAllocations(dialog.person);
            void mutate(
              () => distributeAllocations(issue, allocations),
              `${dialog.person.name} · ${dialog.person.remainingQuantity}권 배부했습니다.`,
            )
              .then((saved) => {
                if (saved) {
                  recordAction({
                    description: `${dialog.person.name} 배부`,
                    undo: () => undoDistributionAllocations(issue, allocations),
                    redo: () => distributeAllocations(issue, allocations),
                  });
                }
              })
              .finally(() => {
                distributionSubmitting.current = false;
              });
          }}
        >
          <p className="dialog-description">
            {dialog.person.name}님에게 이번 호 {dialog.person.remainingQuantity}
            권을 배부합니다.
          </p>
          <DistributionMemoNotice memos={distributionMemos} />
          <div className="confirm-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              {distributionMemos.length ? "취소" : "돌아가기"}
            </button>
            <button
              className="primary-button"
              type="submit"
              autoFocus
              disabled={busy}
            >
              {busy
                ? "배부 중…"
                : distributionMemos.length
                  ? `확인 후 ${dialog.person.remainingQuantity}권 배부`
                  : "배부하기"}
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
          if (busy || distributionSubmitting.current) return;
          distributionSubmitting.current = true;
          const data = new FormData(event.currentTarget);
          const quantity = Number(data.get("quantity"));
          const allocations = distributionAllocations(dialog.person, quantity);
          void mutate(
            () => distributeAllocations(issue, allocations),
            `${dialog.person.name} · 일부 배부를 기록했습니다.`,
          )
            .then((saved) => {
              if (saved) {
                recordAction({
                  description: `${dialog.person.name} 일부 배부`,
                  undo: () => undoDistributionAllocations(issue, allocations),
                  redo: () => distributeAllocations(issue, allocations),
                });
              }
            })
            .finally(() => {
              distributionSubmitting.current = false;
            });
        }}
      >
        <p className="dialog-description">
          {dialog.person.name}님에게 남은 {dialog.person.remainingQuantity}권 중
          실제 전달한 수량을 선택하세요.
        </p>
        <DistributionMemoNotice memos={distributionMemos} />
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
        <SubmitButton busy={busy}>
          {distributionMemos.length ? "확인 후 일부 배부" : "일부 배부 기록"}
        </SubmitButton>
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
