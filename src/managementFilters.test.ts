import { describe, expect, it } from "vitest";

import {
  profileCompletionNames,
  profileCompletionPeople,
} from "./managementFilters";
import type { PersonSummary } from "./phase3";

const people: PersonSummary[] = [
  {
    id: "active",
    name: "정식 신청자",
    cohort: null,
    phone: null,
    status: "정식 등록",
    personNote: null,
    subscriptionCount: 1,
    latestLastIssue: "2026년 9~10월호",
  },
  {
    id: "draft",
    name: "보완 신청자",
    cohort: "95",
    phone: null,
    status: "정보 보완 필요",
    personNote: null,
    subscriptionCount: 1,
    latestLastIssue: null,
  },
];

describe("profile completion filter", () => {
  it("keeps only draft applicants and exposes names without phone data", () => {
    const drafts = profileCompletionPeople(people);

    expect(drafts.map((person) => person.id)).toEqual(["draft"]);
    expect(profileCompletionNames(drafts)).toBe("95 보완 신청자");
  });

  it("does not classify a registered applicant without a cohort as a draft", () => {
    expect(profileCompletionPeople(people)[0]?.id).toBe("draft");
    expect(profileCompletionNames(profileCompletionPeople([people[0]!]))).toBe(
      "",
    );
  });
});
