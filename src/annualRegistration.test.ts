import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveAnnualSubscription } from "./annualRegistration";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
const input = {
  name: "가상",
  cohort: "00",
  phone: "",
  quantity: 2,
  memo: "가상 구독 메모",
};
describe("현장 연간 신청 연결", () => {
  it("adds only a subscription to the explicitly selected existing applicant", async () => {
    await saveAnnualSubscription(
      { year: 2026, startMonth: 11 },
      input,
      "existing",
      true,
    );
    expect(invoke).toHaveBeenLastCalledWith("renew_subscription_command", {
      request: {
        personId: "existing",
        issueYear: 2026,
        issueMonth: 11,
        quantity: 2,
        appliedAt: null,
        memo: "가상 구독 메모",
        confirmOverlap: true,
      },
    });
  });
  it("uses new registration when no existing applicant was selected", async () => {
    await saveAnnualSubscription(
      { year: 2026, startMonth: 11 },
      input,
      null,
      false,
    );
    expect(invoke).toHaveBeenLastCalledWith("create_draft_command", {
      request: {
        name: "가상",
        cohort: "00",
        phone: null,
        issueYear: 2026,
        issueMonth: 11,
        quantity: 2,
        memo: "가상 구독 메모",
      },
    });
  });
});
