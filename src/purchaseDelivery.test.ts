import { expect, it, vi } from "vitest";
import {
  distributeAllocations,
  undoDistributionAllocations,
  cancelPersonDistribution,
  type DeskPerson,
} from "./phase2";
const { invoke } = vi.hoisted(() => ({
  invoke: vi
    .fn<(command: string, args: unknown) => Promise<{ quantity: number }>>()
    .mockResolvedValue({ quantity: 1 }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
it("routes monthly delivery and cancellation to delivery commands without cancelling payment", async () => {
  invoke.mockClear();
  const issue = { year: 2026, startMonth: 11 };
  const allocation = {
    subscriptionId: "",
    purchaseId: "monthly",
    personId: "person",
    quantity: 1,
  };
  await distributeAllocations(issue, [allocation]);
  await undoDistributionAllocations(issue, [allocation]);
  expect(invoke.mock.calls.map((c) => c[0])).toEqual([
    "record_purchase_delivery_command",
    "undo_purchase_delivery_command",
  ]);
  const person = {
    personId: "person",
    distributionTargets: [
      { subscriptionId: "", purchaseId: "monthly", distributedQuantity: 1 },
    ],
  } as DeskPerson;
  expect(await cancelPersonDistribution(issue, person)).toEqual([allocation]);
  expect(invoke.mock.calls.map((c) => c[0])).not.toContain(
    "cancel_latest_purchase_command",
  );
});
