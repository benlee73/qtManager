import type { PersonSummary } from "./phase3";

/**
 * 간이 등록으로 생성되어 정보 보완이 필요한 신청자만 추린다.
 * 또래가 비어 있는 정식 등록 신청자는 기존 업무 규칙상 이 목록에 넣지 않는다.
 */
export function profileCompletionPeople(
  people: PersonSummary[],
): PersonSummary[] {
  return people.filter((person) => person.status === "정보 보완 필요");
}

export function profileCompletionNames(people: PersonSummary[]): string {
  return people
    .map((person) => `${person.cohort ?? "--"} ${person.name}`)
    .join(", ");
}
