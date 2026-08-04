import type { ReactNode } from "react";

import type {
  PersonDetail,
  PersonSummary,
  SubscriptionPeriodState,
} from "./phase3";

const subscriptionStateLabels: Record<SubscriptionPeriodState, string> = {
  current: "현재 구독",
  scheduled: "예정 구독",
  past: "지난 구독",
  archived: "보관된 구독",
};

export function ManagementPersonList({
  people,
  selectedId,
  onSelect,
}: {
  people: PersonSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="management-person-list">
      {people.map((person) => {
        const selected = person.id === selectedId;
        const periodSummary = person.latestLastIssue
          ? `${person.latestLastIssue}까지`
          : "구독 종료 호 정보 없음";
        const contextSummary = `${person.status} · 구독 ${person.subscriptionCount}건 · ${periodSummary}`;
        const accessibleLabel = `${person.cohort ?? "또래 정보 없음"} ${person.name} · ${contextSummary}`;
        const statusMarker =
          person.status === "정보 보완 필요"
            ? { className: "draft", label: "정보 보완 필요" }
            : person.status === "보관됨"
              ? { className: "archived", label: "보관됨" }
              : null;
        return (
          <button
            key={person.id}
            type="button"
            className={
              selected
                ? "management-person-row selected"
                : "management-person-row"
            }
            data-testid="management-person"
            aria-pressed={selected}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={() => onSelect(person.id)}
          >
            <span className="cohort">{person.cohort ?? "--"}</span>
            <span className="management-person-copy">
              <span
                className="management-person-primary"
                data-testid="management-person-primary"
                title={person.name}
              >
                {statusMarker && (
                  <span
                    className={`management-person-status-marker ${statusMarker.className}`}
                    data-testid="management-person-status-marker"
                    role="img"
                    aria-label={statusMarker.label}
                    title={statusMarker.label}
                  />
                )}
                <strong>{person.name}</strong>
              </span>
            </span>
          </button>
        );
      })}
      {people.length === 0 && (
        <div className="management-empty">조건에 맞는 신청자가 없습니다.</div>
      )}
    </div>
  );
}

export function PersonDetailPanel({
  detail,
  busy,
  onEdit,
  onRenew,
  onToggleArchived,
}: {
  detail: PersonDetail | null;
  busy: boolean;
  onEdit: (detail: PersonDetail) => void;
  onRenew: (detail: PersonDetail) => void;
  onToggleArchived: (detail: PersonDetail) => void;
}) {
  if (!detail) {
    return (
      <div className="person-detail-panel" data-testid="person-detail">
        <div className="detail-empty">
          <span aria-hidden="true">👤</span>
          <h3>신청자를 선택하세요</h3>
          <p>연락처, 구독과 배부 이력을 한 화면에서 확인할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="person-detail-panel" data-testid="person-detail">
      <div className="detail-heading">
        <div className="identity large" data-testid="person-identity">
          <span className="cohort" data-testid="person-cohort">
            {detail.cohort ?? "--"}
          </span>
          <div>
            <h2 data-testid="person-name" title={detail.name}>
              {detail.name}
            </h2>
            <p title={detail.phone || "연락처 없음"}>
              {detail.phone || "연락처 없음"} · {detail.status}
            </p>
          </div>
        </div>
        <div className="detail-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => onEdit(detail)}
          >
            정보 수정
          </button>
          {detail.status !== "보관됨" && (
            <button
              className="primary-button"
              data-testid="open-renew"
              type="button"
              onClick={() => onRenew(detail)}
            >
              구독 추가·갱신
            </button>
          )}
        </div>
      </div>

      <div className="person-note" data-testid="person-note">
        <strong>신청자 메모</strong>
        <p title={detail.personNote ?? undefined}>
          {detail.personNote || "등록된 신청자 메모가 없습니다."}
        </p>
      </div>

      <DetailSection title={`연결된 확인할 일 ${detail.checkItems.length}건`}>
        <div
          className="detail-linked-check-items"
          data-testid="linked-check-items"
        >
          {detail.checkItems.map((item) => {
            const checked = item.status === "확인 완료";
            return (
              <article className={checked ? "checked" : ""} key={item.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled
                  readOnly
                  aria-label={`${item.summary} · ${item.status}`}
                />
                <div>
                  <strong>{item.status}</strong>
                  <p title={item.summary}>{item.summary}</p>
                </div>
              </article>
            );
          })}
          {detail.checkItems.length === 0 && (
            <p>연결된 확인할 일이 없습니다.</p>
          )}
        </div>
      </DetailSection>

      <DetailSection title={`구독 이력 ${detail.subscriptions.length}건`}>
        <div className="history-list">
          {detail.subscriptions.map((subscription) => (
            <article
              className={`subscription-card subscription-${subscription.periodState}`}
              data-testid={`subscription-${subscription.periodState}`}
              key={subscription.id}
            >
              <div>
                <strong
                  title={`${subscription.startIssue} → ${subscription.lastIssue}`}
                >
                  {subscription.startIssue} → {subscription.lastIssue}
                </strong>
                <p>
                  매 호{" "}
                  <span className="numeric">{subscription.quantity}권</span> ·{" "}
                  {subscription.source}
                  {subscription.appliedAt
                    ? ` · 신청 ${subscription.appliedAt}`
                    : ""}
                </p>
              </div>
              <span className="subscription-state">
                {subscriptionStateLabels[subscription.periodState]}
              </span>
              {subscription.memo && (
                <small title={subscription.memo}>{subscription.memo}</small>
              )}
            </article>
          ))}
          {detail.subscriptions.length === 0 && <p>등록된 구독이 없습니다.</p>}
        </div>
      </DetailSection>

      <DetailSection title={`배부 이력 ${detail.distributions.length}건`}>
        <div className="distribution-history">
          <div
            className="distribution-history-header"
            data-testid="distribution-history-header"
          >
            <strong>배부 호</strong>
            <strong>처리</strong>
            <strong>처리 시각</strong>
          </div>
          {detail.distributions.map((distribution, index) => (
            <div
              className="distribution-history-row"
              key={`${distribution.distributedAt}-${index}`}
            >
              <strong title={distribution.issue}>{distribution.issue}</strong>
              <span className="distribution-history-quantity">
                {distribution.reversed ? "취소" : "배부"}{" "}
                {distribution.quantity}권
              </span>
              <time
                className="distribution-history-time"
                dateTime={distribution.distributedAt}
                title={distribution.distributedAt}
              >
                {displayDate(distribution.distributedAt)}
              </time>
            </div>
          ))}
          {detail.distributions.length === 0 && <p>배부 이력이 없습니다.</p>}
        </div>
      </DetailSection>

      <button
        className="danger-link"
        type="button"
        disabled={busy}
        onClick={() => onToggleArchived(detail)}
      >
        {detail.status === "보관됨" ? "보관 해제" : "이 신청자 보관"}
      </button>
    </div>
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
