import { useCallback, useEffect, useState } from "react";

import { EditDialog, RegisterDialog, RenewDialog } from "./Phase3Dialogs";
import { ApplicationImportDialog } from "./ApplicationImportDialog";
import { HandoverDialog } from "./HandoverDialog";
import { ManagementPersonList, PersonDetailPanel } from "./ManagementDetail";
import type { ReversibleAction } from "./actionHistory";
import type { Issue } from "./phase2";
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
}: {
  issue: Issue;
  notify: (message: string, kind?: "success" | "error") => void;
  recordAction: (action: ReversibleAction) => void;
}) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [management, setManagement] = useState<PeopleManagement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await loadManagement(query, includeArchived);
      setManagement(next);
      const nextId =
        selectedId && next.people.some((person) => person.id === selectedId)
          ? selectedId
          : (next.people[0]?.id ?? null);
      setSelectedId(nextId);
      setDetail(nextId ? await loadPersonDetail(nextId) : null);
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  }, [includeArchived, notify, query, selectedId]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function selectPerson(id: string) {
    setSelectedId(id);
    try {
      setDetail(await loadPersonDetail(id));
    } catch (reason) {
      notify(errorMessage(reason), "error");
    }
  }

  async function mutate(work: () => Promise<unknown>, success: string) {
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
          <p className="section-label">신청과 구독</p>
          <h2>신청자 정보와 전체 이력</h2>
          <p>과거 구독과 배부 기록을 보존하면서 정보를 보완하고 갱신합니다.</p>
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 또래, 전화번호 검색"
              aria-label="관리할 QT 신청자 검색"
            />
          </label>
          <label className="check-field archived-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            보관된 신청자도 보기
          </label>
          <div className="management-counts">
            <span>검색 결과 {management?.people.length ?? 0}명</span>
            <span>정보 보완 {management?.draftCount ?? 0}명</span>
          </div>
          <ManagementPersonList
            people={management?.people ?? []}
            selectedId={selectedId}
            onSelect={(id) => void selectPerson(id)}
          />
        </div>

        <PersonDetailPanel
          detail={detail}
          busy={busy}
          onEdit={(person) => setDialog({ type: "edit", person })}
          onRenew={(person) => setDialog({ type: "renew", person })}
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
            notify(message);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "handover" && (
        <HandoverDialog onClose={() => setDialog(null)} onChanged={refresh} />
      )}
      {dialog?.type === "edit" && (
        <EditDialog
          person={dialog.person}
          checkItems={[]}
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

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
