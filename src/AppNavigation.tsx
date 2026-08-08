import type { Theme } from "./appearance";
import {
  BookLogo,
  DistributionIcon,
  HelpIcon,
  PeopleIcon,
  ThemeIcon,
} from "./Icons";

type AppNavigationProps = {
  active: "distribution" | "management";
  operator?: string | null;
  theme: Theme;
  onDistribution: () => void;
  onManagement: () => void;
  onTheme: () => void;
  onHelp: () => void;
  onOperator: () => void;
};

export function AppNavigation({
  active,
  operator,
  theme,
  onDistribution,
  onManagement,
  onTheme,
  onHelp,
  onOperator,
}: AppNavigationProps) {
  return (
    <nav className="app-navigation" aria-label="주요 메뉴">
      <div className="rail-brand">
        <BookLogo />
        <b className="rail-wordmark">큐티매니저</b>
      </div>

      <div className="rail-primary">
        <button
          className={`rail-item ${active === "distribution" ? "active" : ""}`}
          type="button"
          aria-current={active === "distribution" ? "page" : undefined}
          onClick={onDistribution}
        >
          <DistributionIcon />
          <span>현장 배부</span>
        </button>
        <button
          className={`rail-item ${active === "management" ? "active" : ""}`}
          type="button"
          data-testid="open-management"
          aria-current={active === "management" ? "page" : undefined}
          onClick={onManagement}
        >
          <PeopleIcon />
          <span>신청자 관리</span>
        </button>
      </div>

      <div className="rail-utilities">
        <button
          className="rail-item"
          data-testid="open-help"
          type="button"
          onClick={onHelp}
        >
          <HelpIcon />
          <span>도움말</span>
        </button>
        <button
          className="rail-item"
          type="button"
          data-testid="theme-toggle"
          aria-label={`${theme === "dark" ? "다크" : "라이트"} 테마 사용 중, 테마 전환`}
          onClick={onTheme}
        >
          <ThemeIcon dark={theme === "dark"} />
          <span>{theme === "dark" ? "다크" : "라이트"}</span>
        </button>
        <button
          className="rail-operator"
          type="button"
          title={operator ?? "담당자 설정"}
          aria-label={`${operator ?? "담당자 설정"}, 담당자 변경`}
          onClick={onOperator}
        >
          <b>{operator ?? "담당자 설정"}</b>
          <small>담당자</small>
        </button>
        <span className="info-tooltip rail-info">
          <button type="button" aria-label="제작 정보">
            i
          </button>
          <span role="tooltip">2026 교육국 제작</span>
        </span>
      </div>
    </nav>
  );
}
