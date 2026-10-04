import type { PersonSummary } from "./phase3";

/**
 * 현장 개별 구매 대상은 자동으로 확정하지 않는다. 담당자가 검색 결과를
 * 확인하고 명시적으로 선택해야 기존 신청자와 구매 이력이 연결된다.
 */
export function filterPurchasePeople(
  people: PersonSummary[],
  query: string,
): PersonSummary[] {
  const normalized = query.replace(/\s/g, "").toLowerCase();
  if (!normalized) return [];

  return people
    .filter((person) => {
      if (person.isGroup) return false;
      const name = person.name.replace(/\s/g, "").toLowerCase();
      const cohort = person.cohort ?? "";
      return (
        name.includes(normalized) ||
        cohort.includes(normalized) ||
        `${cohort}${name}`.includes(normalized)
      );
    })
    .slice(0, 8);
}

export function purchasePersonLabel(person: PersonSummary): string {
  return person.cohort ? `${person.cohort} ${person.name}` : person.name;
}
