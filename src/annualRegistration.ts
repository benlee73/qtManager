import { invoke } from "@tauri-apps/api/core";
import type { Issue } from "./phase2";
import type { DraftInput } from "./draftValidation";
export type AnnualIntakeResult = {
  personId: string;
  subscriptionId: string;
  distributed: boolean;
};
export function saveAnnualSubscription(
  issue: Issue,
  input: DraftInput,
  existingPersonId: string | null,
  confirmOverlap: boolean,
  options: {
    requestId?: string;
    deskIssue?: Issue;
    distribute?: boolean;
    confirmedMemoRevisions?: string[];
  } = {},
) {
  const desk = options.deskIssue ?? issue;
  return invoke<AnnualIntakeResult>("annual_intake_command", {
    request: {
      requestId: options.requestId ?? null,
      personId: existingPersonId,
      name: input.name,
      cohort: input.cohortNotApplicable ? null : input.cohort || null,
      cohortNotApplicable: input.cohortNotApplicable ?? false,
      phone: input.phone || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      deskYear: desk.year,
      deskMonth: desk.startMonth,
      quantity: input.quantity,
      appliedAt: input.appliedAt || null,
      memo: input.memo || null,
      confirmOverlap,
      distribute: options.distribute ?? false,
      confirmedMemoRevisions: options.confirmedMemoRevisions ?? [],
    },
  });
}
