import { describe, expect, it } from "vitest";
import { importPreviewMessage } from "./importPreviewMessage";
import type { ApplicationPreviewRow } from "./applicationImport";

const row: ApplicationPreviewRow = {
  rowNumber: 1,
  submittedAt: null,
  name: "가상",
  cohort: "00",
  phone: null,
  issueYear: 2026,
  issueMonth: 11,
  issueLabel: "2026년 11~12월호",
  quantity: 1,
  fingerprint: "fake",
  status: "candidate",
  message: "후보 확인",
  candidates: [],
};
describe("붙여넣기 선택 결과 안내", () => {
  it("distinguishes undecided, existing, new, excluded and invalid rows", () => {
    expect(importPreviewMessage(row, "", false)).toBe(
      "기존 신청자 후보를 선택해 주세요.",
    );
    expect(importPreviewMessage(row, "person", true)).toBe(
      "선택한 기존 신청자에 구독을 추가합니다.",
    );
    expect(importPreviewMessage(row, "__new__", true)).toBe(
      "새 QT 신청자로 추가합니다.",
    );
    expect(importPreviewMessage(row, "person", false)).toBe(
      "선택하지 않은 행입니다.",
    );
    expect(importPreviewMessage({ ...row, status: "ready" }, "", false)).toBe(
      "선택하지 않은 행입니다.",
    );
    expect(importPreviewMessage({ ...row, status: "ready" }, "", true)).toBe(
      "새 QT 신청자로 추가합니다.",
    );
    expect(
      importPreviewMessage(
        { ...row, status: "error", message: "잘못된 수량" },
        "",
        false,
      ),
    ).toBe("잘못된 수량");
  });
});
