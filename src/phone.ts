/** Keep phone inputs readable while the operator types digits from a form or XLSX. */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const formatted = formatPhoneInput(trimmed);
  return /^010-\d{4}-\d{4}$/.test(formatted) ? formatted : null;
}

export function handlePhoneInput(event: { currentTarget: HTMLInputElement }) {
  const input = event.currentTarget;
  const formatted = formatPhoneInput(input.value);
  if (formatted !== input.value) {
    input.value = formatted;
    input.setSelectionRange(formatted.length, formatted.length);
  }
}
