# Left Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QT Manager의 상단 내비게이션을 76px 좌측 레일로 교체하고, 현장 배부 표의 전화번호 열을 숨겨 확보한 폭을 신청자·구독·배부 정보에 재배분한다.

**Architecture:** 화면 전환과 테마·도움말·담당자 동작은 기존 `App` 상태와 콜백을 그대로 유지하고, 표시 책임만 새 `AppNavigation` 컴포넌트로 분리한다. 데이터 모델·SQLite·Tauri 명령은 바꾸지 않으며 전화번호는 검색, 접근성 레이블, 툴팁, 신청자 관리와 수정 대화상자에서 계속 사용할 수 있게 한다.

**Tech Stack:** React 19, TypeScript, CSS Grid, Vitest, WebdriverIO Tauri E2E, Tauri 2

## Global Constraints

- 메인 창은 `1000×720`으로 시작하고 최소 `900×640`에서 가로·세로 전체 스크롤이 없어야 한다.
- 라이트·다크 테마, 마지막 선택 저장, 오프라인 동작과 원격 런타임 의존성 금지를 유지한다.
- 운영 데이터와 실제 개인정보를 fixture, 스크린샷, 로그 또는 Git에 포함하지 않는다.
- 현장 배부와 신청자 관리의 기존 기능, 단축키, 검색, 필터, 정렬, 되돌리기와 팝오버 동작을 보존한다.
- 제품 변경에는 명세, 도움말, 릴리스 노트와 관련 E2E를 함께 갱신한다.
- 커밋 전 `just check`를 실행하고 pre-commit hook을 우회하지 않는다.
- GitHub Actions 무료 분량을 쓰지 않도록 커밋은 `[skip ci]`로 푸시하고 Windows 검증 미실행을 명시한다.

---

### Task 1: 요구사항과 결정 기록 개정

**Files:**

- Modify: `PROJECT_SPEC.md`
- Modify: `docs/RELEASE_NOTES_0.1.0.md`

**Interfaces:**

- Consumes: 승인된 B안 76px 좌측 레일 목업과 전화번호 비상시 열 결정
- Produces: `FR-DIST-024`, `FR-DIST-025`, 개정된 `ADR-029`

- [ ] **Step 1: 명세 검사에 실패하는 새 요구사항 참조를 먼저 추가**

  `scripts/check_project.py`가 요구사항 ID 중복과 필수 문서를 검사하므로 `PROJECT_SPEC.md`에 다음 ID와 수용 조건을 추가한다.

  ```markdown
  - **FR-DIST-024**: 앱의 주요 화면 전환은 76px 좌측 레일에서 제공하고 현재 화면을 색상, 배경, 왼쪽 강조선과 `aria-current`로 함께 표시한다.
  - **FR-DIST-025**: 현장 배부 표에서는 전화번호 열을 숨기되 전화번호 검색, 행의 접근성 이름·툴팁, 신청자 상세·수정 및 신청자 관리에서는 전체 전화번호를 확인할 수 있어야 한다.
  ```

- [ ] **Step 2: 문서 검사를 실행해 변경 전 계약 충돌을 확인**

  Run: `python scripts/check_project.py`

  Expected: 새 ID는 유효하지만 기존 `ADR-029`, 8.1 및 `FR-DIST-006`의 상단 내비게이션·전화번호 상시 표시 문구가 수동 검토에서 충돌함을 확인한다.

- [ ] **Step 3: 기존 계약을 한 방향으로 정리**

  `FR-DIST-006`, 8.1, 8.1.1, 12.2, 12.4, 14절과 `ADR-029`를 다음 원칙으로 개정한다.

  ```text
  76px 좌측 레일: QT 로고 / 현장 배부 / 신청자 관리 / 도움말 / 테마 / 담당자
  현장 배부 목록: 또래 / 신청자 / 구독 / 배부 / 동작
  전화번호: 검색 가능, 시각적 기본 열에서는 숨김, 툴팁·접근성 이름·상세에서 전체 접근
  레일과 통계는 고정, 기존 허용 영역만 내부 스크롤
  ```

  변경 이력과 릴리스 노트에는 2026-08-03 결정을 추가한다. 데이터·업무 규칙이 변하지 않으므로 SQLite 마이그레이션과 새 운영 로그 이벤트는 필요하지 않음을 명시한다.

- [ ] **Step 4: 문서 검사를 실행**

  Run: `python scripts/check_project.py`

  Expected: `Verified 128 unique requirement IDs.`

- [ ] **Step 5: 문서 계약 커밋**

  ```bash
  git add PROJECT_SPEC.md docs/RELEASE_NOTES_0.1.0.md
  git commit -m "docs: adopt compact left navigation [skip ci]"
  ```

### Task 2: 독립적인 좌측 내비게이션 컴포넌트

**Files:**

- Create: `src/AppNavigation.tsx`
- Create: `src/AppNavigation.test.tsx`
- Modify: `src/Icons.tsx`
- Modify: `src/App.tsx`

**Interfaces:**

- Consumes: `Theme`, `BookLogo`, 기존 화면 전환·테마·도움말·담당자 콜백
- Produces: `AppNavigationProps`, `AppNavigation`

- [ ] **Step 1: 내비게이션 의미 구조의 실패 테스트 작성**

  `renderToStaticMarkup`으로 별도 DOM 환경 없이 다음 구조를 검증한다.

  ```tsx
  const html = renderToStaticMarkup(
    <AppNavigation
      active="distribution"
      operator="가상담당자"
      theme="dark"
      onDistribution={() => undefined}
      onManagement={() => undefined}
      onTheme={() => undefined}
      onHelp={() => undefined}
      onOperator={() => undefined}
    />,
  );
  expect(html).toContain('class="app-navigation"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('data-testid="open-management"');
  expect(html).toContain('data-testid="theme-toggle"');
  expect(html).toContain("2026 교육국 제작");
  ```

- [ ] **Step 2: 새 컴포넌트 테스트 실패 확인**

  Run: `pnpm test -- src/AppNavigation.test.tsx`

  Expected: FAIL because `AppNavigation.tsx` does not exist.

- [ ] **Step 3: 좌측 레일 컴포넌트 구현**

  다음 공개 타입을 사용한다.

  ```tsx
  export type AppNavigationProps = {
    active: "distribution" | "management";
    operator?: string | null;
    theme: Theme;
    onDistribution: () => void;
    onManagement: () => void;
    onTheme: () => void;
    onHelp: () => void;
    onOperator: () => void;
  };

  export function AppNavigation(props: AppNavigationProps) {
    return (
      <nav className="app-navigation" aria-label="주요 메뉴">
        <BookLogo />
        <button
          aria-current={props.active === "distribution" ? "page" : undefined}
        >
          현장 배부
        </button>
        <button
          data-testid="open-management"
          aria-current={props.active === "management" ? "page" : undefined}
        >
          신청자 관리
        </button>
      </nav>
    );
  }
  ```

  레일은 위에서부터 브랜드, `현장 배부`, `신청자 관리`, 구분선, 도움말, 테마를 두고 담당자는 맨 아래에 고정한다. 활성 버튼에는 `aria-current="page"`, 모든 아이콘 버튼에는 보이는 한국어 라벨과 `title`을 함께 둔다. 브랜드의 정보 버튼은 기존 `2026 교육국 제작` 툴팁을 유지한다. `Icons.tsx`에는 외부 패키지 없이 선형 SVG 아이콘 `DistributionIcon`, `PeopleIcon`, `HelpIcon`, `ThemeIcon`을 추가한다.

- [ ] **Step 4: `App`에서 상단 내비게이션을 교체**

  `TopNavigation` 내부 함수를 삭제하고 두 화면 분기에서 공통으로 `AppNavigation`을 사용한다. `.fixed-app`은 좌측 레일과 콘텐츠를 감싸고 `management-host`와 `desk`는 두 번째 열에 배치한다. 기존 콜백과 `data-testid`는 그대로 전달한다.

- [ ] **Step 5: 단위 테스트 통과 확인**

  Run: `pnpm test -- src/AppNavigation.test.tsx src/App.test.tsx`

  Expected: PASS.

- [ ] **Step 6: 컴포넌트 커밋**

  ```bash
  git add src/AppNavigation.tsx src/AppNavigation.test.tsx src/Icons.tsx src/App.tsx
  git commit -m "feat: move primary navigation to a left rail [skip ci]"
  ```

### Task 3: 전화번호 비상시 열과 신청자 표 폭 재배분

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/core.e2e.ts`

**Interfaces:**

- Consumes: `DeskPerson.phone`, 기존 전화번호 검색과 `openPersonEdit`
- Produces: `personAccessibilityLabel(person: DeskPerson): string`

- [ ] **Step 1: 전화번호 접근성 회귀 E2E를 먼저 작성**

  익명 신청자를 전화번호로 검색한 뒤 다음을 검증한다.

  ```ts
  expect(await textOf(".table-head")).not.toContain("전화번호");
  expect(await textOf('[data-testid="person-row"]')).not.toContain(
    expiredPhone,
  );
  expect(
    await browser.execute(() =>
      document
        .querySelector('[data-testid="person-row"]')
        ?.getAttribute("aria-label"),
    ),
  ).toContain(expiredPhone);
  ```

  이어서 행을 더블클릭하여 수정 대화상자의 `input[name='phone']` 값이 그대로인지 검증한다.

- [ ] **Step 2: 실제 Tauri E2E에서 실패 확인**

  Run: `just e2e`

  Expected: FAIL because the current `.phone` element exposes the phone number in the visible row and the table header still contains `전화번호`.

- [ ] **Step 3: 현장 배부 행에서 전화번호 열 제거**

  `.table-head`의 전화번호 `<span>`과 `PersonRow`의 `.phone` 요소를 제거한다. 전화번호 값은 삭제하지 않고 다음 레이블과 툴팁에 사용한다.

  ```ts
  function personAccessibilityLabel(person: DeskPerson) {
    return [
      person.cohort ? `${person.cohort}또래` : "또래 미입력",
      person.name,
      person.phone ?? "연락처 없음",
      person.subscriptionStatus,
      person.distributionStatus,
    ].join(", ");
  }
  ```

  `PersonRow`의 `aria-label`에는 이 값을 넣고 이름 셀의 `title`에는 `이름 · 전체 전화번호`를 넣는다. 더블클릭·점 세 개·우클릭 정보 수정은 기존 전체 전화번호 입력을 유지한다. 신청자 관리의 목록·상세 전화번호는 변경하지 않는다.

- [ ] **Step 4: 5열 표 그리드로 폭 재배분**

  `.table-head`와 `.person-row`를 다음 역할에 맞게 바꾼다.

  ```css
  grid-template-columns:
    42px
    minmax(118px, 1.15fr)
    minmax(150px, 1.35fr)
    minmax(72px, 0.7fr)
    122px;
  ```

  또래, 신청자, 구독, 배부, 동작 순서를 유지하고 900px 최소 창에서도 배부 버튼과 점 세 개가 잘리지 않게 한다.

- [ ] **Step 5: TypeScript와 빠른 테스트 실행**

  Run: `pnpm build:e2e && pnpm test`

  Expected: PASS.

- [ ] **Step 6: 표 변경 커밋**

  ```bash
  git add src/App.tsx src/styles.css tests/e2e/core.e2e.ts
  git commit -m "feat: move distribution phone details out of the table [skip ci]"
  ```

### Task 4: 76px 레일과 크기 조절 레이아웃 완성

**Files:**

- Modify: `src/styles.css`
- Modify: `src/phase3.css`
- Modify: `tests/e2e/core.e2e.ts`

**Interfaces:**

- Consumes: `.app-navigation`, `.desk`, `.management-host`, 기존 CSS 테마 변수
- Produces: 1000×720 기본 및 900×640 최소 크기 레이아웃 계약

- [ ] **Step 1: 레이아웃 E2E 수용 조건 추가**

  다크·라이트 화면에서 다음을 검증한다.

  ```ts
  const navigation = document.querySelector<HTMLElement>(".app-navigation")!;
  const rect = navigation.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    fullHeight:
      Math.round(rect.height) === document.documentElement.clientHeight,
    bodyFits:
      document.body.scrollWidth === document.body.clientWidth &&
      document.body.scrollHeight === document.body.clientHeight,
    active: navigation.querySelector('[aria-current="page"]')?.textContent,
  };
  ```

  1000×720과 900×640에서 `width === 76`, `fullHeight === true`, `bodyFits === true`를 확인하고 현장 배부→신청자 관리 전환 뒤 `aria-current`가 바뀌는지 검증한다.

- [ ] **Step 2: 현재 E2E에서 실패 확인**

  Run: `just e2e`

  Expected: FAIL because `.app-navigation` and the 76px rail contract are not yet styled.

- [ ] **Step 3: 레일과 본문 CSS 구현**

  ```css
  .fixed-app {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }

  .app-navigation {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border-right: 1px solid var(--line);
    background: color-mix(in srgb, var(--panel) 82%, var(--canvas));
  }
  ```

  레일 버튼은 최소 44px 클릭 영역, 보이는 포커스, 저채도 활성 배경과 왼쪽 3px accent를 사용한다. 로고 46px, 메뉴 라벨 10~11px, 담당자 이름 줄임표를 적용한다. 원격 폰트나 새 패키지는 추가하지 않는다.

- [ ] **Step 4: 세로 공간을 본문에 재배분**

  `.desk`의 첫 행은 84px을 유지하거나 실제 캡처에서 통계 기준선이 맞는 최소값으로 줄이고, 제거된 70px 상단 행은 목록 높이로 돌린다. `.management-host`, `.management-shell`은 남은 두 번째 열의 전체 높이를 사용한다. 900×640 미디어 쿼리는 레일 너비를 줄이지 않고 본문 패딩·우측 패널만 조정해 메뉴 레이블을 보존한다.

- [ ] **Step 5: E2E 통과 및 다크·라이트 캡처**

  Run: `just e2e`

  Expected: 모든 Tauri E2E PASS, 다음 캡처 생성.

  ```text
  test-results/ui-left-navigation-dark.png
  test-results/ui-left-navigation-light.png
  test-results/ui-left-navigation-minimum.png
  test-results/ui-management-left-navigation.png
  ```

- [ ] **Step 6: 캡처를 B안 목업과 시각 비교**

  실제 앱에서 레일 너비, 활성 상태, 4칸 통계, 5열 표, 우측 확인 영역, 최소 창 잘림을 확인한다. 제품 캡처나 개인정보가 포함된 화면은 Git에 추가하지 않는다.

- [ ] **Step 7: 레이아웃 커밋**

  ```bash
  git add src/styles.css src/phase3.css tests/e2e/core.e2e.ts
  git commit -m "style: fit the app around a compact navigation rail [skip ci]"
  ```

### Task 5: 도움말, 최종 검증과 설치본 갱신

**Files:**

- Modify: `src/HelpPanel.tsx`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/RELEASE_CHECKLIST.md`
- Test: `tests/e2e/core.e2e.ts`

**Interfaces:**

- Consumes: 최종 좌측 레일과 전화번호 상세 접근 방식
- Produces: 담당자용 최신 오프라인 안내와 설치 가능한 macOS 빌드

- [ ] **Step 1: 도움말 문구 갱신**

  빠른 시작과 화면 설명에서 상단 메뉴를 좌측 메뉴로 바꾸고 다음 내용을 명시한다.

  ```text
  전화번호로 검색할 수 있습니다.
  현장 배부 목록에서는 연락처를 숨기며, 신청자 이름에 마우스를 올리거나
  더블클릭해 정보 수정 창을 열면 전체 연락처를 확인할 수 있습니다.
  ```

- [ ] **Step 2: 도움말 E2E 확인 추가**

  좌측 레일의 도움말 버튼으로 패널을 열고 `좌측 메뉴`와 `연락처` 안내가 보이는지 확인한다. 테마 버튼과 담당자 버튼도 기존 동작을 유지하는지 확인한다.

- [ ] **Step 3: 포맷과 전체 로컬 검사**

  Run: `just format && just check`

  Expected: 포맷, ESLint, Clippy, 명세 검사, Vitest와 Rust 전체 테스트 PASS.

- [ ] **Step 4: 최종 macOS Tauri E2E**

  Run: `just e2e`

  Expected: 모든 E2E PASS. 경고가 있더라도 테스트 결과 0 failure를 직접 확인한다.

- [ ] **Step 5: macOS 패키징과 설치본 교체**

  Run: `just package`

  Expected: `target/release/bundle/macos/QT Manager.app`와 Apple Silicon DMG 생성 성공. 실행 중인 기존 앱을 정상 종료한 뒤 새 `.app`을 `/Applications/QT Manager.app`에 복사하고 실행해 좌측 레일, 로컬 데이터 유지, 한글 표시를 확인한다.

- [ ] **Step 6: 최종 문서·검증 커밋**

  ```bash
  git add src/HelpPanel.tsx docs/USER_GUIDE.md docs/RELEASE_CHECKLIST.md tests/e2e/core.e2e.ts
  git commit -m "docs: explain left navigation and hidden phone details [skip ci]"
  ```

- [ ] **Step 7: 푸시와 외부 검증 상태 확인**

  Run: `git push origin main && gh run list --limit 3 --repo benlee73/qtManager`

  Expected: `main` push 성공, `[skip ci]` 커밋 때문에 새 GitHub Actions 실행 없음. Windows 실장비 검증은 미완료로 완료 보고에 명시한다.

## Plan Self-Review

- 요구사항 범위: 좌측 레일, 활성 상태, 전화번호 검색·상세 접근, 현장/관리 화면, 최소 창, 테마, 도움말, E2E, 패키징과 문서가 각 Task에 연결돼 있다.
- 데이터 영향: Person/SQLite/XLSX 형식과 업무 이력에는 변경이 없다.
- 접근성: 보이는 라벨, `aria-current`, 키보드 포커스, 전화번호 접근성 이름을 보존한다.
- 개인정보: 실제 운영 데이터나 전화번호를 fixture·로그·Git에 추가하지 않는다.
- 미결정 사항: 현장 배부 목록에서만 전화번호를 숨기고 신청자 관리·상세에서는 계속 표시하는 것으로 명시했다.
