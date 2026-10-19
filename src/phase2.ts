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
  isGroup?: boolean;
  cohortNotApplicable?: boolean;
  latestGroupDistributionId?: string | null;
  latestGroupDistributionQuantity?: number;
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
  hasMemo?: boolean;
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

export type MemoView = {
  id: string;
  personId: string | null;
  content: string;
  operatorName: string;
  updatedAt: string;
  status: "활성" | "보관";
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
  /** 구버전 호환 필드. 새 화면은 memos만 사용한다. */
  checkItems?: CheckItemView[];
  pinnedNotes?: PinnedNoteView[];
  archivedCheckItems?: CheckItemView[];
  archivedPinnedNotes?: PinnedNoteView[];
  memos?: MemoView[];
  archivedMemos?: MemoView[];
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
  input: {
    name: string;
    cohort: string;
    cohortNotApplicable?: boolean;
    phone: string;
    quantity: number;
    memo?: string;
  },
) {
  return invoke<void>("create_draft_command", {
    request: {
      name: input.name,
      cohort: input.cohortNotApplicable ? null : input.cohort || null,
      cohortNotApplicable: input.cohortNotApplicable ?? false,
      phone: input.phone || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      memo: input.memo || null,
    },
  });
}

export function createMemo(personId: string | null, content: string) {
  return invoke<string>("create_memo_command", {
    request: { personId, content },
  });
}

export function updateMemo(id: string, content: string) {
  return invoke<void>("update_memo_command", { request: { id, content } });
}

export function updateMemoStatus(id: string, archived: boolean) {
  return invoke<void>("update_memo_status_command", {
    request: { id, archived },
  });
}

export function deleteMemo(id: string) {
  return invoke<void>("delete_memo_command", { id });
}

export function recordPurchase(
  issue: Issue,
  input: {
    buyerName: string;
    personId?: string | null;
    quantity: number;
    note: string;
  },
) {
  return invoke<void>("record_purchase_command", {
    request: {
      personId: input.personId ?? null,
      buyerName: input.buyerName || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      note: input.note || null,
    },
  });
}

export function recordPurchaseForNewPerson(
  issue: Issue,
  input: {
    name: string;
    cohort: string;
    cohortNotApplicable?: boolean;
    phone: string;
    quantity: number;
    note: string;
  },
) {
  return invoke<string>("record_purchase_for_new_person_command", {
    request: {
      name: input.name.trim(),
      cohort: input.cohortNotApplicable ? null : input.cohort.trim() || null,
      cohortNotApplicable: input.cohortNotApplicable ?? false,
      phone: input.phone.trim() || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      note: input.note.trim() || null,
    },
  });
}

export function cancelLatestPurchase(issue: Issue) {
  return invoke<void>("cancel_latest_purchase_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
  });
}

export function recordGroupDistribution(
  issue: Issue,
  personId: string,
  quantity: number,
) {
  return invoke<string>("record_group_distribution_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
    personId,
    quantity,
  });
}
export function cancelGroupDistribution(
  issue: Issue,
  personId: string,
  purchaseId: string,
) {
  return invoke<void>("cancel_group_distribution_command", {
    issueYear: issue.year,
    issueMonth: issue.startMonth,
    personId,
    purchaseId,
  });
}
