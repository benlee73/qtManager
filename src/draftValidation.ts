export type DraftInput = {
  name: string;
  cohort: string;
  phone: string;
  quantity: number;
};

export function validateDraftInput(input: DraftInput): string | null {
  if (!input.name.trim()) return "이름을 입력하세요.";
  const cohort = input.cohort.trim();
  if (cohort && !/^\d{2}$/.test(cohort)) {
    return "또래는 두 자리 숫자만 입력할 수 있습니다.";
  }
  if (input.phone.trim() && !/^010-\d{4}-\d{4}$/.test(input.phone.trim())) {
    return "연락처는 010-xxxx-xxxx 형식으로 입력하세요.";
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return "수량은 1권 이상 입력하세요.";
  }
  return null;
}
