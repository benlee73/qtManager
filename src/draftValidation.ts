export type DraftInput = {
  name: string;
  cohort: string;
  phone: string;
  quantity: number;
  memo?: string;
};

export function validateDraftFields(
  input: DraftInput,
  existingPerson = false,
): Partial<Record<keyof DraftInput, string>> {
  const errors: Partial<Record<keyof DraftInput, string>> = {};
  if (!existingPerson) {
    if (!input.name.trim()) errors.name = "이름을 입력하세요.";
    const cohort = input.cohort.trim();
    if (!cohort) errors.cohort = "또래를 입력하세요.";
    else if (!/^\d{2}$/.test(cohort))
      errors.cohort = "또래는 두 자리 숫자만 입력할 수 있습니다.";
    if (input.phone.trim() && !/^010-\d{4}-\d{4}$/.test(input.phone.trim()))
      errors.phone = "연락처는 010-xxxx-xxxx 형식으로 입력하세요.";
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1)
    errors.quantity = "수량은 1권 이상 입력하세요.";
  return errors;
}

export function validateDraftInput(input: DraftInput): string | null {
  return Object.values(validateDraftFields(input))[0] ?? null;
}
