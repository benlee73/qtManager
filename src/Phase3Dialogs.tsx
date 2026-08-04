import { useEffect, useState, type ReactNode } from "react";

import type { CheckItemView, Issue } from "./phase2";
import {
  type DuplicateCandidate,
  type PersonDetail,
  type PersonInput,
  previewDuplicates,
  registerPerson,
  renewSubscription,
  updatePerson,
} from "./phase3";

type LinkedCheckItemSummary = Pick<CheckItemView, "id" | "summary" | "status"> &
  Partial<Omit<CheckItemView, "id" | "summary" | "status">>;

export function RegisterDialog({
  issue,
  busy,
  onClose,
  onSaved,
}: {
  issue: Issue;
  busy: boolean;
  onClose: () => void;
  onSaved: (work: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const person = personInput(data);
    if (!checked) {
      setChecking(true);
      const found = await previewDuplicates(person);
      setChecking(false);
      if (found.length > 0) {
        setCandidates(found);
        return;
      }
    }
    await onSaved(() =>
      registerPerson(issue, {
        ...person,
        quantity: Number(data.get("quantity")),
        appliedAt: String(data.get("appliedAt") ?? ""),
        memo: String(data.get("memo") ?? ""),
        confirmDuplicate: checked,
      }),
    );
  }

  return (
    <FormDialog title="QT 신청자 정식 등록" onClose={onClose}>
      <form
        data-testid="register-person-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <PersonFields />
        <SubscriptionFields issue={issue} />
        <DuplicateWarning
          candidates={candidates}
          checked={checked}
          onChecked={setChecked}
        />
        <SubmitButton
          busy={busy || checking}
          disabled={candidates.length > 0 && !checked}
        >
          {checking ? "중복 확인 중…" : "신청자와 구독 등록"}
        </SubmitButton>
      </form>
    </FormDialog>
  );
}

export function EditDialog({
  person,
  checkItems,
  busy,
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  checkItems: LinkedCheckItemSummary[];
  busy: boolean;
  onClose: () => void;
  onSaved: (
    work: () => Promise<unknown>,
    input: PersonInput,
  ) => Promise<boolean>;
}) {
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checked, setChecked] = useState(false);

  async function submit(form: HTMLFormElement) {
    const input = personInput(new FormData(form));
    if (!checked) {
      const found = await previewDuplicates(input, person.id);
      if (found.length > 0) {
        setCandidates(found);
        return;
      }
    }
    await onSaved(
      () => updatePerson(person.id, { ...input, confirmDuplicate: checked }),
      input,
    );
  }

  return (
    <FormDialog
      title="QT 신청자 정보 수정"
      className="management-edit-dialog"
      onClose={onClose}
    >
      <form
        data-testid="edit-person-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        {person.status === "정보 보완 필요" && (
          <p className="dialog-description">
            저장하면 간이 등록 상태가 정식 등록으로 바뀝니다.
          </p>
        )}
        <LinkedCheckItems items={checkItems} />
        <PersonFields person={person} />
        <DuplicateWarning
          candidates={candidates}
          checked={checked}
          onChecked={setChecked}
        />
        <SubmitButton busy={busy} disabled={candidates.length > 0 && !checked}>
          정보 저장
        </SubmitButton>
      </form>
    </FormDialog>
  );
}

export function LinkedCheckItems({
  items,
}: {
  items: LinkedCheckItemSummary[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="linked-check-items" aria-label="연결된 확인할 일">
      <h3>연결된 확인할 일</h3>
      <div>
        {items.map((item) => (
          <article
            className={item.status === "확인 완료" ? "checked" : ""}
            key={item.id}
          >
            <span>{item.status}</span>
            <p>{item.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RenewDialog({
  person,
  issue,
  busy,
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  issue: Issue;
  busy: boolean;
  onClose: () => void;
  onSaved: (work: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [overlap, setOverlap] = useState(false);

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const worked = await onSaved(() =>
      renewSubscription(
        person.id,
        {
          year: Number(data.get("issueYear")),
          startMonth: Number(data.get("issueMonth")),
        },
        {
          quantity: Number(data.get("quantity")),
          appliedAt: String(data.get("appliedAt") ?? ""),
          memo: String(data.get("memo") ?? ""),
          confirmOverlap,
        },
      ),
    );
    if (!worked) setOverlap(true);
  }

  return (
    <FormDialog title={`${person.name} · 구독 추가·갱신`} onClose={onClose}>
      <form
        data-testid="renew-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <p className="dialog-description">
          과거 구독은 그대로 보존하고 시작 호부터 연속 6개 호를 추가합니다.
        </p>
        <SubscriptionFields issue={issue} allowIssueChange />
        {overlap && (
          <label className="duplicate-warning">
            <strong>기존 구독과 기간이 겹칠 수 있습니다.</strong>
            <span>정말 두 구독을 모두 유지해야 할 때만 확인하세요.</span>
            <span>
              <input
                type="checkbox"
                checked={confirmOverlap}
                onChange={(event) => setConfirmOverlap(event.target.checked)}
              />{" "}
              겹침을 확인했고 새 구독을 추가합니다
            </span>
          </label>
        )}
        <SubmitButton busy={busy} disabled={overlap && !confirmOverlap}>
          연간 구독 추가
        </SubmitButton>
      </form>
    </FormDialog>
  );
}

function PersonFields({ person }: { person?: PersonDetail }) {
  return (
    <>
      <div className="field-grid">
        <Field label="이름">
          <input name="name" required autoFocus defaultValue={person?.name} />
        </Field>
        <Field label="또래">
          <input
            name="cohort"
            inputMode="numeric"
            pattern="[0-9]{2}"
            maxLength={2}
            placeholder="94"
            defaultValue={person?.cohort ?? ""}
          />
        </Field>
      </div>
      <Field label="연락처">
        <input
          name="phone"
          inputMode="tel"
          placeholder="010-1234-5678"
          defaultValue={person?.phone ?? ""}
        />
      </Field>
      <Field label="신청자 메모">
        <textarea
          name="personNote"
          rows={3}
          placeholder="이 사람에게 계속 적용되는 참고사항"
          defaultValue={person?.personNote ?? ""}
        />
      </Field>
    </>
  );
}

function SubscriptionFields({
  issue,
  allowIssueChange = false,
}: {
  issue: Issue;
  allowIssueChange?: boolean;
}) {
  return (
    <div className="subscription-form-block">
      <h3>연간 구독</h3>
      <div className="field-grid three">
        <Field label="시작 연도">
          <input
            name="issueYear"
            type="number"
            min={2020}
            defaultValue={issue.year}
            readOnly={!allowIssueChange}
            required
          />
        </Field>
        <Field label="시작 호">
          <select
            name="issueMonth"
            defaultValue={issue.startMonth}
            disabled={!allowIssueChange}
          >
            {[1, 3, 5, 7, 9, 11].map((month) => (
              <option key={month} value={month}>
                {month}~{month + 1}월호
              </option>
            ))}
          </select>
          {!allowIssueChange && (
            <input type="hidden" name="issueMonth" value={issue.startMonth} />
          )}
        </Field>
        <Field label="매 호 수량">
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            required
          />
        </Field>
      </div>
      <div className="field-grid">
        <Field label="신청일">
          <input name="appliedAt" type="date" />
        </Field>
        <Field label="구독 메모">
          <input name="memo" placeholder="선택 입력" />
        </Field>
      </div>
    </div>
  );
}

function DuplicateWarning({
  candidates,
  checked,
  onChecked,
}: {
  candidates: DuplicateCandidate[];
  checked: boolean;
  onChecked: (value: boolean) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="duplicate-warning" data-testid="duplicate-warning">
      <strong>같은 사람일 수 있는 신청자가 있습니다.</strong>
      {candidates.map((item) => (
        <span key={item.id}>
          {item.cohort ?? "--"} {item.name} · 전화번호 끝 {item.phone ?? "없음"}{" "}
          · {item.status}
        </span>
      ))}
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />{" "}
        다른 사람임을 확인하고 새로 저장합니다
      </label>
    </div>
  );
}

function FormDialog({
  title,
  className = "",
  children,
  onClose,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`dialog wide ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="management-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="management-dialog-title">{title}</h2>
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
  disabled = false,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className="primary-button submit"
      type="submit"
      disabled={busy || disabled}
    >
      {busy ? "저장 중…" : children}
    </button>
  );
}

function personInput(data: FormData): PersonInput {
  return {
    name: String(data.get("name") ?? ""),
    cohort: String(data.get("cohort") ?? ""),
    phone: String(data.get("phone") ?? ""),
    personNote: String(data.get("personNote") ?? ""),
  };
}
