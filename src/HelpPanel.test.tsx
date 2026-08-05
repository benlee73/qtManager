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
    expect(markup).toContain("메모 추가와 연결");
    expect(markup).toContain("신청자에 연결된 메모를 수정·보관·삭제");
    expect(markup).toContain("신청자 관리 목록에서는 숨기고");
    expect(markup).toContain("상세 또는 정보 수정 화면에서 전체 전화번호");
    expect(markup).toContain("신청자 관리 상단에는 제목 하나만 표시됩니다.");
    expect(markup).toContain("긴 신청자 목록은 왼쪽 목록 안에서");
    expect(markup).toContain("신청자 목록에는 또래와 이름만 기본 표시됩니다.");
    expect(markup).not.toContain("정식 등록");
    expect(markup).toContain("정보 보완이나 보관 상태는 작은 표시");
    expect(markup).toContain("정보 보완 필요 N명");
    expect(markup).toContain("입금 상태와는 무관합니다");
    expect(markup).toContain('data-testid="help-nav-people"');
    expect(markup).toContain('aria-current="location"');
    expect(markup).toContain('data-testid="help-notes"');
    expect(markup).toContain("현장 배부 오른쪽 입력란");
    expect(markup).toContain("신청자 행의 점 세 개 또는 우클릭");
    expect(markup).toContain('class="help-card"');
    expect(markup).toContain("도움말 2026-08-04");
    expect(markup).not.toContain("인터넷 없이 보는 사용법");
    expect(markup).toContain('class="help-step-copy"');
    expect(markup).toContain('data-testid="help-backdrop"');
  });
});
