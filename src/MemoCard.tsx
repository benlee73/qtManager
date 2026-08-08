import type { MemoView } from "./phase2";

export function MemoCard({
  memo,
  onOpenDetail,
}: {
  memo: MemoView;
  onOpenDetail: (memo: MemoView) => void;
}) {
  return (
    <button
      type="button"
      className="memo-card"
      data-testid="memo-card"
      data-memo-id={memo.id}
      onClick={() => onOpenDetail(memo)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpenDetail(memo);
      }}
      title="클릭하면 메모 상세를 엽니다"
    >
      <span className="memo-card-content">{memo.content}</span>
      {memo.personName && (
        <span className="memo-card-person">{memo.personName}</span>
      )}
    </button>
  );
}
