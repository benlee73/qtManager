import { invoke } from "@tauri-apps/api/core";

export type Issue = {
  year: number;
  startMonth: number;
};

export type IssueView = Issue & {
  label: string;
};

export type DeskPerson = {
  personId: string;
  subscriptionId: string | null;
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
  checkItems: {
    id: string;
    personId: string | null;
    summary: string;
    operatorName: string;
    updatedAt: string;
    status: "확인 필요" | "확인 완료" | "보관";
    personName: string | null;
  }[];
  pinnedNotes: {
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
  }[];
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

export function loadDesk(issue: Issue, query: string) {
  return invoke<DistributionDesk>("load_distribution_desk_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
    query,
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

export function undoDistribution(issue: Issue) {
  return invoke<void>("undo_distribution_command", {
    request: { issueYear: issue.year, issueMonth: issue.startMonth },
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
  return invoke<void>("create_check_item_command", {
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

export function createPinnedNote(input: {
  title: string;
  content: string;
  isPinned: boolean;
}) {
  return invoke<void>("create_pinned_note_command", {
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
      archived: input.archived ?? false,
    },
  });
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
