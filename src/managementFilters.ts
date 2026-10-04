import type { PersonSummary } from "./phase3";

/** 도메인이 또래 누락과 군지체 예외를 판정한 표시 상태를 사용한다. */
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
