export type PurchaseInput = {
  buyerName: string;
  purchaseCohort: string;
  purchasePhone: string;
  quantity: number;
};
export function validatePurchaseInput(
  input: PurchaseInput,
  newPerson: boolean,
): Partial<Record<keyof PurchaseInput, string>> {
  const errors: Partial<Record<keyof PurchaseInput, string>> = {};
  if (newPerson) {
    if (!input.buyerName.trim()) errors.buyerName = "이름을 입력하세요.";
    if (
      input.purchaseCohort.trim() &&
      !/^\d{2}$/.test(input.purchaseCohort.trim())
    )
      errors.purchaseCohort = "또래는 두 자리 숫자만 입력할 수 있습니다.";
    if (
      input.purchasePhone.trim() &&
      !/^010-\d{4}-\d{4}$/.test(input.purchasePhone.trim())
    )
      errors.purchasePhone = "연락처는 010-xxxx-xxxx 형식으로 입력하세요.";
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1)
    errors.quantity = "수량은 1권 이상 입력하세요.";
  return errors;
}
