import type { PersonDetail } from "./phase3";

export type CorrectionTarget =
  | { kind: "annual"; value: PersonDetail["subscriptions"][number] }
  | { kind: "purchase"; value: NonNullable<PersonDetail["purchases"]>[number] };

// Hidden metadata belongs to the original record, not to this correction form.
export function buildCorrectionRequest(
  personId: string,
  target: CorrectionTarget,
  fields: { issueYear: number; issueMonth: number; quantity: number },
  confirmConflicts = false,
) {
  if (!target.value.id || !target.value.revision)
    throw new Error("구독 이력을 다시 불러온 뒤 수정해 주세요.");
  const base = { personId, expectedRevision: target.value.revision, ...fields };
  if (target.kind === "annual")
    return {
      kind: "annual" as const,
      request: {
        ...base,
        subscriptionId: target.value.id,
        appliedAt: target.value.appliedAt,
        memo: target.value.memo,
        confirmConflicts,
      },
    };
  return {
    kind: "purchase" as const,
    request: {
      ...base,
      purchaseId: target.value.id,
      purchasedAt: target.value.purchasedAt,
      note: target.value.note ?? null,
    },
  };
}
