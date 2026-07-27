import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionMenu } from "./ActionMenu";
import { ArchiveDialog } from "./ArchiveDialog";
import { HelpPanel } from "./HelpPanel";
import {
  BookLogo,
  ChevronLeftIcon,
  ChevronRightIcon,
  RedoIcon,
  UndoIcon,
} from "./Icons";
import { ManagementScreen } from "./ManagementScreen";
import { NotificationStack } from "./Notifications";
import { type Phase2Dialog, Phase2DialogContent } from "./Phase2Dialogs";
import type { ReversibleAction } from "./actionHistory";
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
import { useNotifications } from "./useNotifications";

export default function App() {
  const [screen, setScreen] = useState<"distribution" | "management">(
    "distribution",
  );
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [helpOpen, setHelpOpen] = useState(false);
  const [issue, setIssue] = useState<Issue>(() => recommendedIssue());
  const [query, setQuery] = useState("");
  const [desk, setDesk] = useState<DistributionDesk | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dialog, setDialog] = useState<Phase2Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [quickItem, setQuickItem] = useState("");
  const [undoStack, setUndoStack] = useState<ReversibleAction[]>([]);
  const [redoStack, setRedoStack] = useState<ReversibleAction[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickItemRef = useRef<HTMLTextAreaElement>(null);
  const { notifications, notify, dismiss } = useNotifications();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadDesk(issue, query, showAll);
      setDesk(next);
      setSelectedPersonId((current) =>
        current && next.people.some((person) => person.personId === current)
          ? current
          : null,
      );
      if (!next.operatorName) setDialog({ type: "operator" });
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  }, [issue, notify, query, showAll]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const mutate = useCallback(
    async (work: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await work();
        setDialog(null);
        notify(success);
        await refresh();
        return true;
      } catch (reason) {
        notify(errorMessage(reason), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify, refresh],
  );

  const recordAction = useCallback((action: ReversibleAction) => {
    setUndoStack((current) => [...current, action]);
    setRedoStack([]);
  }, []);

  const undoAction = useCallback(async () => {
    const action = undoStack.at(-1);
    if (!action) {
      if (desk?.canUndoDistribution) {
        await mutate(
          () => undoDistribution(issue),
          "최근 배부를 되돌렸습니다.",
        );
      }
      return;
    }
    if (await mutate(action.undo, `${action.description}: 되돌렸습니다.`)) {
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, action]);
    }
  }, [desk?.canUndoDistribution, issue, mutate, undoStack]);

  const redoAction = useCallback(async () => {
    const action = redoStack.at(-1);
    if (!action) return;
    if (
      await mutate(action.redo, `${action.description}: 다시 실행했습니다.`)
    ) {
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, action]);
    }
  }, [mutate, redoStack]);

  const visiblePeople = useMemo(() => {
    if (!desk || statusFilter === "all") return desk?.people ?? [];
    return desk.people.filter((person) => {
      if (statusFilter === "undistributed")
        return person.distributionStatus === "미배부";
      if (statusFilter === "partial")
        return person.distributionStatus === "일부 배부";
      if (statusFilter === "completed")
        return person.distributionStatus === "배부 완료";
      return person.subscriptionStatus === "구독 만료";
    });
  }, [desk, statusFilter]);

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
        const person = visiblePeople.find(
          (candidate) => candidate.personId === selectedPersonId,
        );
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
        if (event.shiftKey) void redoAction();
        else void undoAction();
      } else if (
        !isTextEntryTarget(event.target) &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        const current = visiblePeople.findIndex(
          (person) => person.personId === selectedPersonId,
        );
        const next =
          event.key === "ArrowDown"
            ? Math.min(current + 1, Math.max(visiblePeople.length - 1, 0))
            : Math.max(current < 0 ? 0 : current - 1, 0);
        setSelectedPersonId(visiblePeople[next]?.personId ?? null);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    defaultDistribution,
    redoAction,
    selectedPersonId,
    undoAction,
    visiblePeople,
  ]);

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
          <ManagementScreen issue={issue} notify={notify} />
        </div>
        <NotificationStack notifications={notifications} onDismiss={dismiss} />
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
            recordAction={recordAction}
          />
        )}
      </div>
    );
  }

  const submitQuickItem = () => {
    if (!quickItem.trim()) return;
    let createdId = "";
    void mutate(async () => {
      createdId = await createCheckItem(null, quickItem);
    }, "일반 확인할 일을 추가했습니다.").then((saved) => {
      if (saved) {
        recordAction({
          description: "확인할 일 추가",
          undo: () => updateCheckItemStatus(createdId, "archived"),
          redo: () => updateCheckItemStatus(createdId, "needs_check"),
        });
        setQuickItem("");
        quickItemRef.current?.focus();
      }
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

      <main
        className="desk"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest(
              "button, input, textarea, select, a, [role='option'], .more-menu",
            )
          ) {
            setSelectedPersonId(null);
          }
        }}
      >
        <header className="desk-header">
          <div className="issue-picker">
            <div>
              <button
                type="button"
                aria-label="이전 호"
                onClick={() => setIssue((current) => moveIssue(current, -1))}
              >
                <ChevronLeftIcon />
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
                <ChevronRightIcon />
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
          <div className="history-buttons">
            <button
              className="undo-icon"
              type="button"
              aria-label="마지막 동작 되돌리기"
              title={
                undoStack.at(-1)?.description ??
                (desk?.canUndoDistribution
                  ? "마지막 배부 되돌리기"
                  : "되돌릴 동작 없음")
              }
              disabled={
                (undoStack.length === 0 && !desk?.canUndoDistribution) || busy
              }
              onClick={() => void undoAction()}
            >
              <UndoIcon />
            </button>
            <button
              className="undo-icon"
              type="button"
              aria-label="되돌린 동작 다시 실행"
              title={redoStack.at(-1)?.description ?? "다시 실행할 동작 없음"}
              disabled={redoStack.length === 0 || busy}
              onClick={() => void redoAction()}
            >
              <RedoIcon />
            </button>
          </div>
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
              <ActionMenu
                id="desk-more"
                label="기타 기능"
                openMenu={openMenu}
                onOpenMenu={setOpenMenu}
              >
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
              </ActionMenu>
            </div>
            <div className="table-title">
              <h2>
                {query ? "검색 결과" : showAll ? "전체 신청자" : "남은 신청자"}{" "}
                <b>{visiblePeople.length}</b>
              </h2>
              <div className="list-filters">
                <div className="view-toggle" aria-label="신청자 보기 범위">
                  <button
                    className={!showAll ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setShowAll(false);
                      setStatusFilter("all");
                    }}
                  >
                    남은 배부
                  </button>
                  <button
                    className={showAll ? "active" : ""}
                    type="button"
                    onClick={() => setShowAll(true)}
                  >
                    전체
                  </button>
                </div>
                {showAll && (
                  <select
                    aria-label="상태 필터"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">모든 상태</option>
                    <option value="undistributed">미배부</option>
                    <option value="partial">일부 배부</option>
                    <option value="completed">배부 완료</option>
                    <option value="expired">구독 만료</option>
                  </select>
                )}
              </div>
            </div>
            <div className="table-head" aria-hidden="true">
              <span>또래</span>
              <span>신청자</span>
              <span>전화번호</span>
              <span>구독</span>
              <span>배부</span>
              <span />
            </div>
            <div
              className="person-list"
              role="listbox"
              aria-label="QT 신청자"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  setSelectedPersonId(null);
              }}
            >
              {visiblePeople.map((person) => (
                <PersonRow
                  key={`${person.personId}-${person.subscriptionId ?? "none"}`}
                  person={person}
                  selected={selectedPersonId === person.personId}
                  busy={busy}
                  openMenu={openMenu}
                  onOpenMenu={setOpenMenu}
                  onSelect={() =>
                    setSelectedPersonId((current) =>
                      current === person.personId ? null : person.personId,
                    )
                  }
                  onDistribute={() => void defaultDistribution(person)}
                  onCancelDistribution={() =>
                    setDialog({ type: "cancel-distribution", person })
                  }
                  onPartial={() => setDialog({ type: "partial", person })}
                  onCheckItem={() =>
                    setDialog({
                      type: "check-item",
                      personId: person.personId,
                    })
                  }
                />
              ))}
              {desk && visiblePeople.length === 0 && (
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
                <h2>확인할 일</h2>
              </div>
              <div>
                <button
                  className="archive-button"
                  type="button"
                  onClick={() => setArchiveOpen(true)}
                >
                  보관함
                </button>
                <span className="count-badge">
                  {desk?.checkItems.filter(
                    (item) => item.status === "확인 필요",
                  ).length ?? 0}
                </span>
              </div>
            </header>
            <form
              className="sticky-input"
              onSubmit={(event) => {
                event.preventDefault();
                submitQuickItem();
              }}
            >
              <label className="sr-only" htmlFor="quick-item">
                새 확인할 일
              </label>
              <textarea
                id="quick-item"
                ref={quickItemRef}
                autoFocus
                value={quickItem}
                onChange={(event) => setQuickItem(event.target.value)}
                placeholder="확인할 내용을 입력하세요…"
              />
              <div>
                <small>일반 확인할 일로 저장</small>
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
                <article
                  className={`check-item ${item.status === "확인 완료" ? "checked" : ""}`}
                  key={item.id}
                >
                  <label className="check-item-main">
                    <input
                      type="checkbox"
                      checked={item.status === "확인 완료"}
                      aria-label={`${item.summary} 확인 완료`}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        void mutate(
                          () =>
                            updateCheckItemStatus(
                              item.id,
                              checked ? "checked" : "needs_check",
                            ),
                          checked
                            ? "확인할 일을 완료했습니다."
                            : "확인할 일을 다시 확인하도록 바꿨습니다.",
                        ).then((saved) => {
                          if (saved) {
                            recordAction({
                              description: checked
                                ? "확인할 일 완료"
                                : "확인할 일 다시 열기",
                              undo: () =>
                                updateCheckItemStatus(
                                  item.id,
                                  checked ? "needs_check" : "checked",
                                ),
                              redo: () =>
                                updateCheckItemStatus(
                                  item.id,
                                  checked ? "checked" : "needs_check",
                                ),
                            });
                          }
                        });
                      }}
                    />
                    <p title={item.summary}>{item.summary}</p>
                  </label>
                  <div>
                    <small>
                      <b>
                        {item.personName ? `${item.personName} 연결` : "일반"}
                      </b>
                    </small>
                    <button
                      type="button"
                      aria-label="확인할 일 보관"
                      onClick={() => {
                        const previous =
                          item.status === "확인 완료"
                            ? "checked"
                            : "needs_check";
                        void mutate(
                          () => updateCheckItemStatus(item.id, "archived"),
                          "확인할 일을 보관했습니다.",
                        ).then((saved) => {
                          if (saved) {
                            recordAction({
                              description: "확인할 일 보관",
                              undo: () =>
                                updateCheckItemStatus(item.id, previous),
                              redo: () =>
                                updateCheckItemStatus(item.id, "archived"),
                            });
                          }
                        });
                      }}
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
                      <ActionMenu
                        id={`pinned-${note.id}`}
                        label="고정 메모 메뉴"
                        openMenu={openMenu}
                        onOpenMenu={setOpenMenu}
                        className="note-menu"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const nextPinned = !note.isPinned;
                            void mutate(
                              () =>
                                updatePinnedNote(note.id, {
                                  isPinned: nextPinned,
                                }),
                              note.isPinned
                                ? "상단 고정을 해제했습니다."
                                : "메모를 상단에 고정했습니다.",
                            ).then((saved) => {
                              if (saved) {
                                recordAction({
                                  description: nextPinned
                                    ? "고정 메모 상단 고정"
                                    : "고정 메모 고정 해제",
                                  undo: () =>
                                    updatePinnedNote(note.id, {
                                      isPinned: !nextPinned,
                                    }),
                                  redo: () =>
                                    updatePinnedNote(note.id, {
                                      isPinned: nextPinned,
                                    }),
                                });
                              }
                            });
                          }}
                        >
                          {note.isPinned ? "고정 해제" : "상단 고정"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void mutate(
                              () =>
                                updatePinnedNote(note.id, { archived: true }),
                              "고정 메모를 보관했습니다.",
                            ).then((saved) => {
                              if (saved) {
                                recordAction({
                                  description: "고정 메모 보관",
                                  undo: () =>
                                    updatePinnedNote(note.id, {
                                      archived: false,
                                    }),
                                  redo: () =>
                                    updatePinnedNote(note.id, {
                                      archived: true,
                                    }),
                                });
                              }
                            });
                          }}
                        >
                          보관
                        </button>
                      </ActionMenu>
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

      <NotificationStack notifications={notifications} onDismiss={dismiss} />
      {archiveOpen && desk && (
        <ArchiveDialog
          checkItems={desk.archivedCheckItems}
          pinnedNotes={desk.archivedPinnedNotes}
          busy={busy}
          onClose={() => setArchiveOpen(false)}
          mutate={mutate}
          recordAction={recordAction}
        />
      )}
      {dialog && (
        <Phase2DialogContent
          dialog={dialog}
          issue={issue}
          busy={busy}
          onClose={() => desk?.operatorName && setDialog(null)}
          mutate={mutate}
          recordAction={recordAction}
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
        <BookLogo />
        <div>
          <b>QT Manager</b>
          <small>
            맑은샘광천교회 청년부{" "}
            <span className="info-tooltip">
              <button type="button" aria-label="제작 정보">
                i
              </button>
              <span role="tooltip">2026 교육국 제작</span>
            </span>
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
  openMenu,
  onOpenMenu,
  onSelect,
  onDistribute,
  onCancelDistribution,
  onPartial,
  onCheckItem,
}: {
  person: DeskPerson;
  selected: boolean;
  busy: boolean;
  openMenu: string | null;
  onOpenMenu: (id: string | null) => void;
  onSelect: () => void;
  onDistribute: () => void;
  onCancelDistribution: () => void;
  onPartial: () => void;
  onCheckItem: () => void;
}) {
  return (
    <article
      className={`person-row ${selected ? "selected" : ""} ${distributionClass(person.distributionStatus)}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
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
          {person.isLastIssue ? "이번 호 마지막" : person.subscriptionStatus}
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
          className={
            person.distributionStatus === "배부 완료"
              ? "cancel-distribution-button"
              : "primary-button"
          }
          data-testid="distribute"
          type="button"
          disabled={
            (!person.canDistribute &&
              person.distributionStatus !== "배부 완료") ||
            busy
          }
          onClick={(event) => {
            event.stopPropagation();
            if (person.distributionStatus === "배부 완료")
              onCancelDistribution();
            else onDistribute();
          }}
        >
          {person.distributionStatus === "배부 완료"
            ? "배부 취소"
            : person.canDistribute
              ? `${person.remainingQuantity}권 배부`
              : person.subscriptionStatus === "구독 만료"
                ? "구독 갱신"
                : person.distributionStatus}
        </button>
        <ActionMenu
          id={`person-${person.personId}`}
          label={`${person.name} 메뉴`}
          openMenu={openMenu}
          onOpenMenu={onOpenMenu}
          className="row-menu"
        >
          <button type="button" onClick={onCheckItem}>
            확인할 일 추가
          </button>
          {person.canDistribute && person.remainingQuantity > 1 && (
            <button type="button" onClick={onPartial}>
              일부만 배부
            </button>
          )}
        </ActionMenu>
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

function distributionClass(status: string) {
  if (status === "일부 배부") return "distribution-partial";
  if (status === "배부 완료") return "distribution-complete";
  return "distribution-undistributed";
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
