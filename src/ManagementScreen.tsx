import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditDialog, RegisterDialog, RenewDialog } from "./Phase3Dialogs";
import { ApplicationImportDialog } from "./ApplicationImportDialog";
import { HandoverDialog } from "./HandoverDialog";
import { ManagementPersonList, PersonDetailPanel } from "./ManagementDetail";
import {
  profileCompletionNames,
  profileCompletionPeople,
} from "./managementFilters";
import {
  createManagementLoader,
  type ManagementSelection,
} from "./managementLoader";
import type { ReversibleAction } from "./actionHistory";
import {
  createMemo,
  deleteMemo,
  type Issue,
  updateMemo,
  updateMemoStatus,
} from "./phase2";
import {
  type PeopleManagement,
  type PersonDetail,
  type PersonInput,
  loadManagement,
  loadPersonDetail,
  deletePerson,
  setPersonArchived,
  updatePerson,
} from "./phase3";

type ManagementDialog =
  | { type: "register" }
  | { type: "applications" }
  | { type: "handover" }
  | { type: "edit"; person: PersonDetail }
  | { type: "renew"; person: PersonDetail }
  | null;

export function ManagementScreen({
  issue,
  notify,
  recordAction,
  focusPersonId,
  onFocusConsumed,
  renewPersonId,
  onRenewConsumed,
  onExternalChange,
  onStateImported,
  dataVersion = 0,
  active = true,
}: {
  issue: Issue;
  dataVersion?: number;
  active?: boolean;
  notify: (message: string, kind?: "success" | "error") => void;
  recordAction: (action: ReversibleAction) => void;
  focusPersonId?: string | null;
  onFocusConsumed?: () => void;
  renewPersonId?: string | null;
  onRenewConsumed?: () => void;
  onExternalChange?: () => void;
  onStateImported?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "completion" | "archived">(
    "all",
  );
  const [management, setManagement] = useState<PeopleManagement | null>(null);
  const [selection, setSelection] = useState<ManagementSelection>({
    selectedId: null,
    detail: null,
  });
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [busy, setBusy] = useState(false);
  const managementSearchRef = useRef<HTMLInputElement>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const loaderRef = useRef<ReturnType<typeof createManagementLoader> | null>(
    null,
  );
  if (!loaderRef.current) {
    loaderRef.current = createManagementLoader({
      loadManagement,
      loadDetail: loadPersonDetail,
      onManagement: setManagement,
      onSelection: setSelection,
      onError: (reason) => notifyRef.current(errorMessage(reason), "error"),
    });
  }
  const loader = loaderRef.current;
  const refresh = useCallback(
    () => loader.refresh(query, true),
    [loader, query],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh().catch((reason) =>
        notifyRef.current(errorMessage(reason), "error"),
      );
    }, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh, dataVersion, active]);

  useEffect(() => () => loader.cancelPending(), [loader]);

  useEffect(() => {
    if (!focusPersonId || !management) return;
    const isVisible = management.people.some(
      (person) => person.id === focusPersonId,
    );
    if (!isVisible && query !== "") {
      loader.invalidate();
      if (query !== "") setQuery("");
      return;
    }
    setFilter(
      management.people.find((person) => person.id === focusPersonId)
        ?.status === "보관됨"
        ? "archived"
        : "all",
    );
    void loader.select(focusPersonId);
    onFocusConsumed?.();
  }, [focusPersonId, loader, management, onFocusConsumed, query]);

  useEffect(() => {
    if (!renewPersonId || selection.detail?.id !== renewPersonId) return;
    setDialog({ type: "renew", person: selection.detail });
    onRenewConsumed?.();
  }, [onRenewConsumed, renewPersonId, selection.detail]);

  async function mutate(
    work: () => Promise<unknown>,
    success: string,
    options: { closeDialog?: boolean } = {},
  ) {
    setBusy(true);
    try {
      await work();
      onExternalChange?.();
      if (options.closeDialog !== false) setDialog(null);
      notify(success);
      await refresh();
      return true;
    } catch (reason) {
      notify(errorMessage(reason), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const visibleManagementPeople = useMemo(() => {
    const people = management?.people ?? [];
    if (filter === "archived")
      return people.filter((person) => person.status === "보관됨");
    const activePeople = people.filter((person) => person.status !== "보관됨");
    return filter === "completion"
      ? profileCompletionPeople(activePeople)
      : activePeople;
  }, [filter, management]);

  useEffect(() => {
    if (!management || focusPersonId) return;
    if (
      !visibleManagementPeople.some(
        (person) => person.id === selection.selectedId,
      )
    ) {
      void loader.select(visibleManagementPeople[0]?.id ?? null);
    }
  }, [
    filter,
    focusPersonId,
    loader,
    management,
    selection.selectedId,
    visibleManagementPeople,
  ]);

  return (
    <main className="app-shell management-shell">
      <section className="management-heading">
        <div>
          <div className="management-heading-title">
            <h2>신청자 관리</h2>
            <span
              className="info-tooltip management-heading-help"
              data-testid="management-heading-help"
            >
              <button type="button" aria-label="신청자 관리 안내">
                i
              </button>
              <span role="tooltip">
                과거 구독과 배부 기록을 보존하면서 정보를 보완하고 갱신합니다.
              </span>
            </span>
          </div>
        </div>
        <div className="heading-actions">
          <button
            className="secondary-button compact"
            data-testid="open-handover"
            type="button"
            onClick={() => setDialog({ type: "handover" })}
          >
            데이터 백업·복원
          </button>
          <button
            className="secondary-button compact"
            data-testid="open-application-import"
            type="button"
            onClick={() => setDialog({ type: "applications" })}
          >
            스프레드시트 붙여넣기
          </button>
          <button
            className="primary-button compact"
            data-testid="open-register-person"
            type="button"
            onClick={() => setDialog({ type: "register" })}
          >
            + 신청자 등록
          </button>
        </div>
      </section>

      <section className="management-grid">
        <div className="management-list-panel">
          <label className="search-box management-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={managementSearchRef}
              data-testid="management-search"
              value={query}
              onChange={(event) => {
                loader.invalidate();
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" || event.nativeEvent.isComposing)
                  return;
                const firstPerson = visibleManagementPeople[0];
                if (!firstPerson) return;
                event.preventDefault();
                void loader.select(firstPerson.id);
                const firstRow = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    '[data-testid="management-person"]',
                  ),
                ).find((row) => row.dataset.personId === firstPerson.id);
                firstRow?.focus();
              }}
              placeholder="이름, 또래, 전화번호 검색"
              aria-label="관리할 QT 신청자 검색"
            />
          </label>
          <div className="management-counts management-filters">
            <button
              className={`count-filter ${filter === "all" ? "active" : ""}`}
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              <span>전체</span>
            </button>
            <button
              className={`count-filter ${filter === "completion" ? "active" : ""}`}
              data-testid="draft-count-filter"
              aria-label={`정보 보완 필요 ${management?.draftCount ?? 0}명: ${profileCompletionNames(profileCompletionPeople(management?.people ?? []))}`}
              type="button"
              aria-pressed={filter === "completion"}
              title={profileCompletionNames(
                profileCompletionPeople(management?.people ?? []),
              )}
              onClick={() => setFilter("completion")}
            >
              <span>정보 보완 필요</span>{" "}
              <span className="filter-count">
                {management?.draftCount ?? 0}명
              </span>
            </button>
            <button
              className={`count-filter ${filter === "archived" ? "active" : ""}`}
              data-testid="archived-count-filter"
              type="button"
              aria-pressed={filter === "archived"}
              onClick={() => setFilter("archived")}
            >
              <span>보관된 신청자</span>{" "}
              <span className="filter-count">
                {management?.archivedCount ?? 0}명
              </span>
            </button>
          </div>
          <div className="management-result-count">
            검색 결과 {visibleManagementPeople.length}명
          </div>
          <ManagementPersonList
            people={visibleManagementPeople}
            selectedId={selection.selectedId}
            onSelect={(id) => void loader.select(id)}
            onReturnToSearch={() => {
              loader.select(null);
              managementSearchRef.current?.focus();
            }}
          />
        </div>

        <PersonDetailPanel
          detail={selection.detail}
          busy={busy}
          onEdit={(person) => setDialog({ type: "edit", person })}
          onRenew={(person) => setDialog({ type: "renew", person })}
          onCreateMemo={(personId, content) => {
            let createdId = "";
            return mutate(async () => {
              createdId = await createMemo(personId, content);
            }, "메모를 저장했습니다.").then((saved) => {
              if (saved) {
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
          onToggleArchived={(person) =>
            void mutate(
              () => setPersonArchived(person.id, person.status !== "보관됨"),
              person.status === "보관됨"
                ? "QT 신청자를 일반 목록으로 복원했습니다."
                : "QT 신청자를 보관했습니다.",
            )
          }
          onDelete={(person) => {
            if (
              !window.confirm(
                "이 신청자를 영구 삭제할까요? 구독·배부·개별 구매·메모 이력이 있는 신청자는 삭제할 수 없고 보관만 가능합니다.",
              )
            ) {
              return Promise.resolve(false);
            }
            return mutate(
              () => deletePerson(person.id),
              "QT 신청자를 삭제했습니다.",
            );
          }}
        />
      </section>

      {dialog?.type === "register" && (
        <RegisterDialog
          issue={issue}
          busy={busy}
          onClose={() => setDialog(null)}
          onSaved={(work) =>
            mutate(work, "QT 신청자와 연간 구독을 등록했습니다.")
          }
        />
      )}
      {dialog?.type === "applications" && (
        <ApplicationImportDialog
          issueYear={issue.year}
          onClose={() => setDialog(null)}
          onDirectRegister={() => setDialog({ type: "register" })}
          onImported={async (message) => {
            // 붙여넣기 가져오기는 외부 상태를 추가하므로 이전 undo/redo를
            // 현재 데이터에 재적용하지 않도록 전체 기록을 초기화한다.
            onStateImported?.();
            notify(message);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "handover" && (
        <HandoverDialog
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onImported={onStateImported}
        />
      )}
      {dialog?.type === "edit" && (
        <ManagementEditDialog
          person={
            selection.detail?.id === dialog.person.id
              ? selection.detail
              : dialog.person
          }
          busy={busy}
          mutate={mutate}
          recordAction={recordAction}
          onClose={() => setDialog(null)}
          onSaved={(work, input) =>
            mutate(work, "QT 신청자 정보를 수정했습니다.").then((saved) => {
              if (saved) {
                const previous: PersonInput = {
                  name: dialog.person.name,
                  cohort: dialog.person.cohort ?? "",
                  phone: dialog.person.phone ?? "",
                  personNote: dialog.person.personNote ?? "",
                };
                recordAction({
                  description: `${dialog.person.name} 정보 수정`,
                  undo: () =>
                    updatePerson(dialog.person.id, {
                      ...previous,
                      confirmDuplicate: true,
                    }),
                  redo: () =>
                    updatePerson(dialog.person.id, {
                      ...input,
                      confirmDuplicate: true,
                    }),
                });
              }
              return saved;
            })
          }
        />
      )}
      {dialog?.type === "renew" && (
        <RenewDialog
          person={dialog.person}
          issue={issue}
          busy={busy}
          onClose={() => setDialog(null)}
          onSaved={(work) => mutate(work, "새 연간 구독을 추가했습니다.")}
        />
      )}
    </main>
  );
}

export function ManagementEditDialog({
  person,
  busy,
  mutate,
  recordAction,
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  busy: boolean;
  mutate?: (
    work: () => Promise<unknown>,
    success: string,
    options?: { closeDialog?: boolean },
  ) => Promise<boolean>;
  recordAction?: (action: ReversibleAction) => void;
  onClose: () => void;
  onSaved: (
    work: () => Promise<unknown>,
    input: PersonInput,
  ) => Promise<boolean>;
}) {
  const runMutate = mutate ?? (async () => false);
  const record = recordAction ?? (() => undefined);
  return (
    <EditDialog
      person={person}
      memos={person.memos ?? []}
      busy={busy}
      onClose={onClose}
      onSaved={onSaved}
      onCreateMemo={(content) => {
        let createdId = "";
        return runMutate(
          async () => {
            createdId = await createMemo(person.id, content);
          },
          "메모를 저장했습니다.",
          { closeDialog: false },
        ).then((saved) => {
          if (saved && createdId) {
            record({
              description: "연결 메모 추가",
              undo: () => updateMemoStatus(createdId, true),
              redo: () => updateMemoStatus(createdId, false),
            });
          }
          return saved;
        });
      }}
      onUpdateMemo={(memo, content) =>
        runMutate(() => updateMemo(memo.id, content), "메모를 수정했습니다.", {
          closeDialog: false,
        }).then((saved) => {
          if (saved) {
            record({
              description: "메모 수정",
              undo: () => updateMemo(memo.id, memo.content),
              redo: () => updateMemo(memo.id, content),
            });
          }
          return saved;
        })
      }
      onArchiveMemo={(memo, archived) =>
        runMutate(
          () => updateMemoStatus(memo.id, archived),
          archived ? "메모를 보관했습니다." : "메모를 복원했습니다.",
          { closeDialog: false },
        ).then((saved) => {
          if (saved) {
            record({
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
        return runMutate(() => deleteMemo(memo.id), "메모를 삭제했습니다.", {
          closeDialog: false,
        });
      }}
    />
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
