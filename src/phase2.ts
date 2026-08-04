import { invoke } from "@tauri-apps/api/core";

export type Issue = {
  year: number;
  startMonth: number;
};

export type DistributionAllocation = {
  subscriptionId: string;
  quantity: number;
};

export type IssueView = Issue & {
  label: string;
};

export type DeskPerson = {
  personId: string;
  subscriptionId: string | null;
  distributionTargets: {
    subscriptionId: string;
    startIssue: string;
    lastIssue: string;
    endDate: string;
    targetQuantity: number;
    distributedQuantity: number;
    remainingQuantity: number;
  }[];
  name: string;
  cohort: string | null;
  phone: string | null;
  personStatus: string;
  subscriptionStatus: string;
  distributionStatus: string;
  targetQuantity: number;
  distributedQuantity: number;
  remainingQuantity: number;
  lastIssue: string | null;
  endDate: string | null;
  isLastIssue: boolean;
  hasCheckItem: boolean;
  canDistribute: boolean;
};

export async function distributePerson(
  issue: Issue,
  person: DeskPerson,
  quantity?: number,
) {
  let remaining = quantity ?? person.remainingQuantity;
  for (const target of person.distributionTargets) {
    const amount = Math.min(target.remainingQuantity, remaining);
    if (amount > 0) await distribute(issue, target.subscriptionId, amount);
    remaining -= amount;
    if (remaining === 0) return;
  }
}

export async function distributeAllocations(
  issue: Issue,
  allocations: DistributionAllocation[],
) {
  for (const allocation of allocations)
    await distribute(issue, allocation.subscriptionId, allocation.quantity);
}

export async function undoDistributionAllocations(
  issue: Issue,
  allocations: DistributionAllocation[],
) {
  for (const allocation of [...allocations].reverse())
    await undoDistribution(issue, allocation.subscriptionId);
}

export async function cancelPersonDistribution(
  issue: Issue,
  person: DeskPerson,
) {
  const cancelled: DistributionAllocation[] = [];
  for (const target of person.distributionTargets) {
    if (target.distributedQuantity > 0)
      cancelled.push(await undoDistribution(issue, target.subscriptionId));
  }
  return cancelled;
}

export type CheckItemView = {
  id: string;
  personId: string | null;
  summary: string;
  operatorName: string;
  updatedAt: string;
  status: "확인 필요" | "확인 완료" | "보관";
  personName: string | null;
};

export type PinnedNoteView = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
};

export type DistributionDesk = {
  selectedIssue: IssueView;
  recommendedIssue: IssueView;
  operatorName: string | null;
  totals: {
    targetPeople: number;
    completedPeople: number;
    remainingPeople: number;
    targetQuantity: number;
    distributedQuantity: number;
    remainingQuantity: number;
  };
  people: DeskPerson[];
  checkItems: CheckItemView[];
  pinnedNotes: PinnedNoteView[];
  archivedCheckItems: CheckItemView[];
  archivedPinnedNotes: PinnedNoteView[];
  purchaseCount: number;
  purchasedQuantity: number;
  canUndoDistribution: boolean;
};

export function recommendedIssue(date = new Date()): Issue {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month === 12) return { year: year + 1, startMonth: 1 };
  if (month === 2) return { year, startMonth: 3 };
  return {
    year,
    startMonth: month % 2 === 0 ? month + 1 : month,
  };
}

export function moveIssue(issue: Issue, amount: -1 | 1): Issue {
  const index = (issue.startMonth - 1) / 2 + amount;
  if (index < 0) return { year: issue.year - 1, startMonth: 11 };
  if (index > 5) return { year: issue.year + 1, startMonth: 1 };
  return { year: issue.year, startMonth: index * 2 + 1 };
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function loadDesk(issue: Issue, query: string, showAll = false) {
  return invoke<DistributionDesk>("load_distribution_desk_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
    query,
    showAll,
  });
}

export function setOperator(name: string) {
  return invoke<void>("save_operator_command", { name });
}

export function distribute(
  issue: Issue,
  subscriptionId: string,
  quantity?: number,
) {
  return invoke<void>("record_distribution_command", {
    request: {
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      subscriptionId,
      quantity: quantity ?? null,
      note: null,
    },
  });
}

export function undoDistribution(issue: Issue, subscriptionId?: string) {
  return invoke<DistributionAllocation>("undo_distribution_command", {
    request: {
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      subscriptionId: subscriptionId ?? null,
    },
  });
}

export function createDraft(
  issue: Issue,
  input: { name: string; cohort: string; phone: string; quantity: number },
) {
  return invoke<void>("create_draft_command", {
    request: {
      name: input.name,
      cohort: input.cohort || null,
      phone: input.phone || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
    },
  });
}

export function createCheckItem(personId: string | null, content: string) {
  return invoke<string>("create_check_item_command", {
    request: { personId, content },
  });
}

export function updateCheckItemStatus(
  id: string,
  status: "needs_check" | "checked" | "archived",
) {
  return invoke<void>("update_check_item_status_command", {
    request: { id, status },
  });
}

export function updateCheckItem(id: string, content: string) {
  return invoke<void>("update_check_item_command", {
    request: { id, content },
  });
}

export function deleteCheckItem(id: string) {
  return invoke<void>("delete_check_item_command", { id });
}

export function createPinnedNote(input: {
  title: string;
  content: string;
  isPinned: boolean;
}) {
  return invoke<string>("create_pinned_note_command", {
    request: {
      title: input.title,
      content: input.content,
      isPinned: input.isPinned,
    },
  });
}

export function updatePinnedNote(
  id: string,
  input: { isPinned?: boolean; archived?: boolean },
) {
  return invoke<void>("update_pinned_note_command", {
    request: {
      id,
      isPinned: input.isPinned ?? null,
      archived: input.archived ?? null,
    },
  });
}

export function deletePinnedNote(id: string) {
  return invoke<void>("delete_pinned_note_command", { id });
}

export function recordPurchase(
  issue: Issue,
  input: { buyerName: string; quantity: number; note: string },
) {
  return invoke<void>("record_purchase_command", {
    request: {
      personId: null,
      buyerName: input.buyerName || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      note: input.note || null,
    },
  });
}

export function cancelLatestPurchase(issue: Issue) {
  return invoke<void>("cancel_latest_purchase_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
  });
}
