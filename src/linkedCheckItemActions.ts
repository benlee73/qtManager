import type { ReversibleAction } from "./actionHistory";
import type { EditableCheckItem } from "./LinkedCheckItemsEditor";
import {
  deleteCheckItem,
  updateCheckItem,
  updateCheckItemStatus,
} from "./phase2";

type Mutation = (
  work: () => Promise<unknown>,
  success: string,
) => Promise<boolean>;

export function createLinkedCheckItemHandlers({
  mutate,
  recordAction,
  label = "연결된",
  onDeleted,
}: {
  mutate: Mutation;
  recordAction: (action: ReversibleAction) => void;
  label?: string;
  onDeleted?: () => void;
}) {
  return {
    onUpdateCheckItem: (item: EditableCheckItem, content: string) => {
      const previous = item.summary;
      return mutate(
        () => updateCheckItem(item.id, content),
        `${label} 확인할 일을 수정했습니다.`,
      ).then((saved) => {
        if (saved) {
          recordAction({
            description: `${label} 확인할 일 수정`,
            undo: () => updateCheckItem(item.id, previous),
            redo: () => updateCheckItem(item.id, content),
          });
        }
        return saved;
      });
    },
    onToggleCheckItem: (item: EditableCheckItem, checked: boolean) => {
      const previous = item.status === "확인 완료" ? "checked" : "needs_check";
      const next = checked ? "checked" : "needs_check";
      return mutate(
        () => updateCheckItemStatus(item.id, next),
        checked
          ? `${label} 확인할 일을 완료했습니다.`
          : `${label} 확인할 일을 다시 확인하도록 바꿨습니다.`,
      ).then((saved) => {
        if (saved) {
          recordAction({
            description: checked
              ? `${label} 확인할 일 완료`
              : `${label} 확인할 일 다시 열기`,
            undo: () => updateCheckItemStatus(item.id, previous),
            redo: () => updateCheckItemStatus(item.id, next),
          });
        }
        return saved;
      });
    },
    onArchiveCheckItem: (item: EditableCheckItem) => {
      const previous = item.status === "확인 완료" ? "checked" : "needs_check";
      return mutate(
        () => updateCheckItemStatus(item.id, "archived"),
        `${label} 확인할 일을 보관했습니다.`,
      ).then((saved) => {
        if (saved) {
          recordAction({
            description: `${label} 확인할 일 보관`,
            undo: () => updateCheckItemStatus(item.id, previous),
            redo: () => updateCheckItemStatus(item.id, "archived"),
          });
        }
        return saved;
      });
    },
    onDeleteCheckItem: (item: EditableCheckItem) => {
      void mutate(
        () => deleteCheckItem(item.id),
        `${label} 확인할 일을 삭제했습니다.`,
      ).then((saved) => {
        if (saved) onDeleted?.();
      });
    },
  };
}
