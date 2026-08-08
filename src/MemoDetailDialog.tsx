import { useEffect, useState } from "react";

import type { MemoView } from "./phase2";

export function MemoDetailDialog({
  memo,
  busy,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: {
  memo: MemoView;
  busy: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<boolean>;
  onArchive: (archived: boolean) => Promise<boolean>;
  onDelete: () => void | Promise<boolean>;
}) {
  const [content, setContent] = useState(memo.content);
  const [editing, setEditing] = useState(false);
  const dirty = content.trim() !== memo.content.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (editing && dirty) {
          setContent(memo.content);
          setEditing(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, editing, memo.content, onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="dialog memo-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div className="memo-detail-title-line">
            <h2 id="memo-detail-title">메모</h2>
            {memo.personName && (
              <span className="memo-detail-person">{memo.personName}</span>
            )}
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        {editing ? (
          <textarea
            className="memo-detail-editor"
            aria-label="메모 내용"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            autoFocus
            rows={8}
          />
        ) : (
          <button
            type="button"
            className="memo-detail-content"
            aria-label="메모 본문. 눌러서 편집"
            onClick={() => setEditing(true)}
          >
            {memo.content}
          </button>
        )}
        <div className="memo-detail-actions">
          {dirty && (
            <button
              className="primary-button"
              type="button"
              disabled={busy || !content.trim()}
              onClick={() => {
                void onSave(content.trim()).then((saved) => {
                  if (saved) onClose();
                });
              }}
            >
              저장
            </button>
          )}
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void onArchive(memo.status === "활성")}
          >
            {memo.status === "활성" ? "보관" : "복원"}
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => {
              const deleted = onDelete();
              if (deleted instanceof Promise) {
                void deleted.then((succeeded) => {
                  if (succeeded) onClose();
                });
              }
            }}
          >
            삭제
          </button>
        </div>
      </section>
    </div>
  );
}
