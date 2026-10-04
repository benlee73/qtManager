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
    expect(markup).toContain("현장 배부에서 선택한 QT 호");
    expect(markup).toContain("메모 추가와 연결");
    expect(markup).toContain("신청자에 연결된 메모를 수정·보관·삭제");
    expect(markup).not.toContain("정식 등록");
    expect(markup).toContain("정보 보완이나 보관 상태는 작은 표시");
    expect(markup).toContain("정보 보완 필요 N명");
    expect(markup).toContain("일반 등록자의 또래 누락만으로는");
    expect(markup).toContain("보관된 구독은 과거 기록을 보존");
    expect(markup).toContain('data-testid="help-nav-people"');
    expect(markup).toContain('aria-current="location"');
    expect(markup).toContain('data-testid="help-notes"');
    expect(markup).toContain("현장 배부 오른쪽 입력란");
    expect(markup).toContain("신청자 행의 점 세 개 또는 우클릭");
    expect(markup).toContain("현장 배부 검색창 옆의 ‘1달 구독’ 버튼");
    expect(markup).toContain(
      "구매자 이름이나 또래를 입력해 기존 신청자를 검색",
    );
    expect(markup).toContain("인수인계 백업과 복원 순서");
    expect(markup).toContain('data-testid="help-search"');
    expect(markup).toContain("받은 백업 엑셀이 있다면 신청자 관리");
    expect(markup).toContain('class="help-card"');
    expect(markup).toContain("도움말 2026-08-08");
    expect(markup).not.toContain("인터넷 없이 보는 사용법");
    expect(markup).not.toContain("->");
    expect(markup).toContain('class="help-step-copy"');
    expect(markup).toContain('class="shortcut-list"');
    expect(markup).toContain('class="help-card-grid help-card-grid-stacked"');
    expect(markup).toContain("아래 방향키");
    expect(markup).not.toContain("ArrowDown");
    expect(markup).not.toContain("도움말 열기");
    expect(markup).toContain('class="help-secondary-action"');
    expect(markup).toContain("⌘/Ctrl + 1");
    expect(markup).toContain("⌘/Ctrl + 2");
    expect(markup).toContain("신청자 상세의 `신청자 삭제`");
    expect(markup).toContain('data-testid="help-backdrop"');
    expect(markup).toContain('data-testid="help-panel"');
    expect(markup).toContain("메모 카드를 클릭하면 전문");
    expect(markup).not.toContain("카드를 두 번 클릭하면");
  });
});
