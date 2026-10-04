import type { MemoView } from "./phase2";

export function DistributionMemoNotice({ memos }: { memos: MemoView[] }) {
  if (memos.length === 0) return null;
  return (
    <section
      className="distribution-memos"
      data-testid="distribution-memos"
      aria-label="배부 전 확인할 메모"
    >
      <p className="dialog-description">메모를 읽고 배부를 진행해 주세요.</p>
      <div className="distribution-memo-list">
        {memos.map((memo) => (
          <p key={memo.id}>{memo.content}</p>
        ))}
      </div>
    </section>
  );
}
