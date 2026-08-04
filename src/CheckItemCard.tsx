import type { CheckItemView } from "./phase2";

export function CheckItemCard({
  item,
  busy,
  onToggle,
  onArchive,
  onDelete,
  onOpenDetail,
}: {
  item: CheckItemView;
  busy: boolean;
  onToggle: (checked: boolean) => void;
  onArchive: () => void;
  onDelete: () => void;
  onOpenDetail: () => void;
}) {
  const checked = item.status === "확인 완료";

  return (
    <article
      className={`check-item ${checked ? "checked" : ""}`}
      data-item-id={item.id}
    >
      <div className="check-item-main">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`${item.summary} 확인 완료`}
          disabled={busy}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <button
          className="check-item-summary"
          data-testid="open-check-item-detail"
          type="button"
          title="확인할 일 전문 보기"
          aria-label="확인할 일 전문 보기"
          onClick={onOpenDetail}
        >
          <p>{item.summary}</p>
        </button>
      </div>
      <div>
        <small>
          <b>{item.personName ?? "일반"}</b>
        </small>
        <span className="check-item-actions">
          <button
            className="check-item-detail-link"
            type="button"
            aria-label="확인할 일 전문 보기"
            onClick={onOpenDetail}
          >
            전문 보기
          </button>
          <button
            type="button"
            aria-label="확인할 일 보관"
            disabled={busy}
            onClick={onArchive}
          >
            보관
          </button>
          <button
            type="button"
            aria-label="확인할 일 삭제"
            disabled={busy}
            onClick={onDelete}
          >
            삭제
          </button>
        </span>
      </div>
    </article>
  );
}
