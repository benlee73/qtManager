import { invoke } from "@tauri-apps/api/core";
export type PaymentView = {
  id: string;
  kind: "subscription" | "purchase";
  personId: string | null;
  name: string;
  cohort: string | null;
  issue: string;
  quantity: number;
  appliedAt: string;
  status: "pending" | "confirmed";
  updatedAt: string;
};
export type PaymentSelection = Pick<PaymentView, "id" | "kind">;
export function loadPayments() {
  return invoke<PaymentView[]>("load_payments_command");
}
export function setPaymentConfirmed(
  selections: PaymentSelection[],
  confirmed: boolean,
) {
  return invoke<void>("set_payment_confirmed_command", {
    selections,
    confirmed,
  });
}
export function filterPayments(
  rows: PaymentView[],
  query: string,
  confirmed: boolean,
) {
  const normalized = query.replace(/\s/g, "").toLowerCase();
  return rows.filter(
    (row) =>
      row.status === (confirmed ? "confirmed" : "pending") &&
      `${row.cohort ?? ""}${row.name}`
        .replace(/\s/g, "")
        .toLowerCase()
        .includes(normalized),
  );
}
