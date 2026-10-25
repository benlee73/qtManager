import { expect, it } from "vitest";
import {
  buildCorrectionRequest,
  type CorrectionTarget,
} from "./subscriptionCorrection";
const fields = { issueYear: 2027, issueMonth: 1, quantity: 3 };
it("retains annual application date and memo exactly when changing only issue and quantity", () => {
  const target: CorrectionTarget = {
    kind: "annual",
    value: {
      id: "sub",
      revision: "original",
      startIssue: "2026년 11~12월호",
      lastIssue: "2027년 9~10월호",
      quantity: 1,
      appliedAt: "2026-10-19T13:00:00+09:00",
      memo: "  원래 메모\n둘째 줄",
      source: "직접 등록",
      archived: false,
      periodState: "current",
    },
  };
  const result = buildCorrectionRequest("person", target, fields, true);
  expect(result.kind).toBe("annual");
  expect(result.request).toMatchObject({
    ...fields,
    appliedAt: target.value.appliedAt,
    memo: target.value.memo,
    confirmConflicts: true,
    expectedRevision: "original",
  });
});
it("retains purchase timestamp and note during a one-issue correction", () => {
  const target: CorrectionTarget = {
    kind: "purchase",
    value: {
      id: "purchase",
      revision: "original",
      issue: "2026년 11~12월호",
      quantity: 1,
      purchasedAt: "2026-10-19T13:00:00+09:00",
      note: "보존할 구매 메모",
      reversed: false,
    },
  };
  expect(
    buildCorrectionRequest("person", target, fields).request,
  ).toMatchObject({
    ...fields,
    purchasedAt: target.value.purchasedAt,
    note: target.value.note,
    purchaseId: "purchase",
  });
});
