import { useEffect, useState, useRef, type ReactNode } from "react";
import { validateDraftFields, type DraftInput } from "./draftValidation";
import type { ReversibleAction } from "./actionHistory";
import {
  undoDistributionAllocations,
  distributeAllocations,
  type Issue,
} from "./phase2";
import {
  loadManagement,
  loadPersonDetail,
  type PersonSummary,
  type LinkedMemo,
} from "./phase3";
import { filterPurchasePeople } from "./purchasePeople";
import { PurchasePersonPicker } from "./PurchasePersonPicker";
import { saveAnnualSubscription } from "./annualRegistration";
import { CohortField } from "./CohortField";
import { handlePhoneInput } from "./phone";
import { handleAnnualFormKeyDown } from "./annualKeyboard";

export function AnnualSubscriptionForm({
  issue,
  busy,
  mutate,
  recordAction,
  initialPerson,
  formTestId = "draft-form",
  showApplicationDate = false,
}: {
  issue: Issue;
  busy: boolean;
  initialPerson?: Pick<
    PersonSummary,
    "id" | "name" | "cohort" | "phone" | "cohortNotApplicable"
  >;
  formTestId?: string;
  showApplicationDate?: boolean;
  recordAction?: (action: ReversibleAction) => void;
  mutate: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [startIssue, setStartIssue] = useState(issue);
  const sameIssue =
    startIssue.year === issue.year &&
    startIssue.startMonth === issue.startMonth;
  const [memos, setMemos] = useState<LinkedMemo[]>([]);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoConfirmed, setMemoConfirmed] = useState(false);
  const [memoFailed, setMemoFailed] = useState(false);
  const submitting = useRef(false);
  const requestId = useRef(
    globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [query, setQuery] = useState(initialPerson?.name ?? "");
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PersonSummary | null>(
    initialPerson
      ? {
          ...initialPerson,
          status: "정식 등록",
          personNote: null,
          subscriptionCount: 0,
          latestLastIssue: null,
        }
      : null,
  );
  const [newPerson, setNewPerson] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof DraftInput, string>>
  >({});
  const [overlap, setOverlap] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const matches = filterPurchasePeople(people, query);
  const addingNewPerson =
    newPerson ||
    (!loading && !failed && Boolean(query.trim()) && matches.length === 0);
  useEffect(() => {
    let active = true;
    void loadManagement("", false)
      .then((view) => {
        if (active) setPeople(view.people);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setMemos([]);
    setMemoConfirmed(false);
    setMemoFailed(false);
    if (!selected) {
      setMemoLoading(false);
      return;
    }
    setMemoLoading(true);
    void loadPersonDetail(selected.id)
      .then((detail) => {
        if (active) setMemos(detail.memos ?? []);
      })
      .catch(() => {
        if (active) setMemoFailed(true);
      })
      .finally(() => {
        if (active) setMemoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  const clear = (field: keyof DraftInput) =>
    setErrors((current) => ({ ...current, [field]: undefined }));
  const reset = () => {
    setErrors({});
    setOverlap(false);
    setConfirmed(false);
  };
  return (
    <form
      data-testid={formTestId}
      onKeyDown={(event) => handleAnnualFormKeyDown(event, sameIssue)}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          submitting.current ||
          busy ||
          loading ||
          failed ||
          (overlap && !confirmed)
        )
          return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const input = {
          name: query,
          cohort: String(data.get("cohort") ?? ""),
          cohortNotApplicable: data.get("cohortNotApplicable") === "on",
          phone: String(data.get("phone") ?? ""),
          quantity: Number(data.get("quantity")),
          memo: String(data.get("note") ?? ""),
          appliedAt: String(data.get("appliedAt") ?? ""),
        };
        const invalid = validateDraftFields(input, Boolean(selected));
        if (!selected && !newPerson && matches.length > 0 && query.trim()) {
          invalid.name =
            "기존 신청자를 선택하거나 신규 인원으로 추가를 선택하세요.";
        }
        setErrors(invalid);
        if (Object.keys(invalid).length) {
          (
            form.elements.namedItem(
              Object.keys(invalid)[0],
            ) as HTMLInputElement | null
          )?.focus();
          return;
        }
        const submitter = (event.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        const distribute =
          sameIssue &&
          (submitter?.value ? submitter.value === "distribute" : true);
        if (
          distribute &&
          (memoLoading || memoFailed || (memos.length > 0 && !memoConfirmed))
        )
          return;
        submitting.current = true;
        let outcome:
          | Awaited<ReturnType<typeof saveAnnualSubscription>>
          | undefined;
        try {
          const saved = await mutate(
            async () => {
              try {
                outcome = await saveAnnualSubscription(
                  startIssue,
                  input,
                  selected?.id ?? null,
                  confirmed,
                  {
                    requestId: requestId.current,
                    deskIssue: issue,
                    distribute,
                    confirmedMemoRevisions: distribute
                      ? memos.map((m) => `${m.id}:${m.updatedAt}`)
                      : [],
                  },
                );
              } catch (reason) {
                if (String(reason).includes("겹")) setOverlap(true);
                throw reason;
              }
            },
            distribute
              ? "1년 구독 신청과 배부를 기록했습니다."
              : "1년 구독 신청을 저장했습니다.",
          );
          if (saved && outcome?.distributed && recordAction) {
            const allocations = [
              {
                subscriptionId: outcome.subscriptionId,
                quantity: input.quantity,
              },
            ];
            recordAction({
              description: "배부 취소 (구독 유지)",
              undo: () => undoDistributionAllocations(issue, allocations),
              redo: () => distributeAllocations(issue, allocations),
            });
          }
        } finally {
          submitting.current = false;
        }
      }}
    >
      <div className="field-grid">
        <label className="field">
          시작 연도
          <input
            name="issueYear"
            data-testid="annual-start-year"
            type="number"
            min={1}
            value={startIssue.year}
            onChange={(e) => {
              setStartIssue({ ...startIssue, year: Number(e.target.value) });
              reset();
            }}
          />
        </label>
        <label className="field">
          시작 호
          <select
            name="issueMonth"
            data-testid="annual-start-month"
            value={startIssue.startMonth}
            onChange={(e) => {
              setStartIssue({
                ...startIssue,
                startMonth: Number(e.target.value),
              });
              reset();
            }}
          >
            {[1, 3, 5, 7, 9, 11].map((m) => (
              <option key={m} value={m}>
                {m}~{m + 1}월호
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="dialog-description">
        {startIssue.year + Math.floor((startIssue.startMonth - 1 + 10) / 12)}년{" "}
        {((startIssue.startMonth - 1 + 10) % 12) + 1}~
        {((startIssue.startMonth - 1 + 10) % 12) + 2}월호까지 · 6개 호
      </p>
      <div className="purchase-person-picker">
        <PurchasePersonPicker
          inputName="name"
          label="신청자 이름 또는 또래"
          placeholder="이름·또래 검색"
          required={!selected}
          query={query}
          matches={matches}
          selected={selected}
          loading={loading}
          failed={failed}
          newPerson={addingNewPerson}
          error={errors.name}
          onQuery={(value) => {
            setQuery(value);
            setSelected(null);
            setNewPerson(false);
            reset();
          }}
          onSelect={(person) => {
            setSelected(person);
            setQuery(person?.name ?? "");
            setNewPerson(false);
            reset();
          }}
          onNew={() => {
            setNewPerson(true);
            reset();
          }}
        />
        {addingNewPerson && !selected && (
          <div className="purchase-new-person-fields">
            <div className="field-grid">
              <div className="field">
                <span>또래</span>
                <CohortField
                  onChange={() => clear("cohort")}
                  invalid={Boolean(errors.cohort)}
                />
                {errors.cohort && (
                  <span
                    className="form-error"
                    role="alert"
                    id="draft-cohort-error"
                    data-testid="draft-cohort-error"
                  >
                    {errors.cohort}
                  </span>
                )}
              </div>
              <Field label="연락처 (선택)">
                <input
                  name="phone"
                  inputMode="tel"
                  maxLength={13}
                  placeholder="010-1234-5678 (선택)"
                  onInput={handlePhoneInput}
                  onChange={() => clear("phone")}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? "draft-phone-error" : undefined
                  }
                />
                {errors.phone && (
                  <span
                    id="draft-phone-error"
                    className="form-error"
                    role="alert"
                  >
                    {errors.phone}
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
          type="number"
          min={1}
          required
          defaultValue={1}
          onChange={() => clear("quantity")}
          aria-invalid={Boolean(errors.quantity)}
          aria-describedby={
            errors.quantity ? "draft-quantity-error" : undefined
          }
        />
        {errors.quantity && (
          <span id="draft-quantity-error" className="form-error" role="alert">
            {errors.quantity}
          </span>
        )}
      </Field>
      {showApplicationDate && (
        <label className="field">
          신청일
          <input name="appliedAt" type="date" />
        </label>
      )}
      <Field label="선택 메모">
        <input name="note" />
      </Field>
      {overlap && (
        <label className="duplicate-warning">
          <strong>기존 구독과 기간이 겹칠 수 있습니다.</strong>
          <span>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            겹침을 확인했고 새 구독을 추가합니다
          </span>
        </label>
      )}
      {sameIssue && memos.length > 0 && (
        <div className="duplicate-warning">
          <strong>배부 전 메모 확인</strong>
          <ul>
            {memos.map((m) => (
              <li key={m.id}>{m.content}</li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={memoConfirmed}
              onChange={(e) => setMemoConfirmed(e.target.checked)}
            />
            메모를 확인했고 배부합니다
          </label>
        </div>
      )}
      {sameIssue && memoLoading && <p>배부 전 메모 확인 중…</p>}
      {sameIssue && memoFailed && (
        <p className="form-error">
          메모를 불러오지 못했습니다. 신청만 저장하거나 창을 다시 여세요.
        </p>
      )}
      <div className="annual-submit-actions">
        {sameIssue && (
          <button
            type="submit"
            name="action"
            value="distribute"
            className="primary-button submit"
            data-testid="annual-submit-distribute"
            disabled={
              busy ||
              loading ||
              failed ||
              memoLoading ||
              memoFailed ||
              (memos.length > 0 && !memoConfirmed) ||
              (overlap && !confirmed)
            }
          >
            신청 + 배부
          </button>
        )}
        <button
          type="submit"
          name="action"
          value="save"
          className={
            sameIssue ? "secondary-button submit" : "primary-button submit"
          }
          data-testid="annual-submit-save"
          disabled={busy || loading || failed || (overlap && !confirmed)}
        >
          신청만 저장
        </button>
      </div>
    </form>
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
