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

export type PersonDetail = {
  id: string;
  name: string;
  cohort: string | null;
  phone: string | null;
  status: string;
  personNote: string | null;
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
  checkItems: LinkedCheckItem[];
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
  personNote: string;
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
