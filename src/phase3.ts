import { invoke } from "@tauri-apps/api/core";

import type { Issue } from "./phase2";

export type PeopleManagement = {
  people: PersonSummary[];
  draftCount: number;
  archivedCount: number;
};

export type PersonSummary = {
  id: string;
  name: string;
  cohort: string | null;
  phone: string | null;
  status: string;
  personNote: string | null;
  subscriptionCount: number;
  latestLastIssue: string | null;
};

export type SubscriptionPeriodState =
  | "current"
  | "scheduled"
  | "past"
  | "archived";

export type LinkedCheckItem = {
  id: string;
  summary: string;
  status: "확인 필요" | "확인 완료" | "보관";
  updatedAt: string;
};

export type LinkedMemo = {
  id: string;
  content: string;
  status: "활성" | "보관";
  updatedAt: string;
};

export type PersonDetail = {
  id: string;
  name: string;
  cohort: string | null;
  phone: string | null;
  status: string;
  /** 구버전 데이터 호환용. 새 화면은 memos를 사용한다. */
  personNote?: string | null;
  subscriptions: {
    id: string;
    startIssue: string;
    lastIssue: string;
    quantity: number;
    appliedAt: string | null;
    source: string;
    memo: string | null;
    archived: boolean;
    periodState: SubscriptionPeriodState;
  }[];
  distributions: {
    issue: string;
    quantity: number;
    distributedAt: string;
    reversed: boolean;
  }[];
  purchases?: {
    issue: string;
    quantity: number;
    purchasedAt: string;
    reversed: boolean;
  }[];
  /** 구버전 확인할 일 응답 호환용 */
  checkItems?: LinkedCheckItem[];
  memos?: LinkedMemo[];
};

export type DuplicateCandidate = {
  id: string;
  name: string;
  cohort: string | null;
  phone: string | null;
  status: string;
};

export type PersonInput = {
  name: string;
  cohort: string;
  phone: string;
  /** 구버전 API 호환용. 새 입력 경로에서는 사용하지 않는다. */
  personNote?: string;
};

export function loadManagement(query: string, includeArchived: boolean) {
  return invoke<PeopleManagement>("load_people_management_command", {
    query,
    includeArchived,
  });
}

export function loadPersonDetail(personId: string) {
  return invoke<PersonDetail>("load_person_detail_command", { personId });
}

export function previewDuplicates(input: PersonInput, excludingId?: string) {
  return invoke<DuplicateCandidate[]>("preview_duplicates_command", {
    name: input.name,
    cohort: input.cohort || null,
    phone: input.phone || null,
    excludingId: excludingId ?? null,
  });
}

export function registerPerson(
  issue: Issue,
  input: PersonInput & {
    quantity: number;
    appliedAt: string;
    memo: string;
    confirmDuplicate: boolean;
  },
) {
  return invoke<string>("register_person_command", {
    request: {
      name: input.name,
      cohort: input.cohort || null,
      phone: input.phone || null,
      personNote: input.personNote || null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      appliedAt: input.appliedAt || null,
      memo: input.memo || null,
      confirmDuplicate: input.confirmDuplicate,
    },
  });
}

export function updatePerson(
  personId: string,
  input: PersonInput & { confirmDuplicate: boolean },
) {
  return invoke<void>("update_person_command", {
    request: {
      personId,
      name: input.name,
      cohort: input.cohort || null,
      phone: input.phone || null,
      personNote: input.personNote || null,
      confirmDuplicate: input.confirmDuplicate,
    },
  });
}

export function setPersonArchived(personId: string, archived: boolean) {
  return invoke<void>("set_person_archived_command", { personId, archived });
}

export function deletePerson(personId: string) {
  return invoke<void>("delete_person_command", { personId });
}

export function renewSubscription(
  personId: string,
  issue: Issue,
  input: {
    quantity: number;
    appliedAt: string;
    memo: string;
    confirmOverlap: boolean;
  },
) {
  return invoke<void>("renew_subscription_command", {
    request: {
      personId,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: input.quantity,
      appliedAt: input.appliedAt || null,
      memo: input.memo || null,
      confirmOverlap: input.confirmOverlap,
    },
  });
}
