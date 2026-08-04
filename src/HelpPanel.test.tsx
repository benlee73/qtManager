import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HelpPanel } from "./HelpPanel";

const supportInfo = {
  appVersion: "0.1.0-test",
  dataDirectory: "/synthetic/qt-manager/data",
  logFile: "/synthetic/qt-manager/logs/qt-manager.log",
};

vi.mock("./support", () => ({
  loadAppSupportInfo: () => Promise.resolve(supportInfo),
  openLogDirectory: vi.fn(),
}));

describe("HelpPanel", () => {
  it("explains the management-detail context without exposing personal data", () => {
    const markup = renderToStaticMarkup(
      <HelpPanel topic="people" onClose={vi.fn()} />,
    );

    expect(markup).toContain("오늘이 포함된 호");
    expect(markup).toContain("현장 배부 화면에서 선택한 QT 호");
    expect(markup).toContain("연결된 확인할 일");
    expect(markup).toContain("신청자 메모");
    expect(markup).toContain("신청자 관리 목록에서는 숨기고");
    expect(markup).toContain("상세 또는 정보 수정 화면에서 전체 전화번호");
    expect(markup).toContain("신청자 관리 상단에는 제목 하나만 표시됩니다.");
    expect(markup).toContain("긴 신청자 목록은 왼쪽 목록 안에서");
    expect(markup).toContain("신청자 목록에는 또래와 이름만 기본 표시됩니다.");
    expect(markup).toContain("정보 보완이나 보관 상태는 작은 표시");
  });
});
