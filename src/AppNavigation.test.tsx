import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppNavigation } from "./AppNavigation";

const handlers = {
  onDistribution: vi.fn(),
  onManagement: vi.fn(),
  onTheme: vi.fn(),
  onHelp: vi.fn(),
  onOperator: vi.fn(),
};

describe("AppNavigation", () => {
  it("marks the active destination and keeps all rail actions accessible", () => {
    const markup = renderToStaticMarkup(
      <AppNavigation
        active="distribution"
        operator="교육국 담당자"
        theme="dark"
        {...handlers}
      />,
    );

    expect(markup).toContain('class="app-navigation"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("현장 배부");
    expect(markup).toContain("신청자 관리");
    expect(markup).toContain("도움말");
    expect(markup).toContain("다크 테마 사용 중");
    expect(markup).toContain("교육국 담당자");
    expect(markup).toContain("2026 교육국 제작");
  });

  it("moves the current-page marker to management", () => {
    const markup = renderToStaticMarkup(
      <AppNavigation
        active="management"
        operator={null}
        theme="light"
        {...handlers}
      />,
    );

    expect(markup).toContain('data-testid="open-management"');
    expect(markup).toContain("라이트 테마 사용 중");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
