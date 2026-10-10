import type { ApplicationPreviewRow } from "./applicationImport";

export function importPreviewMessage(
  row: ApplicationPreviewRow,
  decision: string,
  checked: boolean,
): string {
  if (row.status === "ready")
    return checked ? "새 QT 신청자로 추가합니다." : "선택하지 않은 행입니다.";
  if (row.status !== "candidate") return row.message;
  if (!decision) return "기존 신청자 후보를 선택해 주세요.";
  if (!checked) return "선택하지 않은 행입니다.";
  if (decision === "__new__") return "새 QT 신청자로 추가합니다.";
  return "선택한 기존 신청자에 구독을 추가합니다.";
}
