import { expect, it, vi } from "vitest";
import { deliveryHistoryAction } from "./deliveryHistoryAction";
const { calls } = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (
    command: string,
    args: {
      request: {
        personId: string;
        kind: string;
        purchaseId: string | null;
        recordId: string;
        restore: boolean;
      };
    },
  ) => {
    expect(command).toBe("change_delivery_history_command");
    calls.push(args.request);
    return {
      issueYear: 2026,
      issueMonth: 11,
      quantity: 2,
      kind: args.request.kind,
      purchaseId: args.request.purchaseId,
      recordId: `next-${calls.length}`,
    };
  },
}));
for (const kind of ["distribution", "purchase", "purchase_delivery"] as const) {
  it(`undo and redo target the exact ${kind} ledger without creating a purchase`, async () => {
    calls.length = 0;
    const action = deliveryHistoryAction("person", {
      issueYear: 2026,
      issueMonth: 11,
      quantity: 2,
      kind,
      purchaseId: kind === "purchase_delivery" ? "monthly" : null,
      recordId: "reversal",
    });
    await action.undo();
    await action.redo();
    await action.undo();
    await action.redo();
    expect(calls).toEqual(
      [true, false, true, false].map((restore, index) => ({
        personId: "person",
        kind,
        purchaseId: kind === "purchase_delivery" ? "monthly" : null,
        recordId: index ? `next-${index}` : "reversal",
        restore,
      })),
    );
  });
}
