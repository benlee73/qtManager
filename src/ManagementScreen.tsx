import { useCallback, useEffect, useState, type ReactNode } from "react";

import { EditDialog, RegisterDialog, RenewDialog } from "./Phase3Dialogs";
import { ApplicationImportDialog } from "./ApplicationImportDialog";
import type { Issue } from "./phase2";
import {
  type PeopleManagement,
  type PersonDetail,
  loadManagement,
  loadPersonDetail,
  setPersonArchived,
} from "./phase3";

type ManagementDialog =
  | { type: "register" }
  | { type: "applications" }
  | { type: "edit"; person: PersonDetail }
  | { type: "renew"; person: PersonDetail }
  | null;

export function ManagementScreen({ issue }: { issue: Issue }) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [management, setManagement] = useState<PeopleManagement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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
      setError(errorMessage(reason));
    }
  }, [includeArchived, query, selectedId]);

  useEffect(() => {
    const timeout = window.setTimeout(refresh, 70);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function selectPerson(id: string) {
    setSelectedId(id);
    try {
      setDetail(await loadPersonDetail(id));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function mutate(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      setDialog(null);
      setNotice(success);
      await refresh();
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
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
            className="secondary-button"
            data-testid="open-application-import"
            type="button"
            onClick={() => setDialog({ type: "applications" })}
          >
            Google 응답 붙여넣기
          </button>
          <button
            className="primary-button"
            data-testid="open-register-person"
            type="button"
            onClick={() => setDialog({ type: "register" })}
          >
            + QT 신청자 정식 등록
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
          <div className="management-person-list">
            {management?.people.map((person) => (
              <button
                key={person.id}
                type="button"
                className={person.id === selectedId ? "selected" : ""}
                data-testid="management-person"
                onClick={() => void selectPerson(person.id)}
              >
                <span className="cohort">{person.cohort ?? "--"}</span>
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    {person.phone ?? "연락처 없음"} · {person.status} · 구독{" "}
                    {person.subscriptionCount}건
                  </small>
                </span>
                {person.latestLastIssue && (
                  <em>{person.latestLastIssue}까지</em>
                )}
              </button>
            ))}
            {management?.people.length === 0 && (
              <div className="management-empty">
                조건에 맞는 신청자가 없습니다.
              </div>
            )}
          </div>
        </div>

        <div className="person-detail-panel" data-testid="person-detail">
          {detail ? (
            <>
              <div className="detail-heading">
                <div className="identity large">
                  <span className="cohort">{detail.cohort ?? "--"}</span>
                  <div>
                    <h2>{detail.name}</h2>
                    <p>
                      {detail.phone || "연락처 없음"} · {detail.status}
                    </p>
                  </div>
                </div>
                <div className="detail-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDialog({ type: "edit", person: detail })}
                  >
                    정보 수정
                  </button>
                  {detail.status !== "보관됨" && (
                    <button
                      className="primary-button"
                      data-testid="open-renew"
                      type="button"
                      onClick={() =>
                        setDialog({ type: "renew", person: detail })
                      }
                    >
                      구독 추가·갱신
                    </button>
                  )}
                </div>
              </div>

              {detail.personNote && (
                <div className="person-note">
                  <strong>신청자 메모</strong>
                  <p>{detail.personNote}</p>
                </div>
              )}

              <DetailSection
                title={`구독 이력 ${detail.subscriptions.length}건`}
              >
                <div className="history-list">
                  {detail.subscriptions.map((subscription) => (
                    <article key={subscription.id}>
                      <div>
                        <strong>
                          {subscription.startIssue} → {subscription.lastIssue}
                        </strong>
                        <p>
                          매 호 {subscription.quantity}권 ·{" "}
                          {subscription.source}
                          {subscription.appliedAt
                            ? ` · 신청 ${subscription.appliedAt}`
                            : ""}
                        </p>
                      </div>
                      <span>
                        {subscription.archived ? "보관됨" : "연속 6개 호"}
                      </span>
                      {subscription.memo && <small>{subscription.memo}</small>}
                    </article>
                  ))}
                  {detail.subscriptions.length === 0 && (
                    <p>등록된 구독이 없습니다.</p>
                  )}
                </div>
              </DetailSection>

              <DetailSection
                title={`배부 이력 ${detail.distributions.length}건`}
              >
                <div className="distribution-history">
                  {detail.distributions.map((distribution, index) => (
                    <div key={`${distribution.distributedAt}-${index}`}>
                      <strong>{distribution.issue}</strong>
                      <span>
                        {distribution.reversed ? "취소" : "배부"}{" "}
                        {distribution.quantity}권
                      </span>
                      <time>{displayDate(distribution.distributedAt)}</time>
                    </div>
                  ))}
                  {detail.distributions.length === 0 && (
                    <p>배부 이력이 없습니다.</p>
                  )}
                </div>
              </DetailSection>

              <button
                className="danger-link"
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      setPersonArchived(detail.id, detail.status !== "보관됨"),
                    detail.status === "보관됨"
                      ? "QT 신청자를 일반 목록으로 복원했습니다."
                      : "QT 신청자를 보관했습니다.",
                  )
                }
              >
                {detail.status === "보관됨" ? "보관 해제" : "이 신청자 보관"}
              </button>
            </>
          ) : (
            <div className="detail-empty">
              <span aria-hidden="true">👤</span>
              <h3>신청자를 선택하세요</h3>
              <p>연락처, 구독과 배부 이력을 한 화면에서 확인할 수 있습니다.</p>
            </div>
          )}
        </div>
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
            setNotice(message);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "edit" && (
        <EditDialog
          person={dialog.person}
          busy={busy}
          onClose={() => setDialog(null)}
          onSaved={(work) => mutate(work, "QT 신청자 정보를 수정했습니다.")}
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

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function displayDate(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
