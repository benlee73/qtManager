import { useCallback, useEffect, useRef, useState } from "react";

import { HelpPanel } from "./HelpPanel";
import { ManagementScreen } from "./ManagementScreen";
import { type Phase2Dialog, Phase2DialogContent } from "./Phase2Dialogs";
import { persistTheme, readStoredTheme, type Theme } from "./appearance";
import {
  type DeskPerson,
  type DistributionDesk,
  type Issue,
  cancelLatestPurchase,
  createCheckItem,
  distribute,
  isTextEntryTarget,
  loadDesk,
  moveIssue,
  recommendedIssue,
  undoDistribution,
  updateCheckItemStatus,
  updatePinnedNote,
} from "./phase2";

export default function App() {
  const [screen, setScreen] = useState<"distribution" | "management">(
    "distribution",
  );
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [helpOpen, setHelpOpen] = useState(false);
  const [issue, setIssue] = useState<Issue>(() => recommendedIssue());
  const [query, setQuery] = useState("");
  const [desk, setDesk] = useState<DistributionDesk | null>(null);
  const [selected, setSelected] = useState(0);
  const [dialog, setDialog] = useState<Phase2Dialog>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quickItem, setQuickItem] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const quickItemRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

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
      } else if (event.key === "?" && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        setHelpOpen(true);
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
        quickItemRef.current?.focus();
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

  if (screen === "management") {
    return (
      <div className="fixed-app">
        <TopNavigation
          active="management"
          operator={desk?.operatorName}
          theme={theme}
          onDistribution={() => setScreen("distribution")}
          onManagement={() => undefined}
          onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          onHelp={() => setHelpOpen(true)}
          onOperator={() => setDialog({ type: "operator" })}
        />
        <div className="management-host">
          <ManagementScreen issue={issue} />
        </div>
        {helpOpen && (
          <HelpPanel topic="people" onClose={() => setHelpOpen(false)} />
        )}
        {dialog && (
          <Phase2DialogContent
            dialog={dialog}
            issue={issue}
            busy={busy}
            onClose={() => desk?.operatorName && setDialog(null)}
            mutate={mutate}
          />
        )}
      </div>
    );
  }

  const submitQuickItem = () => {
    if (!quickItem.trim()) return;
    void mutate(
      () => createCheckItem(null, quickItem),
      "일반 확인할 일을 추가했습니다.",
    ).then(() => {
      setQuickItem("");
      quickItemRef.current?.focus();
    });
  };

  return (
    <div className="fixed-app">
      <TopNavigation
        active="distribution"
        operator={desk?.operatorName}
        theme={theme}
        onDistribution={() => undefined}
        onManagement={() => setScreen("management")}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onHelp={() => setHelpOpen(true)}
        onOperator={() => setDialog({ type: "operator" })}
      />

      <main className="desk">
        <header className="desk-header">
          <div className="issue-picker">
            <p>현장 배부</p>
            <div>
              <button
                type="button"
                aria-label="이전 호"
                onClick={() => setIssue((current) => moveIssue(current, -1))}
              >
                ‹
              </button>
              <h1 data-testid="selected-issue">
                {desk?.selectedIssue.label ??
                  `${issue.year}년 ${issue.startMonth}~${issue.startMonth + 1}월호`}
              </h1>
              <button
                type="button"
                aria-label="다음 호"
                onClick={() => setIssue((current) => moveIssue(current, 1))}
              >
                ›
              </button>
            </div>
          </div>
          <section className="summary-grid" aria-label="배부 현황">
            <Summary
              label="대상"
              value={`${desk?.totals.targetPeople ?? 0}명`}
            />
            <Summary
              label="완료"
              value={`${desk?.totals.completedPeople ?? 0}명`}
            />
            <Summary
              label="남음"
              value={`${desk?.totals.remainingPeople ?? 0}명`}
              warning
            />
            <Summary
              label="배부"
              value={`${desk?.totals.distributedQuantity ?? 0}/${desk?.totals.targetQuantity ?? 0}권`}
            />
          </section>
          <button
            className="undo-icon"
            type="button"
            aria-label="마지막 배부 되돌리기"
            title="마지막 배부 되돌리기"
            disabled={!desk?.canUndoDistribution || busy}
            onClick={() =>
              void mutate(
                () => undoDistribution(issue),
                "최근 배부를 되돌렸습니다.",
              )
            }
          >
            ↶
          </button>
        </header>

        <div className="workspace">
          <section className="distribution-table">
            <div className="table-toolbar">
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  data-testid="people-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="또래, 이름 또는 전화번호 검색"
                  aria-label="QT 신청자 검색"
                />
                <kbd>/</kbd>
              </label>
              <button
                className="secondary-button"
                data-testid="open-draft"
                type="button"
                onClick={() => setDialog({ type: "draft" })}
              >
                + 현장 간이 등록
              </button>
              <details className="more-menu">
                <summary aria-label="기타 기능">•••</summary>
                <div>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: "purchase" })}
                  >
                    현장 개별 구매
                  </button>
                  {(desk?.purchaseCount ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        void mutate(
                          () => cancelLatestPurchase(issue),
                          "최근 개별 구매를 취소했습니다.",
                        )
                      }
                    >
                      최근 구매 취소
                    </button>
                  )}
                </div>
              </details>
            </div>
            <div className="table-title">
              <h2>
                {query ? "검색 결과" : "남은 신청자"}{" "}
                <b>{desk?.people.length ?? 0}</b>
              </h2>
              <span>미배부·일부 배부</span>
            </div>
            <div className="table-head" aria-hidden="true">
              <span>또래</span>
              <span>신청자</span>
              <span>전화번호</span>
              <span>구독</span>
              <span>배부</span>
              <span />
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
                  onCheckItem={() =>
                    setDialog({
                      type: "check-item",
                      personId: person.personId,
                    })
                  }
                />
              ))}
              {desk && desk.people.length === 0 && (
                <div className="empty-state" data-testid="empty-list">
                  <strong>
                    {query
                      ? "일치하는 신청자가 없습니다"
                      : "이번 호의 남은 배부가 없습니다"}
                  </strong>
                  <span>
                    {query
                      ? "검색어를 확인하거나 현장 간이 등록을 이용하세요."
                      : "검색하면 완료자와 만료자도 확인할 수 있습니다."}
                  </span>
                </div>
              )}
            </div>
          </section>

          <aside className="notes-panel">
            <header>
              <div>
                <p>현장 배부</p>
                <h2>확인할 일</h2>
              </div>
              <span className="count-badge">
                {desk?.checkItems.filter((item) => item.status === "확인 필요")
                  .length ?? 0}
              </span>
            </header>
            <form
              className="sticky-input"
              onSubmit={(event) => {
                event.preventDefault();
                submitQuickItem();
              }}
            >
              <label htmlFor="quick-item">빠른 확인할 일</label>
              <textarea
                id="quick-item"
                ref={quickItemRef}
                autoFocus
                value={quickItem}
                onChange={(event) => setQuickItem(event.target.value)}
                placeholder="신청자 연결 없이 바로 입력하세요…"
              />
              <div>
                <small>일반 항목으로 저장</small>
                <button
                  type="submit"
                  data-testid="add-general-check-item"
                  disabled={busy || !quickItem.trim()}
                >
                  추가
                </button>
              </div>
            </form>
            <div className="check-item-list">
              {desk?.checkItems.map((item) => (
                <article className="check-item" key={item.id}>
                  <p title={item.summary}>{item.summary}</p>
                  <div>
                    <small>
                      <b>
                        {item.personName ? `${item.personName} 연결` : "일반"}
                      </b>
                      {" · "}
                      {item.status}
                    </small>
                    {item.status === "확인 필요" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void mutate(
                            () => updateCheckItemStatus(item.id, "checked"),
                            "확인할 일을 완료했습니다.",
                          )
                        }
                      >
                        확인 완료
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void mutate(
                            () => updateCheckItemStatus(item.id, "needs_check"),
                            "확인 필요 상태로 되돌렸습니다.",
                          )
                        }
                      >
                        다시 확인
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="확인할 일 보관"
                      onClick={() =>
                        void mutate(
                          () => updateCheckItemStatus(item.id, "archived"),
                          "확인할 일을 보관했습니다.",
                        )
                      }
                    >
                      보관
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <section className="pinned-section">
              <div className="pinned-heading">
                <h3>고정 메모</h3>
                <button
                  type="button"
                  aria-label="고정 메모 추가"
                  onClick={() => setDialog({ type: "pinned-note" })}
                >
                  +
                </button>
              </div>
              <div className="pinned-list">
                {desk?.pinnedNotes.map((note) => (
                  <article className="pinned-note" key={note.id}>
                    <div>
                      <span>{note.isPinned ? "● 고정" : "고정 해제됨"}</span>
                      <details className="more-menu note-menu">
                        <summary aria-label="고정 메모 메뉴">•••</summary>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              void mutate(
                                () =>
                                  updatePinnedNote(note.id, {
                                    isPinned: !note.isPinned,
                                  }),
                                note.isPinned
                                  ? "상단 고정을 해제했습니다."
                                  : "메모를 상단에 고정했습니다.",
                              )
                            }
                          >
                            {note.isPinned ? "고정 해제" : "상단 고정"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void mutate(
                                () =>
                                  updatePinnedNote(note.id, { archived: true }),
                                "고정 메모를 보관했습니다.",
                              )
                            }
                          >
                            보관
                          </button>
                        </div>
                      </details>
                    </div>
                    <p title={note.title}>{note.title}</p>
                    <b title={note.content}>{note.content}</b>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

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
        <Phase2DialogContent
          dialog={dialog}
          issue={issue}
          busy={busy}
          onClose={() => desk?.operatorName && setDialog(null)}
          mutate={mutate}
        />
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function TopNavigation({
  active,
  operator,
  theme,
  onDistribution,
  onManagement,
  onTheme,
  onHelp,
  onOperator,
}: {
  active: "distribution" | "management";
  operator?: string | null;
  theme: Theme;
  onDistribution: () => void;
  onManagement: () => void;
  onTheme: () => void;
  onHelp: () => void;
  onOperator: () => void;
}) {
  return (
    <nav className="topnav">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          QT
        </span>
        <div>
          <b>QT Manager</b>
          <small>
            맑은샘광천교회 청년부{" "}
            <i title="2026 교육국 제작" aria-label="2026 교육국 제작">
              ⓘ
            </i>
          </small>
        </div>
      </div>
      <div className="main-menu">
        <button
          className={active === "distribution" ? "active" : ""}
          type="button"
          onClick={onDistribution}
        >
          현장 배부
        </button>
        <button
          className={active === "management" ? "active" : ""}
          type="button"
          data-testid="open-management"
          onClick={onManagement}
        >
          신청자 관리 <small>⌄</small>
        </button>
      </div>
      <div className="nav-tools">
        <button className="icon-button" type="button" onClick={onHelp}>
          ?
        </button>
        <button
          className="theme-button"
          type="button"
          data-testid="theme-toggle"
          aria-label="테마 전환"
          onClick={onTheme}
        >
          <span>{theme === "dark" ? "☾" : "☀"}</span>
          {theme === "dark" ? "다크" : "라이트"}
        </button>
        <button className="operator-button" type="button" onClick={onOperator}>
          <span aria-hidden="true" />
          <b>{operator ?? "담당자 설정"}</b>
          <small>⌄</small>
        </button>
      </div>
    </nav>
  );
}

function Summary({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className={warning ? "warning" : ""}>
      <span>{label}</span>
      <b>{value}</b>
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
  onCheckItem,
}: {
  person: DeskPerson;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDistribute: () => void;
  onPartial: () => void;
  onCheckItem: () => void;
}) {
  return (
    <article
      className={`person-row ${selected ? "selected" : ""}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onCheckItem();
      }}
      data-testid="person-row"
    >
      <span className="cohort">{person.cohort ?? "--"}</span>
      <div className="person-name">
        <b title={person.name}>{person.name}</b>
        {person.hasCheckItem && <small>확인할 일 있음</small>}
      </div>
      <span className="phone" title={person.phone ?? "연락처 없음"}>
        {person.phone ?? "연락처 없음"}
      </span>
      <div className={`subscription ${statusClass(person.subscriptionStatus)}`}>
        <b>
          ● {person.isLastIssue ? "이번 호 마지막" : person.subscriptionStatus}
        </b>
        <small>
          {person.endDate
            ? `${person.endDate}${person.subscriptionStatus === "구독 만료" ? " 종료" : "까지"}`
            : "등록된 구독 없음"}
        </small>
      </div>
      <div className="distribution-cell">
        <b>{person.distributionStatus}</b>
        <small>
          {person.targetQuantity
            ? `${person.distributedQuantity} / ${person.targetQuantity}권`
            : "—"}
        </small>
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
            : person.subscriptionStatus === "구독 만료"
              ? "구독 갱신"
              : person.distributionStatus}
        </button>
        <details className="more-menu row-menu">
          <summary
            aria-label={`${person.name} 메뉴`}
            onClick={(event) => event.stopPropagation()}
          >
            •••
          </summary>
          <div>
            <button type="button" onClick={onCheckItem}>
              확인할 일 추가
            </button>
            {person.canDistribute && person.remainingQuantity > 1 && (
              <button type="button" onClick={onPartial}>
                일부만 배부
              </button>
            )}
          </div>
        </details>
      </div>
    </article>
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
