import { createDraft, type Issue } from "./phase2";
import { renewSubscription } from "./phase3";
import type { DraftInput } from "./draftValidation";

export function saveAnnualSubscription(
  issue: Issue,
  input: DraftInput,
  existingPersonId: string | null,
  confirmOverlap: boolean,
) {
  return existingPersonId
    ? renewSubscription(existingPersonId, issue, {
        quantity: input.quantity,
        appliedAt: "",
        memo: input.memo ?? "",
        confirmOverlap,
      })
    : createDraft(issue, input);
}
