import { useCallback, useEffect, useRef, useState } from "react";

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
  onExternalChange,
  onStateImported,
}: {
  issue: Issue;
  notify: (message: string, kind?: "success" | "error") => void;
  recordAction: (action: ReversibleAction) => void;
  focusPersonId?: string | null;
  onFocusConsumed?: () => void;
  onExternalChange?: () => void;
  onStateImported?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [management, setManagement] = useState<PeopleManagement | null>(null);
  const [selection, setSelection] = useState<ManagementSelection>({
    selectedId: null,
    detail: null,
  });
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [busy, setBusy] = useState(false);
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

  const refresh = useCallback(async () => {
    await loader.refresh(query, includeArchived);
  }, [includeArchived, loader, query]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => () => loader.cancelPending(), [loader]);

  useEffect(() => {
    if (!focusPersonId || !management) return;
    const isVisible = management.people.some(
      (person) => person.id === focusPersonId,
    );
    if (!isVisible && (query !== "" || !includeArchived)) {
      loader.invalidate();
      if (query !== "") setQuery("");
      if (!includeArchived) setIncludeArchived(true);
      return;
    }
    void loader.select(focusPersonId);
    onFocusConsumed?.();
  }, [
    focusPersonId,
    includeArchived,
    loader,
    management,
    onFocusConsumed,
    query,
  ]);

  async function mutate(
    work: () => Promise<unknown>,
    success: string,
    options: { closeDialog?: boolean } = {},
  ) {
    onExternalChange?.();
    setBusy(true);
    try {
      await work();
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
            Google 응답 붙여넣기
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
              data-testid="management-search"
              value={query}
              onChange={(event) => {
                loader.invalidate();
                setDraftOnly(false);
                setQuery(event.target.value);
              }}
              placeholder="이름, 또래, 전화번호 검색"
              aria-label="관리할 QT 신청자 검색"
            />
          </label>
          <label className="check-field archived-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                loader.invalidate();
                setDraftOnly(false);
                setIncludeArchived(event.target.checked);
              }}
            />
            보관된 신청자도 보기
          </label>
          <div className="management-counts">
            <span>검색 결과 {management?.people.length ?? 0}명</span>
            {(() => {
              const draftPeople = profileCompletionPeople(
                management?.people ?? [],
              );
              const draftNames = profileCompletionNames(draftPeople);
              const draftCount = management?.draftCount ?? 0;
              if (draftCount === 0) {
                return (
                  <span title="현장 간이 등록 상태가 아직 보완되지 않은 신청자 수">
                    정보 보완 필요 0명
                  </span>
                );
              }
              return (
                <button
                  className={draftOnly ? "count-filter active" : "count-filter"}
                  data-testid="draft-count-filter"
                  type="button"
                  aria-pressed={draftOnly}
                  aria-label={`정보 보완 필요 ${draftCount}명${draftNames ? `: ${draftNames}` : ""}`}
                  title={`보완 대상: ${draftNames || "신청자 목록"} · 눌러 목록 필터`}
                  onClick={() => setDraftOnly((current) => !current)}
                >
                  정보 보완 필요 {draftCount}명
                </button>
              );
            })()}
          </div>
          <ManagementPersonList
            people={
              draftOnly
                ? profileCompletionPeople(management?.people ?? [])
                : (management?.people ?? [])
            }
            selectedId={selection.selectedId}
            onSelect={(id) => void loader.select(id)}
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
