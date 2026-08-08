import { type KeyboardEvent, type ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTextDraft } from "./drafts";
import { listIndexAfterKey, shouldReturnToSearch } from "./keyboardNavigation";

import type {
  LinkedMemo,
  PersonDetail,
  PersonSummary,
  SubscriptionPeriodState,
} from "./phase3";
import { MemoDetailDialog } from "./MemoDetailDialog";
import { formatApplicationDate } from "./dateFormat";

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
  onReturnToSearch,
}: {
  people: PersonSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReturnToSearch?: () => void;
}) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    const nextId = pendingFocusId.current;
    if (!nextId || selectedId !== nextId) return;
    pendingFocusId.current = null;
    const row = rowRefs.current.get(nextId);
    row?.focus();
    requestAnimationFrame(() => rowRefs.current.get(nextId)?.focus());
  }, [people, selectedId]);

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLButtonElement>(
      '[data-testid="management-person"]',
    );
    const currentId = row?.dataset.personId ?? selectedId;
    if (!currentId) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      (row ?? (document.activeElement as HTMLElement | null))?.blur();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const currentIndex = people.findIndex(
      (candidate) => candidate.id === currentId,
    );
    if (currentIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowDown" ? "down" : "up";
    if (shouldReturnToSearch(people.length, currentIndex, direction)) {
      row?.blur();
      onReturnToSearch?.();
      return;
    }
    const nextIndex = listIndexAfterKey(people.length, currentIndex, direction);
    if (nextIndex === null || nextIndex === currentIndex) {
      // At either end, consume the key without allowing the scroll container
      // or the browser's button focus ring to move. Keep the row focused so
      // the opposite arrow still navigates from the same applicant.
      row?.focus();
      return;
    }
    const nextPerson = people[nextIndex];
    pendingFocusId.current = nextPerson.id;
    onSelect(nextPerson.id);
    const focusNextRow = () => rowRefs.current.get(nextPerson.id)?.focus();
    focusNextRow();
    requestAnimationFrame(focusNextRow);
  };

  return (
    <div className="management-person-list" onKeyDown={handleListKeyDown}>
      {people.map((person) => {
        const selected = person.id === selectedId;
        const periodSummary = person.latestLastIssue
          ? `${person.latestLastIssue}까지`
          : "구독 종료 호 정보 없음";
        const statusSummary =
          person.status === "정식 등록" ? "" : `${person.status} · `;
        const contextSummary = `${statusSummary}구독 ${person.subscriptionCount}건 · ${periodSummary}`;
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
            data-person-id={person.id}
            aria-pressed={selected}
            aria-label={accessibleLabel}
            title={accessibleLabel}
            ref={(element) => {
              if (element) rowRefs.current.set(person.id, element);
              else rowRefs.current.delete(person.id);
            }}
            onClick={(event) => {
              onSelect(person.id);
              // WebKit can leave focus on the document after a mouse click
              // when the detail pane is updated asynchronously. Keep the
              // clicked row as the keyboard anchor so the next ArrowUp/Down
              // moves through applicants instead of scrolling the panel.
              event.currentTarget.focus();
            }}
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

export type PersonDetailPanelProps = {
  detail: PersonDetail | null;
  busy: boolean;
  onEdit: (detail: PersonDetail) => void;
  onRenew: (detail: PersonDetail) => void;
  onToggleArchived: (detail: PersonDetail) => void;
  onCreateMemo?: (personId: string, content: string) => Promise<boolean>;
  onUpdateMemo?: (memo: LinkedMemo, content: string) => Promise<boolean>;
  onArchiveMemo?: (memo: LinkedMemo, archived: boolean) => Promise<boolean>;
  onDeleteMemo?: (memo: LinkedMemo) => void | Promise<boolean>;
  onDelete?: (detail: PersonDetail) => void | Promise<boolean>;
};

export function PersonDetailPanel(props: PersonDetailPanelProps) {
  if (!props.detail) {
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

  const detailKey = `${props.detail.id}:${(props.detail.memos ?? []).map((memo) => `${memo.id}:${memo.updatedAt}`).join("|")}:${(props.detail.purchases ?? []).map((purchase) => `${purchase.issue}:${purchase.purchasedAt}:${purchase.reversed}`).join("|")}`;
  return (
    <PersonDetailContent key={detailKey} {...props} detail={props.detail} />
  );
}

type PersonDetailContentProps = Omit<PersonDetailPanelProps, "detail"> & {
  detail: PersonDetail;
};

function PersonDetailContent({
  detail,
  busy,
  onEdit,
  onRenew,
  onToggleArchived,
  onCreateMemo,
  onUpdateMemo,
  onArchiveMemo,
  onDeleteMemo,
  onDelete,
}: PersonDetailContentProps) {
  const memoDraftState = useTextDraft(`person-memo:${detail.id}`);
  const memoDraft = memoDraftState.value;
  const setMemoDraft = memoDraftState.setValue;
  const [memoDetail, setMemoDetail] = useState<LinkedMemo | null>(null);
  const memos = detail.memos ?? [];

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
              {detail.phone || "연락처 없음"}
              {detail.status !== "정식 등록" && ` · ${detail.status}`}
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

      <DetailSection title={`메모 ${memos.length}건`}>
        <form
          className="detail-inline-form"
          data-testid="person-memo-form"
          onSubmit={(event) => {
            event.preventDefault();
            const content = memoDraft.trim();
            if (!content || busy || !onCreateMemo) return;
            void onCreateMemo(detail.id, content).then((saved) => {
              if (saved) memoDraftState.clear();
            });
          }}
        >
          <input
            data-testid="person-memo-input"
            value={memoDraft}
            onChange={(event) => setMemoDraft(event.target.value)}
            placeholder="이 사람에게만 적용되는 내용을 적으세요"
            aria-label="메모"
          />
          <button
            className="secondary-button compact"
            type="submit"
            disabled={busy || !memoDraft.trim() || !onCreateMemo}
          >
            추가
          </button>
        </form>
        <div className="detail-memo-list" data-testid="linked-memos">
          {memos.map((memo) => (
            <button
              className="detail-memo-card"
              type="button"
              key={memo.id}
              onClick={() => setMemoDetail(memo)}
            >
              {memo.content}
            </button>
          ))}
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
              <div className="subscription-period">
                <div>
                  <span>시작</span>
                  <strong title={subscription.startIssue}>
                    {subscription.startIssue}
                  </strong>
                </div>
                <div>
                  <span>끝</span>
                  <strong title={subscription.lastIssue}>
                    {subscription.lastIssue}
                  </strong>
                </div>
              </div>
              <div className="subscription-quantity numeric">
                {subscription.quantity}권
              </div>
              <span className="subscription-state">
                {subscriptionStateLabels[subscription.periodState]}
              </span>
              {subscription.appliedAt && (
                <p className="subscription-applied-at">
                  신청 {formatApplicationDate(subscription.appliedAt)}
                </p>
              )}
              {subscription.memo &&
                !isLegacyMigrationMemo(subscription.memo) && (
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

      <DetailSection
        title={`개별 구매 이력 ${(detail.purchases ?? []).length}건`}
      >
        <div className="purchase-history" data-testid="purchase-history">
          {(detail.purchases ?? []).map((purchase, index) => (
            <div
              className="purchase-history-row"
              key={`${purchase.issue}-${purchase.purchasedAt}-${index}`}
            >
              <strong title={purchase.issue}>{purchase.issue}</strong>
              <span>
                {purchase.reversed ? "취소" : "구매·전달"} {purchase.quantity}권
              </span>
              <time
                dateTime={purchase.purchasedAt}
                title={purchase.purchasedAt}
              >
                {displayDate(purchase.purchasedAt)}
              </time>
            </div>
          ))}
          {(detail.purchases ?? []).length === 0 && (
            <p>개별 구매 이력이 없습니다.</p>
          )}
        </div>
      </DetailSection>

      <div
        className="person-detail-footer-actions"
        data-testid="person-detail-actions"
      >
        <button
          className="person-detail-action person-detail-action-archive"
          data-testid="archive-person"
          type="button"
          disabled={busy}
          onClick={() => onToggleArchived(detail)}
        >
          {detail.status === "보관됨" ? "보관 해제" : "신청자 보관"}
        </button>
        {onDelete && (
          <button
            className="person-detail-action person-detail-action-delete"
            data-testid="delete-person"
            type="button"
            disabled={busy}
            title="구독·배부·개별 구매·메모 이력이 없는 신청자만 영구 삭제할 수 있습니다."
            onClick={() => void onDelete(detail)}
          >
            신청자 삭제
          </button>
        )}
      </div>
      {memoDetail && (
        <MemoDetailDialog
          memo={{
            id: memoDetail.id,
            personId: detail.id,
            content: memoDetail.content,
            operatorName: "",
            updatedAt: memoDetail.updatedAt,
            status: memoDetail.status,
            personName: detail.name,
          }}
          busy={busy}
          onClose={() => setMemoDetail(null)}
          onSave={(content) =>
            onUpdateMemo
              ? onUpdateMemo(memoDetail, content).then((saved) => {
                  if (saved) setMemoDetail(null);
                  return saved;
                })
              : Promise.resolve(false)
          }
          onArchive={(archived) =>
            onArchiveMemo
              ? onArchiveMemo(memoDetail, archived).then((saved) => {
                  if (saved) setMemoDetail(null);
                  return saved;
                })
              : Promise.resolve(false)
          }
          onDelete={() => {
            const result = onDeleteMemo?.(memoDetail);
            if (result instanceof Promise) {
              return result.then((saved) => {
                if (saved) setMemoDetail(null);
                return saved;
              });
            }
            return result;
          }}
        />
      )}
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

function isLegacyMigrationMemo(value: string) {
  return value.trim() === "2026년 기존 배부현황 최초 이전";
}
