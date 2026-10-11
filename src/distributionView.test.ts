import { describe, expect, it } from "vitest";

import type { DeskPerson } from "./phase2";
import {
  searchMemos,
  ALL_PERSON_FILTERS,
  DEFAULT_PERSON_FILTERS,
  distributionAllocations,
  filterPeople,
  filterSelectionDescription,
  filterTriggerLabel,
  issueLabelParts,
  subscriptionPeriodText,
  subscriptionHeadline,
  distributionListHeading,
} from "./distributionView";

function person(
  distributionStatus: string,
  subscriptionStatus = "유효",
): DeskPerson {
  return {
    personId: `${subscriptionStatus}-${distributionStatus}`,
    subscriptionId: "subscription-id",
    distributionTargets: [],
    name: "테스트 신청자",
    cohort: "00",
    phone: null,
    personStatus: "정상",
    subscriptionStatus,
    distributionStatus,
    targetQuantity: 1,
    distributedQuantity: distributionStatus === "배부 완료" ? 1 : 0,
    remainingQuantity: distributionStatus === "배부 완료" ? 0 : 1,
    lastIssue: null,
    endDate: "2026-12-31",
    isLastIssue: false,
    hasMemo: false,
    canDistribute: subscriptionStatus !== "구독 만료",
  };
}

describe("distribution list filters", () => {
  const people = [
    person("미배부"),
    person("일부 배부"),
    person("배부 완료"),
    person("미배부", "구독 만료"),
  ];

  it("defaults to the two remaining distribution states", () => {
    expect(DEFAULT_PERSON_FILTERS).toEqual(["undistributed", "partial"]);
    expect(filterPeople(people, new Set(DEFAULT_PERSON_FILTERS))).toHaveLength(
      2,
    );
  });

  it("counts group deliveries separately in the remaining-applicant heading", () => {
    const group = { ...person("미배부"), isGroup: true };
    const rows = filterPeople(
      [...people, group],
      new Set(DEFAULT_PERSON_FILTERS),
    );
    expect(
      distributionListHeading(rows, new Set(DEFAULT_PERSON_FILTERS), ""),
    ).toEqual({
      label: "남은 신청자",
      count: 2,
    });
    expect(
      distributionListHeading(
        [group],
        new Set(DEFAULT_PERSON_FILTERS),
        "군지체",
      ),
    ).toEqual({
      label: "검색 결과",
      count: 1,
    });
  });

  it("combines selected categories and classifies expired people only once", () => {
    expect(
      filterPeople(people, new Set(["completed", "expired"])).map(
        (candidate) => candidate.subscriptionStatus,
      ),
    ).toEqual(["유효", "구독 만료"]);
    expect(filterPeople(people, new Set(ALL_PERSON_FILTERS))).toHaveLength(4);
  });

  it("does not put a scheduled or issue-ineligible person in distribution filters", () => {
    const scheduled = person("대상 아님", "예정");
    const notEligible = person("대상 아님", "대상 아님");
    expect(
      filterPeople(
        [...people, scheduled, notEligible],
        new Set(ALL_PERSON_FILTERS),
      ),
    ).toHaveLength(4);
  });

  it("names the common presets and describes custom multi-selection", () => {
    expect(filterTriggerLabel(new Set(DEFAULT_PERSON_FILTERS))).toBe(
      "필터 · 2개",
    );
    expect(filterTriggerLabel(new Set(ALL_PERSON_FILTERS))).toBe("필터 · 4개");
    expect(filterTriggerLabel(new Set(["completed", "expired"]))).toBe(
      "필터 · 2개",
    );
    expect(filterSelectionDescription(new Set(["completed", "expired"]))).toBe(
      "배부 완료, 구독 만료",
    );
  });
});

describe("distribution row presentation", () => {
  it("omits the normal valid headline but preserves exceptional states", () => {
    expect(subscriptionHeadline(person("미배부"))).toBeNull();
    expect(subscriptionHeadline(person("미배부", "구독 만료"))).toBe(
      "구독 만료",
    );
    expect(
      subscriptionHeadline({ ...person("미배부"), isLastIssue: true }),
    ).toBe("이번 호 마지막");
  });

  it("splits an issue label into stable numeric slots", () => {
    expect(issueLabelParts({ year: 2026, startMonth: 7 })).toEqual({
      year: "2026",
      startMonth: "7",
      endMonth: "8",
    });
  });

  it("describes expiry by QT issue and uses the earliest issue for multiple subscriptions", () => {
    const single = { ...person("미배부"), lastIssue: "2027년 3~4월호" };
    expect(subscriptionPeriodText(single)).toBe("2027년 3~4월호까지");

    single.distributionTargets = [
      {
        subscriptionId: "first",
        startIssue: "2026년 5~6월호",
        lastIssue: "2027년 3~4월호",
        endDate: "2027-04-30",
        targetQuantity: 1,
        distributedQuantity: 0,
        remainingQuantity: 1,
      },
      {
        subscriptionId: "second",
        startIssue: "2026년 7~8월호",
        lastIssue: "2027년 5~6월호",
        endDate: "2027-06-30",
        targetQuantity: 1,
        distributedQuantity: 0,
        remainingQuantity: 1,
      },
    ];
    expect(subscriptionPeriodText(single)).toBe("빠른 종료 2027년 3~4월호");
  });
});

describe("reversible distribution allocation", () => {
  it("records the exact amount allocated to each subscription", () => {
    const candidate = person("일부 배부");
    candidate.remainingQuantity = 3;
    candidate.distributionTargets = [
      {
        subscriptionId: "first",
        startIssue: "2026년 1~2월호",
        lastIssue: "2026년 11~12월호",
        endDate: "2026-12-31",
        targetQuantity: 2,
        distributedQuantity: 1,
        remainingQuantity: 1,
      },
      {
        subscriptionId: "second",
        startIssue: "2026년 7~8월호",
        lastIssue: "2027년 5~6월호",
        endDate: "2027-06-30",
        targetQuantity: 2,
        distributedQuantity: 0,
        remainingQuantity: 2,
      },
    ];

    expect(distributionAllocations(candidate, 2)).toEqual([
      { subscriptionId: "first", quantity: 1 },
      { subscriptionId: "second", quantity: 1 },
    ]);
  });
});

it("searches memo content and linked names without changing priority or confirmation data", () => {
  const memo = {
    id: "first",
    content: "수 량 확인",
    personId: "person",
    personName: "가상 신청자",
    status: "활성" as const,
    operatorName: "담당자",
    updatedAt: "2026-10-04",
  };
  const items = [
    memo,
    {
      ...memo,
      id: "second",
      personId: null,
      personName: null,
      content: "다른 메모",
    },
  ];
  expect(searchMemos(items, "수량")).toEqual([memo]);
  expect(searchMemos(items, "가상신청")).toEqual([memo]);
  expect(searchMemos(items, " ")).toEqual(items);
  expect(items).toHaveLength(2);
});
