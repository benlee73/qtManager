import { useState } from "react";

import type { CheckItemView } from "./phase2";

export type EditableCheckItem = Pick<
  CheckItemView,
  "id" | "summary" | "status"
>;

type LinkedCheckItemsEditorProps = {
  items: EditableCheckItem[];
  busy: boolean;
  onUpdate?: (item: EditableCheckItem, content: string) => Promise<boolean>;
  onToggle?: (item: EditableCheckItem, checked: boolean) => Promise<boolean>;
  onArchive?: (item: EditableCheckItem) => Promise<boolean>;
  onDelete?: (item: EditableCheckItem) => void;
  className?: string;
  testId?: string;
};

/**
 * 신청자에 연결된 확인할 일은 배부 화면과 신청자 관리 화면에서 같은
 * 상태 전이와 편집 규칙을 사용한다. 저장소 동작은 상위 계층이 담당하고
 * 이 컴포넌트는 편집 초안과 삭제 확인처럼 화면 상태만 관리한다.
 */
export function LinkedCheckItemsEditor({
  items,
  busy,
  onUpdate,
  onToggle,
  onArchive,
  onDelete,
  className = "linked-check-items-editor",
  testId,
}: LinkedCheckItemsEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const editable = Boolean(onUpdate || onToggle || onArchive || onDelete);

  return (
    <div className={className} data-testid={testId}>
      {items.map((item) => {
        const checked = item.status === "확인 완료";
        const editing = editingId === item.id;
        const confirmingDelete = deleteId === item.id;
        return (
          <article
            className={
              checked ? "linked-check-item checked" : "linked-check-item"
            }
            key={item.id}
            data-check-item-id={item.id}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || !onToggle}
              aria-label={`${item.summary} 확인 완료`}
              onChange={(event) => {
                if (onToggle) void onToggle(item, event.target.checked);
              }}
            />
            <div className="linked-check-item-content">
              <div className="linked-check-item-status">
                <strong>{item.status}</strong>
              </div>
              {editing ? (
                <textarea
                  className="linked-check-item-editor"
                  data-testid="edit-linked-check-item"
                  value={draft}
                  rows={3}
                  autoFocus
                  disabled={busy}
                  aria-label="확인할 일 내용"
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <p title={item.summary}>{item.summary}</p>
              )}
              {editable && (
                <div className="linked-check-item-actions">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        disabled={busy || !draft.trim()}
                        onClick={() => {
                          if (!onUpdate || !draft.trim()) return;
                          void onUpdate(item, draft.trim()).then((saved) => {
                            if (saved) {
                              setEditingId(null);
                              setDraft("");
                            }
                          });
                        }}
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setDraft("");
                        }}
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      {onUpdate && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label="연결된 확인할 일 수정"
                          onClick={() => {
                            setEditingId(item.id);
                            setDraft(item.summary);
                            setDeleteId(null);
                          }}
                        >
                          수정
                        </button>
                      )}
                      {onArchive && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label="연결된 확인할 일 보관"
                          onClick={() => void onArchive(item)}
                        >
                          보관
                        </button>
                      )}
                      {onDelete &&
                        (confirmingDelete ? (
                          <span className="linked-check-item-delete-confirm">
                            <span>삭제할까요?</span>
                            <button
                              className="danger-button"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                onDelete(item);
                                setDeleteId(null);
                              }}
                            >
                              삭제
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDeleteId(null)}
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            className="danger-link-button"
                            type="button"
                            disabled={busy}
                            aria-label="연결된 확인할 일 삭제"
                            onClick={() => {
                              setDeleteId(item.id);
                              setEditingId(null);
                            }}
                          >
                            삭제
                          </button>
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
