import { useCallback, useEffect, useRef, useState } from "react";

import { EditDialog, RegisterDialog, RenewDialog } from "./Phase3Dialogs";
import { ApplicationImportDialog } from "./ApplicationImportDialog";
import { HandoverDialog } from "./HandoverDialog";
import { ManagementPersonList, PersonDetailPanel } from "./ManagementDetail";
import {
  createManagementLoader,
  type ManagementSelection,
} from "./managementLoader";
import type { ReversibleAction } from "./actionHistory";
import { createCheckItem, type Issue, updateCheckItemStatus } from "./phase2";
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
  onExternalChange,
  onStateImported,
}: {
  issue: Issue;
  notify: (message: string, kind?: "success" | "error") => void;
  recordAction: (action: ReversibleAction) => void;
  onExternalChange?: () => void;
  onStateImported?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
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

  async function mutate(work: () => Promise<unknown>, success: string) {
    onExternalChange?.();
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
                setIncludeArchived(event.target.checked);
              }}
            />
            보관된 신청자도 보기
          </label>
          <div className="management-counts">
            <span>검색 결과 {management?.people.length ?? 0}명</span>
            <span>정보 보완 {management?.draftCount ?? 0}명</span>
          </div>
          <ManagementPersonList
            people={management?.people ?? []}
            selectedId={selection.selectedId}
            onSelect={(id) => void loader.select(id)}
          />
        </div>

        <PersonDetailPanel
          detail={selection.detail}
          busy={busy}
          onEdit={(person) => setDialog({ type: "edit", person })}
          onRenew={(person) => setDialog({ type: "renew", person })}
          onSavePersonNote={(person, note) => {
            const previous: PersonInput = {
              name: person.name,
              cohort: person.cohort ?? "",
              phone: person.phone ?? "",
              personNote: person.personNote ?? "",
            };
            const next: PersonInput = { ...previous, personNote: note };
            return mutate(
              () =>
                updatePerson(person.id, { ...next, confirmDuplicate: true }),
              "신청자 메모를 저장했습니다.",
            ).then((saved) => {
              if (saved) {
                recordAction({
                  description: `${person.name} 신청자 메모 수정`,
                  undo: () =>
                    updatePerson(person.id, {
                      ...previous,
                      confirmDuplicate: true,
                    }),
                  redo: () =>
                    updatePerson(person.id, {
                      ...next,
                      confirmDuplicate: true,
                    }),
                });
              }
              return saved;
            });
          }}
          onCreateCheckItem={(personId, content) => {
            let createdId = "";
            return mutate(async () => {
              createdId = await createCheckItem(personId, content);
            }, "신청자 확인할 일을 저장했습니다.").then((saved) => {
              if (saved) {
                recordAction({
                  description: "신청자 확인할 일 추가",
                  undo: () => updateCheckItemStatus(createdId, "archived"),
                  redo: () => updateCheckItemStatus(createdId, "needs_check"),
                });
              }
              return saved;
            });
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
          person={dialog.person}
          busy={busy}
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
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  busy: boolean;
  onClose: () => void;
  onSaved: (
    work: () => Promise<unknown>,
    input: PersonInput,
  ) => Promise<boolean>;
}) {
  return (
    <EditDialog
      person={person}
      checkItems={person.checkItems}
      busy={busy}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
