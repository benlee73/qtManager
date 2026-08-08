import { describe, expect, it } from "vitest";

import type { PersonSummary } from "./phase3";
import { filterPurchasePeople, purchasePersonLabel } from "./purchasePeople";

const people: PersonSummary[] = [
  {
    id: "person-a",
    name: "가상 신청자",
    cohort: "94",
    phone: null,
    status: "정식 등록",
    personNote: null,
    subscriptionCount: 1,
    latestLastIssue: "2026년 9~10월호",
  },
  {
    id: "person-b",
    name: "다른 신청자",
    cohort: "00",
    phone: null,
    status: "정보 보완 필요",
    personNote: null,
    subscriptionCount: 0,
    latestLastIssue: null,
  },
];

describe("현장 개별 구매 대상 검색", () => {
  it("이름·또래·또래와 이름 조합으로 기존 신청자를 찾는다", () => {
    expect(
      filterPurchasePeople(people, "가상").map((person) => person.id),
    ).toEqual(["person-a"]);
    expect(
      filterPurchasePeople(people, "94").map((person) => person.id),
    ).toEqual(["person-a"]);
    expect(
      filterPurchasePeople(people, "00 다른").map((person) => person.id),
    ).toEqual(["person-b"]);
  });

  it("빈 검색어는 자동 매칭하지 않고 결과를 표시하지 않는다", () => {
    expect(filterPurchasePeople(people, "")).toEqual([]);
  });

  it("또래가 없는 기존 신청자는 이름만 표시한다", () => {
    expect(purchasePersonLabel({ ...people[0], cohort: null })).toBe(
      "가상 신청자",
    );
  });
});
