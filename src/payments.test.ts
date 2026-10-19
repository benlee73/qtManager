import { describe, expect, it } from "vitest";
import { filterPayments, type PaymentView } from "./payments";

describe("payment search", () => {
  it("keeps status filtering and prioritizes exact names during Korean search", () => {
    const row = (
      id: string,
      name: string,
      status: PaymentView["status"] = "pending",
    ): PaymentView => ({
      id,
      name,
      status,
      kind: "subscription",
      personId: id,
      cohort: "00",
      issue: "2026년 11~12월호",
      quantity: 1,
      appliedAt: "2026-10-19",
      updatedAt: "2026-10-19",
    });
    const rows = [
      row("partial", "가가상원"),
      row("exact", "가상원"),
      row("confirmed", "가상원", "confirmed"),
    ];
    expect(filterPayments(rows, "가상원", false).map((r) => r.id)).toEqual([
      "exact",
      "partial",
    ]);
    expect(filterPayments(rows, "가상워", true).map((r) => r.id)).toEqual([
      "confirmed",
    ]);
  });
});
