import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionMenu } from "./ActionMenu";
import { AppNavigation } from "./AppNavigation";
import { ArchiveDialog } from "./ArchiveDialog";
import { HelpPanel } from "./HelpPanel";
import { ChevronLeftIcon, ChevronRightIcon, RedoIcon, UndoIcon } from "./Icons";
import { ManagementScreen } from "./ManagementScreen";
import { NotificationStack } from "./Notifications";
import { PersonFilterMenu } from "./PersonFilterMenu";
import { type Phase2Dialog, Phase2DialogContent } from "./Phase2Dialogs";
import { EditDialog } from "./Phase3Dialogs";
import type { ReversibleAction } from "./actionHistory";
import { persistTheme, readStoredTheme, type Theme } from "./appearance";
import {
  DEFAULT_PERSON_FILTERS,
  checkItemOwnerLabel,
  distributionAllocations,
  filterLabel,
  filterPeople,
  issueLabelParts,
  type PersonFilter,
  subscriptionHeadline,
  subscriptionPeriodText,
} from "./distributionView";
import {
  type DeskPerson,
  type DistributionDesk,
  type Issue,
  cancelLatestPurchase,
  createCheckItem,
  deleteCheckItem,
  deletePinnedNote,
  distributeAllocations,
  isTextEntryTarget,
  loadDesk,
  moveIssue,
  recommendedIssue,
  undoDistribution,
  undoDistributionAllocations,
  updateCheckItemStatus,
  updatePinnedNote,
} from "./phase2";
import {
  type PersonDetail,
  type PersonInput,
  loadPersonDetail,
  updatePerson,
} from "./phase3";
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
  const [listFilters, setListFilters] = useState<PersonFilter[]>(() => [
    ...DEFAULT_PERSON_FILTERS,
  ]);
  const [sort, setSort] = useState<{
    key: "cohort" | "name" | "subscription" | "distribution";
    direction: "asc" | "desc";
  } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dialog, setDialog] = useState<Phase2Dialog>(null);
  const [editPerson, setEditPerson] = useState<PersonDetail | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "check-item" | "pinned-note";
    id: string;
    label: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickItem, setQuickItem] = useState("");
  const [undoStack, setUndoStack] = useState<ReversibleAction[]>([]);
  const [redoStack, setRedoStack] = useState<ReversibleAction[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickItemRef = useRef<HTMLTextAreaElement>(null);
  const personRowRefs = useRef(new Map<string, HTMLElement>());
  const { notifications, notify, dismiss } = useNotifications();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const next = await loadDesk(issue, query, true);
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
  }, [issue, notify, query]);

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
        let allocation: Awaited<ReturnType<typeof undoDistribution>> | null =
          null;
        const saved = await mutate(async () => {
          allocation = await undoDistribution(issue);
        }, "최근 배부를 되돌렸습니다.");
        if (saved && allocation) {
          const allocations = [allocation];
          setRedoStack((current) => [
            ...current,
            {
              description: "최근 배부",
              undo: () => undoDistributionAllocations(issue, allocations),
              redo: () => distributeAllocations(issue, allocations),
            },
          ]);
        }
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
    if (!desk) return [];
    const filtered = filterPeople(desk.people, new Set(listFilters));
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    const value = (person: DeskPerson) => {
      if (sort.key === "cohort") return person.cohort ?? "";
      if (sort.key === "name") return person.name;
      if (sort.key === "subscription")
        return `${person.subscriptionStatus}:${person.endDate ?? ""}`;
      return `${distributionRank(person.distributionStatus)}:${person.remainingQuantity}`;
    };
    return [...filtered].sort(
      (left, right) =>
        value(left).localeCompare(value(right), "ko", {
          numeric: true,
          sensitivity: "base",
        }) * direction,
    );
  }, [desk, listFilters, sort]);

  const selectedIssueParts = issueLabelParts(issue);

  const openPersonEdit = useCallback(
    async (personId: string) => {
      setBusy(true);
      try {
        setEditPerson(await loadPersonDetail(personId));
      } catch (reason) {
        notify(errorMessage(reason), "error");
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const toggleSort = (
    key: "cohort" | "name" | "subscription" | "distribution",
  ) => {
    setSort((current) =>
      current?.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: "asc" },
    );
  };

  const defaultDistribution = useCallback(
    async (person: DeskPerson) => {
      if (!person.canDistribute) return;
      const allocations = distributionAllocations(person);
      const saved = await mutate(
        () => distributeAllocations(issue, allocations),
        `${person.name} · ${person.remainingQuantity}권 배부했습니다.`,
      );
      if (saved) {
        recordAction({
          description: `${person.name} 배부`,
          undo: () => undoDistributionAllocations(issue, allocations),
          redo: () => distributeAllocations(issue, allocations),
        });
      }
    },
    [issue, mutate, recordAction],
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
        const nextPersonId = visiblePeople[next]?.personId ?? null;
        setSelectedPersonId(nextPersonId);
        if (nextPersonId) {
          personRowRefs.current.get(nextPersonId)?.focus();
        } else if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
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
        <AppNavigation
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
          <ManagementScreen
            issue={issue}
            notify={notify}
            recordAction={recordAction}
          />
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
      <AppNavigation
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
              <h1
                data-testid="selected-issue"
                aria-label={`${issue.year}년 ${issue.startMonth}~${issue.startMonth + 1}월호`}
              >
                <span className="issue-year">{selectedIssueParts.year}</span>
                <span className="issue-year-suffix">년</span>
                <span className="issue-months">
                  <span>{selectedIssueParts.startMonth}</span>
                  <span>~</span>
                  <span>{selectedIssueParts.endMonth}</span>
                </span>
                <span className="issue-month-suffix">월호</span>
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
                {query ? "검색 결과" : filterLabel(new Set(listFilters))}{" "}
                <b>{visiblePeople.length}</b>
              </h2>
              <div className="list-filters">
                <PersonFilterMenu
                  filters={new Set(listFilters)}
                  open={openMenu === "person-filter"}
                  onChange={setListFilters}
                  onOpenChange={(open) =>
                    setOpenMenu(open ? "person-filter" : null)
                  }
                />
              </div>
            </div>
            <div className="table-head">
              <SortButton
                label="또래"
                column="cohort"
                sort={sort}
                onSort={toggleSort}
              />
              <SortButton
                label="신청자"
                column="name"
                sort={sort}
                onSort={toggleSort}
              />
              <SortButton
                label="구독"
                column="subscription"
                sort={sort}
                onSort={toggleSort}
              />
              <SortButton
                label="배부"
                column="distribution"
                sort={sort}
                onSort={toggleSort}
              />
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
                  onEdit={() => void openPersonEdit(person.personId)}
                  rowRef={(element) => {
                    if (element)
                      personRowRefs.current.set(person.personId, element);
                    else personRowRefs.current.delete(person.personId);
                  }}
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
                  data-item-id={item.id}
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
                      <b>{checkItemOwnerLabel(item.personName)}</b>
                    </small>
                    <span className="check-item-actions">
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
                      <button
                        type="button"
                        aria-label="확인할 일 삭제"
                        onClick={() => {
                          setDeleteTarget({
                            type: "check-item",
                            id: item.id,
                            label: "확인할 일",
                          });
                        }}
                      >
                        삭제
                      </button>
                    </span>
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
                  <article
                    className="pinned-note"
                    key={note.id}
                    data-note-id={note.id}
                  >
                    <div>
                      <p title={note.title}>
                        {note.isPinned && (
                          <span aria-label="상단 고정">📌</span>
                        )}
                        {note.title}
                      </p>
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
                        <button
                          className="danger-menu-item"
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              type: "pinned-note",
                              id: note.id,
                              label: "고정 메모",
                            })
                          }
                        >
                          삭제
                        </button>
                      </ActionMenu>
                    </div>
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
      {editPerson && (
        <EditDialog
          person={editPerson}
          checkItems={(desk?.checkItems ?? []).filter(
            (item) => item.personId === editPerson.id,
          )}
          busy={busy}
          onClose={() => setEditPerson(null)}
          onSaved={(work, input) =>
            mutate(work, "QT 신청자 정보를 수정했습니다.").then((saved) => {
              if (saved) {
                const previous: PersonInput = {
                  name: editPerson.name,
                  cohort: editPerson.cohort ?? "",
                  phone: editPerson.phone ?? "",
                  personNote: editPerson.personNote ?? "",
                };
                recordAction({
                  description: `${editPerson.name} 정보 수정`,
                  undo: () =>
                    updatePerson(editPerson.id, {
                      ...previous,
                      confirmDuplicate: true,
                    }),
                  redo: () =>
                    updatePerson(editPerson.id, {
                      ...input,
                      confirmDuplicate: true,
                    }),
                });
                setEditPerson(null);
              }
              return saved;
            })
          }
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          label={deleteTarget.label}
          busy={busy}
          onClose={() => setDeleteTarget(null)}
          onDelete={() =>
            void mutate(
              () =>
                deleteTarget.type === "check-item"
                  ? deleteCheckItem(deleteTarget.id)
                  : deletePinnedNote(deleteTarget.id),
              `${deleteTarget.label}을 삭제했습니다.`,
            ).then((saved) => {
              if (saved) setDeleteTarget(null);
            })
          }
        />
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
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

export function PersonRow({
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
  onEdit,
  rowRef,
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
  onEdit: () => void;
  rowRef?: (element: HTMLElement | null) => void;
}) {
  const headline = subscriptionHeadline(person);
  return (
    <article
      ref={rowRef}
      className={`person-row ${selected ? "selected" : ""} ${distributionClass(person.distributionStatus)}`}
      role="option"
      aria-label={`${person.cohort ?? "또래 없음"} ${person.name}, ${person.phone ?? "연락처 없음"}, ${person.subscriptionStatus}, ${person.distributionStatus}`}
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={(event) => {
        event.preventDefault();
        onEdit();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(`person-${person.personId}`);
      }}
      data-testid="person-row"
    >
      <span className="cohort">{person.cohort ?? "--"}</span>
      <div className="person-name">
        <b title={`${person.name} · ${person.phone ?? "연락처 없음"}`}>
          {person.name}
        </b>
        {person.hasCheckItem && (
          <span
            className="person-check-indicator"
            aria-label="확인할 일 있음"
            title="연결된 확인할 일이 있습니다"
          />
        )}
      </div>
      <div
        className={`subscription ${statusClass(person.subscriptionStatus)} ${headline ? "" : "subscription-simple"}`}
        title={person.distributionTargets
          .map(
            (target) =>
              `${target.startIssue} → ${target.lastIssue} · ${target.targetQuantity}권`,
          )
          .join("\n")}
      >
        {headline && <b>{headline}</b>}
        <small>{subscriptionPeriodText(person)}</small>
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
          <button type="button" onClick={onEdit}>
            신청자 정보 수정
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

function SortButton({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: "cohort" | "name" | "subscription" | "distribution";
  sort: {
    key: "cohort" | "name" | "subscription" | "distribution";
    direction: "asc" | "desc";
  } | null;
  onSort: (key: "cohort" | "name" | "subscription" | "distribution") => void;
}) {
  const active = sort?.key === column;
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      onClick={() => onSort(column)}
      aria-label={`${label} ${active && sort.direction === "asc" ? "내림차순" : "오름차순"} 정렬`}
    >
      {label}
      <span aria-hidden="true">
        {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function DeleteConfirmDialog({
  label,
  busy,
  onClose,
  onDelete,
}: {
  label: string;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="dialog delete-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="delete-dialog-title">{label}을 삭제할까요?</h2>
            <p>
              목록과 인수인계 데이터에서 영구 삭제되며 변경 이력만 남습니다.
            </p>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            돌아가기
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={onDelete}
          >
            삭제
          </button>
        </div>
      </section>
    </div>
  );
}

function distributionRank(status: string) {
  if (status === "미배부") return 0;
  if (status === "일부 배부") return 1;
  if (status === "배부 완료") return 2;
  return 3;
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
