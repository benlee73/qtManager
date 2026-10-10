import { useEffect, useState, type ReactNode } from "react";
import { validateDraftFields, type DraftInput } from "./draftValidation";
import { type Issue } from "./phase2";
import { loadManagement, type PersonSummary } from "./phase3";
import { filterPurchasePeople } from "./purchasePeople";
import { PurchasePersonPicker } from "./PurchasePersonPicker";
import { saveAnnualSubscription } from "./annualRegistration";
import { handlePhoneInput } from "./phone";

export function AnnualSubscriptionForm({
  issue,
  busy,
  mutate,
}: {
  issue: Issue;
  busy: boolean;
  mutate: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PersonSummary | null>(null);
  const [newPerson, setNewPerson] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof DraftInput, string>>
  >({});
  const [overlap, setOverlap] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const matches = filterPurchasePeople(people, query);
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
  const clear = (field: keyof DraftInput) =>
    setErrors((current) => ({ ...current, [field]: undefined }));
  const reset = () => {
    setErrors({});
    setOverlap(false);
    setConfirmed(false);
  };
  return (
    <form
      data-testid="draft-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || loading || failed || (overlap && !confirmed)) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const input = {
          name: query,
          cohort: String(data.get("cohort") ?? ""),
          phone: String(data.get("phone") ?? ""),
          quantity: Number(data.get("quantity")),
          memo: String(data.get("note") ?? ""),
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
        if (selected) {
          void mutate(async () => {
            try {
              await saveAnnualSubscription(
                issue,
                input,
                selected.id,
                confirmed,
              );
            } catch (reason) {
              if (String(reason).includes("겹")) setOverlap(true);
              throw reason;
            }
          }, "기존 신청자에 1년 구독을 추가했습니다.");
        } else {
          void mutate(
            () => saveAnnualSubscription(issue, input, null, false),
            "현장 신청자를 추가했습니다. 목록에서 바로 배부할 수 있습니다.",
          );
        }
      }}
    >
      <p className="dialog-description">
        {issue.year}년 {issue.startMonth}~{issue.startMonth + 1}월호
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
          newPerson={
            newPerson ||
            (!loading &&
              !failed &&
              Boolean(query.trim()) &&
              matches.length === 0)
          }
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
        {!selected && (
          <div className="purchase-new-person-fields">
            <div className="field-grid">
              <Field label="또래">
                <input
                  name="cohort"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{2}"
                  maxLength={2}
                  placeholder="94"
                  aria-invalid={Boolean(errors.cohort)}
                  aria-describedby={
                    errors.cohort ? "draft-cohort-error" : undefined
                  }
                  onInput={(event) => {
                    event.currentTarget.value = event.currentTarget.value
                      .replace(/[^0-9]/g, "")
                      .slice(0, 2);
                    clear("cohort");
                  }}
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
              </Field>
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
      <button
        type="submit"
        className="primary-button submit"
        disabled={busy || loading || failed || (overlap && !confirmed)}
      >
        {busy ? "저장 중…" : "1년 구독 신청"}
      </button>
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
