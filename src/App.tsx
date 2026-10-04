import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionMenu } from "./ActionMenu";
import { AppNavigation } from "./AppNavigation";
import { MemoArchiveDialog } from "./MemoArchiveDialog";
import { MemoCard } from "./MemoCard";
import { MemoDetailDialog } from "./MemoDetailDialog";
import { HelpPanel } from "./HelpPanel";
import { ChevronLeftIcon, ChevronRightIcon, RedoIcon, UndoIcon } from "./Icons";
import { ManagementScreen } from "./ManagementScreen";
import { NotificationStack } from "./Notifications";
import { PersonFilterMenu } from "./PersonFilterMenu";
import { PersonContextMenu } from "./PersonContextMenu";
import { type Phase2Dialog, Phase2DialogContent } from "./Phase2Dialogs";
import { EditDialog, RenewDialog } from "./Phase3Dialogs";
import type { ReversibleAction } from "./actionHistory";
import { persistTheme, readStoredTheme, type Theme } from "./appearance";
import { syncNativeTheme } from "./nativeTheme";
import {
  DEFAULT_PERSON_FILTERS,
  activeDistributionMemos,
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
  createMemo,
  deleteMemo,
  distributeAllocations,
  isTextEntryTarget,
  loadDesk,
  moveIssue,
  recommendedIssue,
  undoDistribution,
  undoDistributionAllocations,
  updateMemo,
  updateMemoStatus,
} from "./phase2";
import {
  type PersonDetail,
  type PersonInput,
  loadPersonDetail,
  updatePerson,
} from "./phase3";
import { useNotifications } from "./useNotifications";
import { createDistributionLoader } from "./distributionLoader";
import { useTextDraft } from "./drafts";
import {
  listIndexAfterKey,
  screenForShortcut,
  shouldReturnToSearch,
} from "./keyboardNavigation";

export default function App() {
  const [screen, setScreen] = useState<"distribution" | "management">(
    "distribution",
  );
  const [managementFocusId, setManagementFocusId] = useState<string | null>(
    null,
  );
  const [managementRenewPersonId, setManagementRenewPersonId] = useState<
    string | null
  >(null);
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
  const [personContextMenu, setPersonContextMenu] = useState<{
    personId: string;
    x: number;
    y: number;
  } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dialog, setDialog] = useState<Phase2Dialog>(null);
  const [editPerson, setEditPerson] = useState<PersonDetail | null>(null);
  const [renewPerson, setRenewPerson] = useState<PersonDetail | null>(null);
  const [memoDetail, setMemoDetail] = useState<
    import("./phase2").MemoView | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "memo";
    id: string;
    label: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const quickItemDraft = useTextDraft("quick-memo");
  const [undoStack, setUndoStack] = useState<ReversibleAction[]>([]);
  const [redoStack, setRedoStack] = useState<ReversibleAction[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickItemRef = useRef<HTMLTextAreaElement>(null);
  const personRowRefs = useRef(new Map<string, HTMLElement>());
  const hadDialog = useRef(false);
  const distributionLoader = useMemo(
    () => createDistributionLoader(loadDesk),
    [],
  );
  const { notifications, notify, dismiss } = useNotifications();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
    void syncNativeTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (hadDialog.current && !dialog && selectedPersonId) {
      const row = personRowRefs.current.get(selectedPersonId);
      row?.focus();
      // Escape closes a dialog before React has committed its unmount. A
      // second focus pass keeps Enter bound to the selected row in Tauri/WebKit.
      requestAnimationFrame(() =>
        personRowRefs.current.get(selectedPersonId)?.focus(),
      );
    }
    hadDialog.current = Boolean(dialog);
  }, [dialog, selectedPersonId]);

  const refresh = useCallback(async () => {
    try {
      const next = await distributionLoader.load(issue, query, true);
      if (!next) return;
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
  }, [distributionLoader, issue, notify, query]);

  useEffect(() => () => distributionLoader.cancel(), [distributionLoader]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const mutate = useCallback(
    async (
      work: () => Promise<unknown>,
      success: string,
      options: { preserveHistory?: boolean } = {},
    ) => {
      if (!options.preserveHistory) setRedoStack([]);
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

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const undoAction = useCallback(async () => {
    const action = undoStack.at(-1);
    if (!action) {
      if (desk?.canUndoDistribution) {
        let allocation: Awaited<ReturnType<typeof undoDistribution>> | null =
          null;
        const saved = await mutate(
          async () => {
            allocation = await undoDistribution(issue);
          },
          "최근 배부를 되돌렸습니다.",
          { preserveHistory: true },
        );
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
    if (
      await mutate(action.undo, `${action.description}: 되돌렸습니다.`, {
        preserveHistory: true,
      })
    ) {
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, action]);
    }
  }, [desk?.canUndoDistribution, issue, mutate, undoStack]);

  const redoAction = useCallback(async () => {
    const action = redoStack.at(-1);
    if (!action) return;
    if (
      await mutate(action.redo, `${action.description}: 다시 실행했습니다.`, {
        preserveHistory: true,
      })
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

  const contextPerson = personContextMenu
    ? visiblePeople.find(
        (person) => person.personId === personContextMenu.personId,
      )
    : null;

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

  const openPersonRenewal = useCallback(
    async (personId: string) => {
      setBusy(true);
      try {
        setRenewPerson(await loadPersonDetail(personId));
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
      if (busy || !person.canDistribute) return;
      if (
        activeDistributionMemos(desk?.memos ?? [], person.personId).length > 0
      ) {
        setDialog({ type: "confirm-distribution", person });
        return;
      }
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
    [busy, desk?.memos, issue, mutate, recordAction],
  );

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;
      const textEntry = isTextEntryTarget(event.target);
      const shortcutScreen = screenForShortcut(event.key, modified);
      const focusedPersonId =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches('[data-testid="person-row"]')
          ? (document.activeElement.dataset.personId ?? null)
          : null;
      const activePersonId =
        focusedPersonId ??
        selectedPersonId ??
        document.querySelector<HTMLElement>(
          '[data-testid="person-row"][aria-selected="true"]',
        )?.dataset.personId ??
        null;

      // WebKit/Tauri can keep focus on the dialog backdrop after a modal is
      // mounted. Handle the confirmation's second Enter at the window level
      // as well so keyboard users do not depend on native button activation.
      if (
        dialog?.type === "confirm-distribution" &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !modified &&
        !textEntry &&
        !event.isComposing
      ) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        if (
          event.target instanceof HTMLElement &&
          event.target.closest<HTMLButtonElement>("button")?.type === "button"
        )
          return;
        event.preventDefault();
        document
          .querySelector<HTMLFormElement>(
            '[data-testid="confirm-distribution-form"]',
          )
          ?.requestSubmit();
        return;
      }

      // Dialogs own their keyboard interaction (including Enter and Escape).
      // Keeping the global shortcuts out of an open dialog prevents the first
      // Enter that opens a confirmation from submitting it immediately.
      if (dialog || helpOpen) return;

      if (event.key === "/" && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        const targetSearch =
          screen === "management"
            ? document.querySelector<HTMLInputElement>(
                '[data-testid="management-search"]',
              )
            : searchRef.current;
        targetSearch?.focus();
      } else if (shortcutScreen) {
        event.preventDefault();
        setScreen(shortcutScreen);
      } else if (modified && !textEntry && event.key === "Enter") {
        event.preventDefault();
        const person = visiblePeople.find(
          (candidate) => candidate.personId === activePersonId,
        );
        if (person) void defaultDistribution(person);
      } else if (
        screen === "distribution" &&
        !modified &&
        !textEntry &&
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.matches('[data-testid="person-row"]')
      ) {
        const person = visiblePeople.find(
          (candidate) => candidate.personId === activePersonId,
        );
        if (person?.canDistribute) {
          event.preventDefault();
          setDialog({ type: "confirm-distribution", person });
        }
      } else if (modified && !textEntry && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog({ type: "draft" });
      } else if (
        modified &&
        !textEntry &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        quickItemRef.current?.focus();
      } else if (modified && !textEntry && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redoAction();
        else void undoAction();
      } else if (
        screen === "distribution" &&
        event.key === "ArrowLeft" &&
        activePersonId &&
        (!textEntry ||
          event.target === quickItemRef.current ||
          (event.target instanceof HTMLElement &&
            event.target.id === "quick-item"))
      ) {
        event.preventDefault();
        personRowRefs.current.get(activePersonId)?.focus();
      } else if (
        screen === "distribution" &&
        !textEntry &&
        event.key === "ArrowRight" &&
        activePersonId
      ) {
        event.preventDefault();
        setSelectedPersonId(activePersonId);
        quickItemRef.current?.focus();
      } else if (
        screen === "distribution" &&
        !textEntry &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        // 브라우저가 행 클릭 직후 키 이벤트를 전달하는 경계에서는 React
        // 상태보다 DOM의 선택 표시가 먼저 반영될 수 있다. 두 값을 함께
        // 읽어 방향키가 첫 행으로 되돌아가지 않게 한다.
        const current = visiblePeople.findIndex(
          (person) => person.personId === activePersonId,
        );
        const direction = event.key === "ArrowDown" ? "down" : "up";
        if (shouldReturnToSearch(visiblePeople.length, current, direction)) {
          event.preventDefault();
          setSelectedPersonId(null);
          searchRef.current?.focus();
          return;
        }
        const next = listIndexAfterKey(
          visiblePeople.length,
          current,
          direction,
        );
        const nextPersonId =
          next === null ? null : (visiblePeople[next]?.personId ?? null);
        setSelectedPersonId(nextPersonId);
        if (nextPersonId) {
          personRowRefs.current.get(nextPersonId)?.focus();
        } else if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
      if (event.key === "Escape" && personContextMenu) {
        setPersonContextMenu(null);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    defaultDistribution,
    dialog,
    helpOpen,
    personContextMenu,
    redoAction,
    screen,
    selectedPersonId,
    undoAction,
    visiblePeople,
  ]);

  useEffect(() => {
    if (!personContextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".person-context-menu")) {
        setPersonContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("click", closeOutside);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("click", closeOutside);
    };
  }, [personContextMenu]);

  const submitQuickItem = () => {
    if (!quickItemDraft.value.trim()) return;
    let createdId = "";
    void mutate(async () => {
      createdId = await createMemo(null, quickItemDraft.value);
    }, "메모를 추가했습니다.").then((saved) => {
      if (saved) {
        recordAction({
          description: "메모 추가",
          undo: () => updateMemoStatus(createdId, true),
          redo: () => updateMemoStatus(createdId, false),
        });
        quickItemDraft.clear();
        quickItemRef.current?.focus();
      }
    });
  };

  return (
    <div
      className="fixed-app"
      onContextMenu={(event) => {
        if (!isTextEntryTarget(event.target)) event.preventDefault();
      }}
    >
      <AppNavigation
        active={screen}
        operator={desk?.operatorName}
        theme={theme}
        onDistribution={() => setScreen("distribution")}
        onManagement={() => setScreen("management")}
        onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onHelp={() => setHelpOpen(true)}
        onOperator={() => setDialog({ type: "operator" })}
      />

      <div
        className={`management-host ${screen === "management" ? "screen-visible" : "screen-hidden"}`}
        aria-hidden={screen !== "management"}
      >
        <ManagementScreen
          issue={issue}
          notify={notify}
          recordAction={recordAction}
          focusPersonId={managementFocusId}
          onFocusConsumed={() => setManagementFocusId(null)}
          renewPersonId={managementRenewPersonId}
          onRenewConsumed={() => setManagementRenewPersonId(null)}
          onExternalChange={() => setRedoStack([])}
          onStateImported={clearHistory}
        />
      </div>

      <main
        className={`desk ${screen === "distribution" ? "screen-visible" : "screen-hidden"}`}
        aria-hidden={screen !== "distribution"}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest(
              "button, input, textarea, select, a, [role='option'], .more-menu, .person-context-menu",
            )
          ) {
            setSelectedPersonId(null);
            setPersonContextMenu(null);
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
                  onKeyDown={(event) => {
                    if (
                      event.key !== "ArrowDown" ||
                      event.nativeEvent.isComposing
                    )
                      return;
                    const firstPerson = visiblePeople[0];
                    if (!firstPerson) return;
                    event.preventDefault();
                    setSelectedPersonId(firstPerson.personId);
                    personRowRefs.current.get(firstPerson.personId)?.focus();
                  }}
                  placeholder="또래 또는 이름 검색"
                  aria-label="QT 신청자 검색"
                />
                <kbd>/</kbd>
              </label>
              <button
                className="secondary-button draft-action-button"
                data-testid="open-draft"
                type="button"
                onClick={() => setDialog({ type: "draft" })}
              >
                + 1년 구독
              </button>
              <button
                className="secondary-button draft-action-button"
                data-testid="open-purchase"
                type="button"
                onClick={() => setDialog({ type: "purchase" })}
              >
                + 1달 구독
              </button>
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
                  onOpenContextMenu={(position) => {
                    setOpenMenu(null);
                    setPersonContextMenu({
                      personId: person.personId,
                      ...position,
                    });
                  }}
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
                  onViewDetails={() => {
                    setManagementFocusId(person.personId);
                    setScreen("management");
                  }}
                  onRenew={() => void openPersonRenewal(person.personId)}
                  onMemo={() =>
                    setDialog({
                      type: "memo",
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
                      ? "검색어를 확인하거나 1년 구독을 이용하세요."
                      : "검색하면 완료자와 만료자도 확인할 수 있습니다."}
                  </span>
                </div>
              )}
            </div>
          </section>

          {personContextMenu && (
            <PersonContextMenu
              x={personContextMenu.x}
              y={personContextMenu.y}
              onClose={() => setPersonContextMenu(null)}
              actions={[
                {
                  label: "상세 정보 보기",
                  onSelect: () => {
                    setManagementFocusId(personContextMenu.personId);
                    setScreen("management");
                  },
                },
                {
                  label: "메모 추가",
                  onSelect: () =>
                    setDialog({
                      type: "memo",
                      personId: personContextMenu.personId,
                    }),
                },
                {
                  label: "신청자 정보 수정",
                  onSelect: () =>
                    void openPersonEdit(personContextMenu.personId),
                },
                ...(contextPerson &&
                contextPerson.canDistribute &&
                contextPerson.remainingQuantity > 1
                  ? [
                      {
                        label: "일부만 배부",
                        onSelect: () =>
                          setDialog({ type: "partial", person: contextPerson }),
                      },
                    ]
                  : []),
              ]}
            />
          )}

          <aside className="notes-panel">
            <header>
              <h2>메모</h2>
              <div>
                <button
                  className="archive-button"
                  type="button"
                  onClick={() => setArchiveOpen(true)}
                >
                  보관함
                </button>
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
                새 메모
              </label>
              <textarea
                id="quick-item"
                ref={quickItemRef}
                autoFocus
                value={quickItemDraft.value}
                onChange={(event) =>
                  quickItemDraft.setValue(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return;
                  }
                  event.preventDefault();
                  submitQuickItem();
                }}
                placeholder="메모를 입력하세요…"
              />
              <div>
                <button
                  type="submit"
                  data-testid="add-memo"
                  disabled={busy || !quickItemDraft.value.trim()}
                >
                  추가
                </button>
              </div>
            </form>
            <div className="memo-list">
              {(desk?.memos ?? []).map((memo) => (
                <MemoCard
                  key={memo.id}
                  memo={memo}
                  onOpenDetail={setMemoDetail}
                />
              ))}
              {(desk?.memos?.length ?? 0) === 0 && (
                <p className="memo-empty">활성 메모가 없습니다.</p>
              )}
            </div>
          </aside>
        </div>
      </main>

      <NotificationStack notifications={notifications} onDismiss={dismiss} />
      {archiveOpen && desk && (
        <MemoArchiveDialog
          memos={desk.archivedMemos ?? []}
          busy={busy}
          onClose={() => setArchiveOpen(false)}
          onOpen={(memo) => {
            setArchiveOpen(false);
            setMemoDetail(memo);
          }}
          onRestore={(memo) => {
            void mutate(
              () => updateMemoStatus(memo.id, false),
              "메모를 복원했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: "메모 복원",
                  undo: () => updateMemoStatus(memo.id, true),
                  redo: () => updateMemoStatus(memo.id, false),
                });
              }
            });
          }}
          onDelete={(memo) =>
            setDeleteTarget({
              type: "memo",
              id: memo.id,
              label: "메모",
            })
          }
        />
      )}
      {dialog && (
        <Phase2DialogContent
          memos={desk?.memos ?? []}
          key={dialog.type}
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
          memos={editPerson.memos ?? []}
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
          onCreateMemo={(content) => {
            let createdId = "";
            return mutate(async () => {
              createdId = await createMemo(editPerson.id, content);
            }, "메모를 저장했습니다.").then((saved) => {
              if (saved && createdId) {
                recordAction({
                  description: "연결 메모 추가",
                  undo: () => updateMemoStatus(createdId, true),
                  redo: () => updateMemoStatus(createdId, false),
                });
              }
              return saved;
            });
          }}
          onUpdateMemo={(memo, content) =>
            mutate(
              () => updateMemo(memo.id, content),
              "메모를 수정했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: "메모 수정",
                  undo: () => updateMemo(memo.id, memo.content),
                  redo: () => updateMemo(memo.id, content),
                });
              }
              return saved;
            })
          }
          onArchiveMemo={(memo, archived) =>
            mutate(
              () => updateMemoStatus(memo.id, archived),
              archived ? "메모를 보관했습니다." : "메모를 복원했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: archived ? "메모 보관" : "메모 복원",
                  undo: () => updateMemoStatus(memo.id, !archived),
                  redo: () => updateMemoStatus(memo.id, archived),
                });
              }
              return saved;
            })
          }
          onDeleteMemo={(memo) => {
            if (!window.confirm("이 메모를 삭제할까요?")) {
              return Promise.resolve(false);
            }
            return mutate(() => deleteMemo(memo.id), "메모를 삭제했습니다.");
          }}
        />
      )}
      {renewPerson && (
        <RenewDialog
          person={renewPerson}
          issue={issue}
          busy={busy}
          onClose={() => setRenewPerson(null)}
          onSaved={(work) =>
            mutate(work, "구독을 추가했습니다.").then((saved) => {
              if (saved) setRenewPerson(null);
              return saved;
            })
          }
        />
      )}
      {memoDetail && (
        <MemoDetailDialog
          memo={memoDetail}
          busy={busy}
          onClose={() => setMemoDetail(null)}
          onSave={(content) =>
            mutate(
              () => updateMemo(memoDetail.id, content),
              "메모를 수정했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: "메모 수정",
                  undo: () => updateMemo(memoDetail.id, memoDetail.content),
                  redo: () => updateMemo(memoDetail.id, content),
                });
              }
              return saved;
            })
          }
          onArchive={(archived) =>
            mutate(
              () => updateMemoStatus(memoDetail.id, archived),
              archived ? "메모를 보관했습니다." : "메모를 복원했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: archived ? "메모 보관" : "메모 복원",
                  undo: () => updateMemoStatus(memoDetail.id, !archived),
                  redo: () => updateMemoStatus(memoDetail.id, archived),
                });
                setMemoDetail(null);
              }
              return saved;
            })
          }
          onDelete={() =>
            setDeleteTarget({
              type: "memo",
              id: memoDetail.id,
              label: "메모",
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
              () => deleteMemo(deleteTarget.id),
              `${deleteTarget.label}를 삭제했습니다.`,
            ).then((saved) => {
              if (saved) {
                setDeleteTarget(null);
                setMemoDetail(null);
                setArchiveOpen(false);
              }
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
    <div className={warning ? "warning" : ""} title={value}>
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
  onOpenContextMenu,
  onSelect,
  onDistribute,
  onCancelDistribution,
  onPartial,
  onViewDetails,
  onRenew,
  onMemo,
  onEdit,
  rowRef,
}: {
  person: DeskPerson;
  selected: boolean;
  busy: boolean;
  openMenu: string | null;
  onOpenMenu: (id: string | null) => void;
  onOpenContextMenu: (position: { x: number; y: number }) => void;
  onSelect: () => void;
  onDistribute: () => void;
  onCancelDistribution: () => void;
  onPartial: () => void;
  onViewDetails: () => void;
  onRenew: () => void;
  onMemo: () => void;
  onEdit: () => void;
  rowRef?: (element: HTMLElement | null) => void;
}) {
  const headline = subscriptionHeadline(person);
  const isExpired = person.subscriptionStatus === "구독 만료";
  return (
    <article
      ref={rowRef}
      className={`person-row ${selected ? "selected" : ""} ${distributionClass(person.distributionStatus)}`}
      role="option"
      aria-label={`${person.cohort ?? "또래 없음"} ${person.name}, ${person.phone ?? "연락처 없음"}, ${person.subscriptionStatus}, ${person.distributionStatus}`}
      aria-selected={selected}
      tabIndex={0}
      data-person-id={person.personId}
      onClick={onSelect}
      onDoubleClick={(event) => {
        event.preventDefault();
        onEdit();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // 우클릭한 행도 현재 작업 대상이 되도록 선택을 맞춘다. 이미
        // 선택된 행에서는 토글하지 않아 우클릭이 선택 해제로 이어지지 않는다.
        if (!selected) onSelect();
        onOpenContextMenu({ x: event.clientX, y: event.clientY });
      }}
      data-testid="person-row"
    >
      <span className="cohort">{person.cohort ?? "--"}</span>
      <div className="person-name">
        <b title={`${person.name} · ${person.phone ?? "연락처 없음"}`}>
          {person.name}
        </b>
        {person.hasMemo && (
          <span
            className="person-check-indicator"
            aria-label="메모 있음"
            title="연결된 메모가 있습니다"
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
          data-testid={isExpired ? "renew-subscription" : "distribute"}
          type="button"
          disabled={
            isExpired
              ? busy
              : (!person.canDistribute &&
                  person.distributionStatus !== "배부 완료") ||
                busy
          }
          onClick={(event) => {
            event.stopPropagation();
            if (person.distributionStatus === "배부 완료")
              onCancelDistribution();
            else if (isExpired) onRenew();
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
          <button type="button" onClick={onViewDetails}>
            상세 정보 보기
          </button>
          <button type="button" onClick={onMemo}>
            메모 추가
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
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog delete-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="delete-dialog-title">{label}를 삭제할까요?</h2>
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
