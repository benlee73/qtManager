import type { MemoView } from "./phase2";

export function MemoArchiveDialog({
  memos,
  busy,
  onClose,
  onOpen,
  onRestore,
  onDelete,
}: {
  memos: MemoView[];
  busy: boolean;
  onClose: () => void;
  onOpen: (memo: MemoView) => void;
  onRestore: (memo: MemoView) => void;
  onDelete: (memo: MemoView) => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog memo-archive-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-archive-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="memo-archive-title">메모 보관함</h2>
            <p>보관한 메모는 필요할 때 다시 활성화할 수 있습니다.</p>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="memo-archive-list">
          {memos.map((memo) => (
            <article key={memo.id} className="memo-archive-row">
              <button
                type="button"
                className="memo-archive-content"
                onDoubleClick={() => onOpen(memo)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onOpen(memo);
                }}
              >
                <span>{memo.content}</span>
                {memo.personName && <small>{memo.personName}</small>}
              </button>
              <div className="memo-archive-actions">
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy}
                  onClick={() => onRestore(memo)}
                >
                  복원
                </button>
                <button
                  type="button"
                  className="danger-link-button"
                  disabled={busy}
                  onClick={() => onDelete(memo)}
                >
                  삭제
                </button>
              </div>
            </article>
          ))}
          {memos.length === 0 && (
            <p className="archive-empty">보관한 메모가 없습니다.</p>
          )}
        </div>
      </section>
    </div>
  );
}
