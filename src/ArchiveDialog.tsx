import { useEffect, type ReactNode } from "react";

import type { ReversibleAction } from "./actionHistory";
import type { CheckItemView, PinnedNoteView } from "./phase2";
import { updateCheckItemStatus, updatePinnedNote } from "./phase2";

export function ArchiveDialog({
  checkItems,
  pinnedNotes,
  busy,
  onClose,
  mutate,
  recordAction,
}: {
  checkItems: CheckItemView[];
  pinnedNotes: PinnedNoteView[];
  busy: boolean;
  onClose: () => void;
  mutate: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  recordAction: (action: ReversibleAction) => void;
}) {
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog archive-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="archive-dialog-title">보관함</h2>
            <p>보관한 확인할 일과 고정 메모를 다시 복원할 수 있습니다.</p>
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="archive-columns">
          <ArchiveSection title={`확인할 일 ${checkItems.length}건`}>
            {checkItems.map((item) => (
              <article key={item.id}>
                <p title={item.summary}>{item.summary}</p>
                <small>{item.personName ?? "일반"}</small>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void mutate(
                      () => updateCheckItemStatus(item.id, "needs_check"),
                      "확인할 일을 복원했습니다.",
                    ).then((saved) => {
                      if (saved) {
                        recordAction({
                          description: "확인할 일 복원",
                          undo: () =>
                            updateCheckItemStatus(item.id, "archived"),
                          redo: () =>
                            updateCheckItemStatus(item.id, "needs_check"),
                        });
                      }
                    });
                  }}
                >
                  복원
                </button>
              </article>
            ))}
            {checkItems.length === 0 && (
              <p className="archive-empty">비어 있습니다.</p>
            )}
          </ArchiveSection>
          <ArchiveSection title={`고정 메모 ${pinnedNotes.length}건`}>
            {pinnedNotes.map((note) => (
              <article key={note.id}>
                <p title={note.title}>{note.title}</p>
                <small title={note.content}>{note.content}</small>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void mutate(
                      () => updatePinnedNote(note.id, { archived: false }),
                      "고정 메모를 복원했습니다.",
                    ).then((saved) => {
                      if (saved) {
                        recordAction({
                          description: "고정 메모 복원",
                          undo: () =>
                            updatePinnedNote(note.id, { archived: true }),
                          redo: () =>
                            updatePinnedNote(note.id, { archived: false }),
                        });
                      }
                    });
                  }}
                >
                  복원
                </button>
              </article>
            ))}
            {pinnedNotes.length === 0 && (
              <p className="archive-empty">비어 있습니다.</p>
            )}
          </ArchiveSection>
        </div>
      </section>
    </div>
  );
}

function ArchiveSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}
