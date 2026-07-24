import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type DeskPerson,
  type DistributionDesk,
  type Issue,
  cancelLatestPurchase,
  completeQuickNote,
  createDraft,
  createOperationalNote,
  createQuickNote,
  distribute,
  isTextEntryTarget,
  loadDesk,
  moveIssue,
  recommendedIssue,
  recordPurchase,
  setOperator,
  undoDistribution,
} from "./phase2";

type Dialog =
  | { type: "operator" }
  | { type: "draft" }
  | { type: "quick-note"; personId: string | null }
  | { type: "operational-note" }
  | { type: "purchase" }
  | { type: "partial"; person: DeskPerson }
  | null;

export default function App() {
  const [issue, setIssue] = useState<Issue>(() => recommendedIssue());
  const [query, setQuery] = useState("");
  const [desk, setDesk] = useState<DistributionDesk | null>(null);
  const [selected, setSelected] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadDesk(issue, query);
      setDesk(next);
      setSelected((current) =>
        Math.min(current, Math.max(next.people.length - 1, 0)),
      );
      if (!next.operatorName) setDialog({ type: "operator" });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [issue, query]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const mutate = useCallback(
    async (work: () => Promise<void>, success: string) => {
      setBusy(true);
      setError("");
      try {
        await work();
        setDialog(null);
        setNotice(success);
        await refresh();
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const defaultDistribution = useCallback(
    async (person: DeskPerson) => {
      if (!person.subscriptionId || !person.canDistribute) return;
      await mutate(
        () => distribute(issue, person.subscriptionId!),
        `${person.name} · ${person.remainingQuantity}권 배부했습니다.`,
      );
    },
    [issue, mutate],
  );

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;
      if (event.key === "/" && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (modified && event.key === "Enter") {
        event.preventDefault();
        const person = desk?.people[selected];
        if (person) void defaultDistribution(person);
      } else if (modified && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog({ type: "draft" });
      } else if (
        modified &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        setDialog({ type: "quick-note", personId: null });
      } else if (modified && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (desk?.canUndoDistribution) {
          void mutate(
            () => undoDistribution(issue),
            "최근 배부를 되돌렸습니다.",
          );
        }
      } else if (
        !isTextEntryTarget(event.target) &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        setSelected((current) =>
          event.key === "ArrowDown"
            ? Math.min(current + 1, Math.max((desk?.people.length ?? 1) - 1, 0))
            : Math.max(current - 1, 0),
        );
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [defaultDistribution, desk, issue, mutate, selected]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <div>
            <p>맑은샘광천교회 청년부</p>
            <h1>QT 배부</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={() => setDialog({ type: "purchase" })}
          >
            더보기 · 개별 구매
          </button>
          <button
            className="quiet-button"
            type="button"
            onClick={() => setDialog({ type: "operator" })}
          >
            담당자 {desk?.operatorName ?? "설정"}
          </button>
        </div>
      </header>

      <section className="issue-toolbar" aria-label="QT 호 선택">
        <button
          className="icon-button"
          type="button"
          aria-label="이전 호"
          onClick={() => setIssue((current) => moveIssue(current, -1))}
        >
          ←
        </button>
        <div>
          <p className="section-label">현재 배부 호</p>
          <h2 data-testid="selected-issue">
            {desk?.selectedIssue.label ??
              `${issue.year}년 ${issue.startMonth}~${issue.startMonth + 1}월호`}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="다음 호"
          onClick={() => setIssue((current) => moveIssue(current, 1))}
        >
          →
        </button>
        {desk &&
          (desk.recommendedIssue.year !== issue.year ||
            desk.recommendedIssue.startMonth !== issue.startMonth) && (
            <button
              className="recommend-button"
              type="button"
              onClick={() =>
                setIssue({
                  year: desk.recommendedIssue.year,
                  startMonth: desk.recommendedIssue.startMonth,
                })
              }
            >
              권장 호 {desk.recommendedIssue.label}
            </button>
          )}
      </section>

      <section className="stats" aria-label="배부 현황">
        <Stat
          label="총 대상"
          value={desk?.totals.targetPeople ?? 0}
          unit="명"
        />
        <Stat
          label="배부 완료"
          value={desk?.totals.completedPeople ?? 0}
          unit="명"
          tone="success"
        />
        <Stat
          label="남은 인원"
          value={desk?.totals.remainingPeople ?? 0}
          unit="명"
          tone="accent"
        />
        <div className="book-stat">
          권수 {desk?.totals.distributedQuantity ?? 0}/
          {desk?.totals.targetQuantity ?? 0} · 남은{" "}
          {desk?.totals.remainingQuantity ?? 0}권
        </div>
      </section>

      {desk && desk.operationalNotes.length > 0 && (
        <section className="operation-banner" aria-label="운영 메모">
          <span aria-hidden="true">📌</span>
          <div>
            <strong>{desk.operationalNotes[0].title}</strong>
            <p>{desk.operationalNotes[0].content}</p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => setDialog({ type: "operational-note" })}
          >
            운영 메모 추가
          </button>
        </section>
      )}

      <section className="work-area">
        <div className="distribution-panel">
          <div className="search-row">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                data-testid="people-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="또래, 이름 또는 전화번호 검색   /"
                aria-label="QT 신청자 검색"
              />
              {query && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
            </label>
            <button
              className="undo-button"
              type="button"
              disabled={!desk?.canUndoDistribution || busy}
              onClick={() =>
                void mutate(
                  () => undoDistribution(issue),
                  "최근 배부를 되돌렸습니다.",
                )
              }
            >
              ↶ 되돌리기
              <kbd>⌘/Ctrl Z</kbd>
            </button>
          </div>

          <div className="list-heading">
            <div>
              <h3>{query ? "검색 결과" : "아직 배부하지 않은 신청자"}</h3>
              <p>
                {desk?.people.length ?? 0}명 · 행을 선택하고 ⌘/Ctrl+Enter로 배부
              </p>
            </div>
            <button
              className="secondary-button"
              data-testid="open-draft"
              type="button"
              onClick={() => setDialog({ type: "draft" })}
            >
              + 현장 간이 등록
            </button>
          </div>

          <div className="person-list" role="listbox" aria-label="QT 신청자">
            {desk?.people.map((person, index) => (
              <PersonRow
                key={`${person.personId}-${person.subscriptionId ?? "none"}`}
                person={person}
                selected={selected === index}
                busy={busy}
                onSelect={() => setSelected(index)}
                onDistribute={() => void defaultDistribution(person)}
                onPartial={() => setDialog({ type: "partial", person })}
                onNote={() =>
                  setDialog({ type: "quick-note", personId: person.personId })
                }
              />
            ))}
            {desk && desk.people.length === 0 && (
              <div className="empty-state" data-testid="empty-list">
                <span aria-hidden="true">{query ? "⌕" : "✓"}</span>
                <h3>
                  {query
                    ? "일치하는 신청자가 없습니다"
                    : "이번 호의 남은 배부가 없습니다"}
                </h3>
                <p>
                  {query
                    ? "이름이나 또래를 다시 확인하거나 현장에서 간이 등록하세요."
                    : "검색하면 배부 완료자와 만료자도 확인할 수 있습니다."}
                </p>
                {query && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setDialog({ type: "draft" })}
                  >
                    현장 간이 등록
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="notes-panel">
          <div className="aside-heading">
            <div>
              <p className="section-label">바로 확인할 일</p>
              <h3>현장 기록</h3>
            </div>
            <button
              className="icon-button small"
              type="button"
              aria-label="현장 기록 추가"
              onClick={() => setDialog({ type: "quick-note", personId: null })}
            >
              +
            </button>
          </div>
          <div className="quick-notes">
            {desk?.quickNotes.map((note) => (
              <article key={note.id} className="quick-note">
                <p>{note.summary}</p>
                <div>
                  <span>{note.operatorName}</span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      void mutate(
                        () => completeQuickNote(note.id),
                        "현장 기록을 완료했습니다.",
                      )
                    }
                  >
                    완료
                  </button>
                </div>
              </article>
            ))}
            {desk?.quickNotes.length === 0 && (
              <p className="aside-empty">미완료 현장 기록이 없습니다.</p>
            )}
          </div>
          <button
            className="aside-link"
            type="button"
            onClick={() => setDialog({ type: "operational-note" })}
          >
            📌 장기 운영 메모 추가
          </button>
          <div className="purchase-summary">
            <div>
              <span>개별 구매</span>
              <strong>
                {desk?.purchaseCount ?? 0}건 · {desk?.purchasedQuantity ?? 0}권
              </strong>
            </div>
            {(desk?.purchaseCount ?? 0) > 0 && (
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  void mutate(
                    () => cancelLatestPurchase(issue),
                    "최근 개별 구매를 취소했습니다.",
                  )
                }
              >
                최근 건 취소
              </button>
            )}
          </div>
        </aside>
      </section>

      {(notice || error) && (
        <div
          className={`toast ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => {
              setNotice("");
              setError("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {dialog && (
        <DialogContent
          dialog={dialog}
          issue={issue}
          busy={busy}
          onClose={() => desk?.operatorName && setDialog(null)}
          mutate={mutate}
        />
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "",
}: {
  label: string;
  value: number;
  unit: string;
  tone?: string;
}) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function PersonRow({
  person,
  selected,
  busy,
  onSelect,
  onDistribute,
  onPartial,
  onNote,
}: {
  person: DeskPerson;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDistribute: () => void;
  onPartial: () => void;
  onNote: () => void;
}) {
  return (
    <article
      className={`person-row ${selected ? "selected" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      data-testid="person-row"
    >
      <div className="identity">
        <span className="cohort">{person.cohort ?? "--"}</span>
        <div>
          <h4>{person.name}</h4>
          <p>
            {person.phoneSuffix
              ? `전화번호 끝 ${person.phoneSuffix}`
              : "연락처 없음"}
            {person.personStatus === "정보 보완 필요" && (
              <em> · 정보 보완 필요</em>
            )}
          </p>
        </div>
      </div>
      <div className="status-stack">
        <span className={`status ${statusClass(person.subscriptionStatus)}`}>
          {person.subscriptionStatus}
        </span>
        <span>{person.distributionStatus}</span>
      </div>
      <div className="subscription-detail">
        {person.lastIssue ? (
          <>
            <span>구독 종료 {person.endDate}</span>
            <span>
              {person.distributedQuantity}/{person.targetQuantity}권 배부
            </span>
            {person.isLastIssue && (
              <strong>이번 호가 마지막 · 다음 호부터 갱신 필요</strong>
            )}
          </>
        ) : (
          <span>등록된 구독 없음</span>
        )}
        {person.hasOpenQuickNote && <strong>● 현장 기록 있음</strong>}
      </div>
      <div className="row-actions">
        <button
          className="primary-button"
          data-testid="distribute"
          type="button"
          disabled={!person.canDistribute || busy}
          onClick={(event) => {
            event.stopPropagation();
            onDistribute();
          }}
        >
          {person.canDistribute
            ? `${person.remainingQuantity}권 배부`
            : person.distributionStatus}
        </button>
        {person.canDistribute && person.remainingQuantity > 1 && (
          <button
            className="text-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPartial();
            }}
          >
            일부만
          </button>
        )}
        <button
          className="text-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNote();
          }}
        >
          기록
        </button>
      </div>
    </article>
  );
}

function DialogContent({
  dialog,
  issue,
  busy,
  onClose,
  mutate,
}: {
  dialog: Exclude<Dialog, null>;
  issue: Issue;
  busy: boolean;
  onClose: () => void;
  mutate: (work: () => Promise<void>, success: string) => Promise<void>;
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
  if (dialog.type === "quick-note") {
    return (
      <FormDialog title="현장 기록 추가" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate(
              () =>
                createQuickNote(
                  dialog.personId,
                  String(data.get("content") ?? ""),
                ),
              "현장 기록을 저장했습니다.",
            );
          }}
        >
          <p className="dialog-description">
            신청 누락 확인처럼 곧 처리할 일을 적습니다. 완료하기 전까지 기본
            화면에 남습니다.
          </p>
          <Field label="기록 내용">
            <textarea name="content" required autoFocus rows={5} />
          </Field>
          <SubmitButton busy={busy}>현장 기록 저장</SubmitButton>
        </form>
      </FormDialog>
    );
  }
  if (dialog.type === "operational-note") {
    return (
      <FormDialog title="장기 운영 메모" onClose={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate(
              () =>
                createOperationalNote({
                  title: String(data.get("title") ?? ""),
                  content: String(data.get("content") ?? ""),
                  activeUntil: String(data.get("activeUntil") ?? ""),
                  isPinned: data.get("isPinned") === "on",
                }),
              "운영 메모를 저장했습니다.",
            );
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
          <Field label="표시 종료일">
            <input name="activeUntil" type="date" />
          </Field>
          <label className="check-field">
            <input name="isPinned" type="checkbox" defaultChecked /> 기본 화면에
            고정
          </label>
          <SubmitButton busy={busy}>운영 메모 저장</SubmitButton>
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

function statusClass(status: string) {
  if (status === "유효") return "valid";
  if (status === "구독 만료") return "expired";
  if (status === "확인 필요") return "review";
  return "";
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
