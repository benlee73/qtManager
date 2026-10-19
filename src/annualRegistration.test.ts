import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveAnnualSubscription } from "./annualRegistration";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    personId: "person",
    subscriptionId: "subscription",
    distributed: false,
  }),
}));
beforeEach(() => vi.clearAllMocks());
const input = {
  name: "가상",
  cohort: "00",
  phone: "",
  quantity: 2,
  memo: "가상 구독 메모",
};
describe("atomic annual intake request", () => {
  it("explicitly connects an existing person and keeps registration-only deliberate", async () => {
    await saveAnnualSubscription(
      { year: 2026, startMonth: 11 },
      input,
      "existing",
      true,
    );
    expect(invoke).toHaveBeenCalledWith("annual_intake_command", {
      request: expect.objectContaining({
        personId: "existing",
        confirmOverlap: true,
        distribute: false,
        issueYear: 2026,
        issueMonth: 11,
        deskYear: 2026,
        deskMonth: 11,
      }),
    });
  });
  it("carries the chosen start issue, desk issue and confirmed memos in one request", async () => {
    await saveAnnualSubscription(
      { year: 2027, startMonth: 1 },
      { ...input, cohort: "", cohortNotApplicable: true },
      null,
      false,
      { deskIssue: { year: 2026, startMonth: 11 }, distribute: false },
    );
    expect(invoke).toHaveBeenCalledWith("annual_intake_command", {
      request: expect.objectContaining({
        personId: null,
        cohort: null,
        cohortNotApplicable: true,
        issueYear: 2027,
        issueMonth: 1,
        deskYear: 2026,
        deskMonth: 11,
      }),
    });
    await saveAnnualSubscription(
      { year: 2026, startMonth: 11 },
      input,
      "existing",
      true,
      { distribute: true, confirmedMemoRevisions: ["memo"] },
    );
    expect(invoke).toHaveBeenLastCalledWith("annual_intake_command", {
      request: expect.objectContaining({
        distribute: true,
        confirmedMemoRevisions: ["memo"],
        quantity: 2,
      }),
    });
  });
});
