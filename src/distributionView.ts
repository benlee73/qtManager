import type {
  DeskPerson,
  DistributionAllocation,
  Issue,
  MemoView,
} from "./phase2";

export function activeDistributionMemos(memos: MemoView[], personId: string) {
  return memos.filter(
    (memo) => memo.personId === personId && memo.status === "활성",
  );
}

export const PERSON_FILTERS = [
  "undistributed",
  "partial",
  "completed",
  "expired",
] as const;

export type PersonFilter = (typeof PERSON_FILTERS)[number];

export const PERSON_FILTER_LABELS: Record<PersonFilter, string> = {
  undistributed: "미배부",
  partial: "일부 배부",
  completed: "배부 완료",
  expired: "구독 만료",
};

export const DEFAULT_PERSON_FILTERS: PersonFilter[] = [
  "undistributed",
  "partial",
];

export const ALL_PERSON_FILTERS: PersonFilter[] = [...PERSON_FILTERS];

export function personFilter(person: DeskPerson): PersonFilter {
  if (person.subscriptionStatus === "구독 만료") return "expired";
  if (person.distributionStatus === "일부 배부") return "partial";
  if (person.distributionStatus === "배부 완료") return "completed";
  return "undistributed";
}

export function filterPeople(
  people: DeskPerson[],
  filters: ReadonlySet<PersonFilter>,
) {
  // A person whose selected issue is outside every subscription is not a
  // distribution candidate. Keep the filter vocabulary focused on actions the
  // operator can actually perform; these rows are available in management.
  return people.filter(
    (person) =>
      person.subscriptionStatus !== "대상 아님" &&
      person.subscriptionStatus !== "예정" &&
      filters.has(personFilter(person)),
  );
}

export function subscriptionHeadline(person: DeskPerson): string | null {
  if (person.distributionTargets.length > 1)
    return `${person.distributionTargets.length}개 구독`;
  if (person.isLastIssue) return "이번 호 마지막";
  if (person.subscriptionStatus === "유효") return null;
  return person.subscriptionStatus;
}

export function subscriptionPeriodText(person: DeskPerson): string {
  if (person.distributionTargets.length > 1) {
    const earliest = person.distributionTargets[0]?.lastIssue;
    return earliest ? `빠른 종료 ${earliest}` : "등록된 구독 없음";
  }
  return person.lastIssue ? `${person.lastIssue}까지` : "등록된 구독 없음";
}

export function distributionAllocations(
  person: DeskPerson,
  quantity = person.remainingQuantity,
): DistributionAllocation[] {
  let remaining = quantity;
  const allocations: DistributionAllocation[] = [];
  for (const target of person.distributionTargets) {
    const amount = Math.min(target.remainingQuantity, remaining);
    if (amount > 0)
      allocations.push({
        subscriptionId: target.subscriptionId,
        quantity: amount,
      });
    remaining -= amount;
    if (remaining === 0) break;
  }
  return allocations;
}

export function issueLabelParts(issue: Issue) {
  return {
    year: String(issue.year),
    startMonth: String(issue.startMonth),
    endMonth: String(issue.startMonth + 1),
  };
}

export function filterLabel(filters: ReadonlySet<PersonFilter>) {
  if (PERSON_FILTERS.every((filter) => filters.has(filter)))
    return "전체 신청자";
  if (
    filters.size === DEFAULT_PERSON_FILTERS.length &&
    DEFAULT_PERSON_FILTERS.every((filter) => filters.has(filter))
  )
    return "남은 신청자";
  if (filters.size === 0) return "선택한 신청자";
  return "필터 결과";
}

export function distributionListHeading(
  people: DeskPerson[],
  filters: ReadonlySet<PersonFilter>,
  query: string,
) {
  const label = query ? "검색 결과" : filterLabel(filters);
  const groupCount =
    label === "남은 신청자"
      ? people.filter((person) => person.isGroup).length
      : 0;
  // Group deliveries have no subscription target and are excluded from the
  // remaining-person statistic, but must stay available in the desk list.
  return { label, count: people.length - groupCount };
}

export function filterTriggerLabel(filters: ReadonlySet<PersonFilter>) {
  return `필터 · ${filters.size}개`;
}

export function filterSelectionDescription(filters: ReadonlySet<PersonFilter>) {
  return PERSON_FILTERS.filter((filter) => filters.has(filter))
    .map((filter) => PERSON_FILTER_LABELS[filter])
    .join(", ");
}

export function searchMemos(memos: MemoView[], query: string) {
  const normalized = query.replace(/\s/g, "").toLowerCase();
  return memos.filter((memo) =>
    `${memo.content} ${memo.personName ?? ""}`
      .replace(/\s/g, "")
      .toLowerCase()
      .includes(normalized),
  );
}
