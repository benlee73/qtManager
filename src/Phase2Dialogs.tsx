import { useEffect, useState, type ReactNode } from "react";

import type { ReversibleAction } from "./actionHistory";
import { validateDraftInput } from "./draftValidation";
import { handlePhoneInput } from "./phone";
import { filterPurchasePeople, purchasePersonLabel } from "./purchasePeople";
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
  const [purchasePeople, setPurchasePeople] = useState<PersonSummary[]>([]);
  const [purchasePeopleLoading, setPurchasePeopleLoading] = useState(true);
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [selectedPurchasePerson, setSelectedPurchasePerson] =
    useState<PersonSummary | null>(null);
  const [purchaseNewPersonMode, setPurchaseNewPersonMode] = useState(false);

  useEffect(() => {
    if (dialog.type !== "purchase") return;
    let active = true;
    void loadManagement("", false)
      .then((management) => {
        if (active) setPurchasePeople(management.people);
      })
      .catch(() => {
        if (active) setPurchasePeople([]);
      })
      .finally(() => {
        if (active) setPurchasePeopleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dialog.type]);

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
              placeholder="010-1234-5678 (선택)"
              maxLength={13}
              pattern="010-[0-9]{4}-[0-9]{4}"
              onInput={handlePhoneInput}
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
    const purchaseMatches = filterPurchasePeople(purchasePeople, purchaseQuery);
    return (
      <FormDialog
        title="현장 개별 구매"
        className="purchase-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
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
              phone: String(data.get("purchasePhone") ?? ""),
              quantity,
              note,
            };
            // Undo/redo keeps the newly created applicant identity stable. A
            // redo must add another purchase to the same record, rather than
            // creating a second applicant with the same name.
            let createdPersonId: string | null = null;
            const work: () => Promise<void> = purchaseNewPersonMode
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
                    description: "현장 개별 구매",
                    undo: () => cancelLatestPurchase(issue),
                    redo: work,
                  });
                }
              },
            );
          }}
        >
          <p className="dialog-description">
            이번 호만 구매해 바로 전달합니다. 기존 신청자를 선택하면 구매 이력이
            연결되고, 찾지 못한 경우에만 새 인원을 추가합니다.
          </p>
          <div className="purchase-person-picker">
            <Field label="구매자 이름 또는 또래">
              <input
                name="buyerName"
                value={purchaseQuery}
                autoFocus
                required={purchaseNewPersonMode}
                placeholder="이름·또래 검색 (비워두면 익명)"
                data-testid="purchase-person-search"
                onChange={(event) => {
                  setPurchaseQuery(event.currentTarget.value);
                  setSelectedPurchasePerson(null);
                  setPurchaseNewPersonMode(false);
                }}
              />
            </Field>
            {selectedPurchasePerson ? (
              <div className="purchase-person-selected">
                <span>
                  연결할 신청자:{" "}
                  <strong>{purchasePersonLabel(selectedPurchasePerson)}</strong>
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setSelectedPurchasePerson(null);
                    setPurchaseQuery("");
                  }}
                >
                  선택 해제
                </button>
              </div>
            ) : (
              <>
                {purchasePeopleLoading && (
                  <p className="purchase-person-hint">
                    신청자 목록을 불러오는 중…
                  </p>
                )}
                {!purchasePeopleLoading && purchaseQuery.trim() && (
                  <div className="purchase-person-results" role="listbox">
                    {purchaseMatches.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="purchase-person-result"
                        data-testid="purchase-person-result"
                        onClick={() => {
                          setSelectedPurchasePerson(person);
                          setPurchaseQuery(person.name);
                          setPurchaseNewPersonMode(false);
                        }}
                      >
                        <span className="purchase-person-cohort">
                          {person.cohort ?? "--"}
                        </span>
                        <span>{person.name}</span>
                      </button>
                    ))}
                    {purchaseMatches.length === 0 && (
                      <p className="purchase-person-hint">
                        일치하는 기존 신청자가 없습니다.
                      </p>
                    )}
                  </div>
                )}
                {purchaseQuery.trim() && (
                  <button
                    type="button"
                    className="purchase-new-person-toggle"
                    data-testid="purchase-new-person-toggle"
                    onClick={() =>
                      setPurchaseNewPersonMode((current) => !current)
                    }
                  >
                    {purchaseNewPersonMode
                      ? "기존 신청자 선택으로 돌아가기"
                      : "신규 인원으로 추가"}
                  </button>
                )}
              </>
            )}
            {purchaseNewPersonMode && !selectedPurchasePerson && (
              <div className="purchase-new-person-fields">
                <p className="purchase-person-hint">
                  구독 없이 이번 구매 이력만 연결된 신청자로 저장합니다.
                </p>
                <div className="field-grid">
                  <Field label="또래 (선택)">
                    <input
                      name="purchaseCohort"
                      inputMode="numeric"
                      pattern="[0-9]{2}"
                      maxLength={2}
                      placeholder="94"
                      onInput={(event) => {
                        const input = event.currentTarget;
                        const digits = input.value
                          .replace(/[^0-9]/g, "")
                          .slice(0, 2);
                        if (digits !== input.value) input.value = digits;
                      }}
                    />
                  </Field>
                  <Field label="연락처 (선택)">
                    <input
                      name="purchasePhone"
                      inputMode="tel"
                      placeholder="010-1234-5678"
                      maxLength={13}
                      pattern="010-[0-9]{4}-[0-9]{4}"
                      onInput={handlePhoneInput}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
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
