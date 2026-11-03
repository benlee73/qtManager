import type { ReversibleAction } from "./actionHistory";
import {
  changeDeliveryHistoryRecord,
  type DeliveryHistoryChange,
} from "./phase3";
export function deliveryHistoryAction(
  personId: string,
  deletion: DeliveryHistoryChange,
): ReversibleAction {
  let current = deletion;
  return {
    description: "배부 이력 삭제",
    undo: async () => {
      current = await changeDeliveryHistoryRecord(
        personId,
        current.kind,
        current.recordId,
        current.purchaseId,
        true,
      );
    },
    redo: async () => {
      current = await changeDeliveryHistoryRecord(
        personId,
        current.kind,
        current.recordId,
        current.purchaseId,
        false,
      );
    },
  };
}
