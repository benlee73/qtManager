# 현장 가독성 후속 정비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선택 호 전체 통계를 안정적으로 유지하고, 연결 확인 정보와 타이포그래피·브랜드·아이콘의 현장 가독성을 개선한다.

**Architecture:** 전체 통계와 확인할 일 전문은 Rust 애플리케이션 계층의 기존 `DistributionDesk` 조회 계약으로 제공하고 React는 표시만 담당한다. 시각 변경은 기존 CSS 토큰과 아이콘 생성 흐름을 조정하며 새 런타임 의존성이나 데이터 마이그레이션은 추가하지 않는다.

**Tech Stack:** Rust, SQLite, Tauri 2, React, TypeScript, CSS, Vitest, WebdriverIO, Tauri icon tooling

## Global Constraints

- `PROJECT_SPEC.md`의 FR-DIST-018, FR-DIST-023, FR-DIST-027~028, FR-NOTE-004, FR-OPERATOR-005와 ADR-042를 따른다.
- 런타임 인터넷·원격 폰트·CDN·원격 분석 의존성을 추가하지 않는다.
- 실제 운영 이름·연락처·확인할 일 본문을 테스트 fixture, 운영 로그 또는 Git에 넣지 않는다.
- 1000×720 초기 창, 900×640 최소 창, 전체 문서 스크롤 금지와 영역별 내부 스크롤을 유지한다.
- 모든 변경은 테스트 우선으로 진행하고 커밋 전에 `just check`를 실행한다.
- GitHub Actions 무료 한도 기간에는 `[skip ci]`로 푸시하고 Windows 전용 검증 미실행을 보고한다.

---

### Task 1: 검색·필터와 독립적인 전체 통계

**Files:**

- Modify: `crates/qt-application/src/phase2.rs`
- Test: `crates/qt-application/src/phase2.rs`
- Test: `crates/qt-infrastructure/tests/distribution_desk.rs`

**Interfaces:**

- Consumes: `DistributionDeskRepository::list_desk_records(query, issue)`
- Produces: `DistributionDesk.totals`는 빈 검색 전체 레코드로 계산하고 `people`만 검색 결과를 사용한다.

- [x] **Step 1: 검색 결과는 한 명이어도 전체 대상 두 명의 통계를 유지하는 실패 테스트 작성**

```rust
let searched = load_distribution_desk(&mut repository, &clock, issue, "가상가", true)?;
assert_eq!(searched.people.len(), 1);
assert_eq!(searched.totals.target_people, 2);
```

- [x] **Step 2: 테스트를 실행해 현재 통계가 검색 결과 1명으로 줄어 실패하는지 확인**

Run: `cargo test -p qt-application totals_ignore_search -- --exact`

- [x] **Step 3: 빈 검색 전체 레코드에서 `all_people`, `person_names`, `DeskTotals`를 만들고 검색 결과는 목록에만 적용**

```rust
let all_records = repository.list_desk_records("", selected_issue)?;
let all_people = to_desk_people(all_records, selected_issue)?;
let totals = desk_totals(&all_people);
let people = if query.trim().is_empty() {
    all_people
} else {
    to_desk_people(repository.list_desk_records(query, selected_issue)?, selected_issue)?
};
```

- [x] **Step 4: 애플리케이션·SQLite 통합 테스트 실행**

Run: `cargo test -p qt-application totals_ignore_search && cargo test -p qt-infrastructure --test distribution_desk`

- [ ] **Step 5: 통계 계약 변경 커밋**

```bash
git add crates/qt-application/src/phase2.rs crates/qt-infrastructure/tests/distribution_desk.rs
git commit -m "fix: 검색과 무관하게 전체 배부 통계 유지 [skip ci]"
```

### Task 2: 신청자 수정창의 연결 확인할 일

**Files:**

- Modify: `crates/qt-application/src/phase2.rs`
- Modify: `src/phase2.ts`
- Modify: `src/App.tsx`
- Modify: `src/Phase3Dialogs.tsx`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`
- Test: `tests/e2e/core.e2e.ts`

**Interfaces:**

- Produces: `CheckItemView.summary: string`은 데이터 단계에서 자르지 않은 전문이며 우측 카드에서만 CSS로 줄임표 처리한다.
- Produces: `EditDialog`의 `checkItems: CheckItemView[]` prop은 선택 신청자의 미보관 연결 항목만 받는다.

- [x] **Step 1: 확인할 일 전문 직렬화와 수정창 표시 실패 테스트 작성**

```tsx
const markup = renderToStaticMarkup(
  <LinkedCheckItems
    items={[
      {
        id: "check-1",
        personId: "person-1",
        summary: "익명 권별 기간 확인",
        operatorName: "가상 담당자",
        updatedAt: "2026-08-03T00:00:00+09:00",
        status: "확인 필요",
        personName: "가상 신청자",
      },
    ]}
  />,
);
expect(markup).toContain("익명 권별 기간 확인 전문");
expect(markup).toContain("확인 필요");
```

- [x] **Step 2: Vitest와 Rust 계약 테스트의 실패 확인**

Run: `pnpm test -- --run src/App.test.tsx && cargo test -p qt-application check_item_view_keeps_full_content`

- [x] **Step 3: `CheckItemView`가 전문을 유지하고 `App`에서 선택 신청자의 연결 항목을 수정창에 전달**

```tsx
<EditDialog
  person={editPerson}
  checkItems={(desk?.checkItems ?? []).filter(
    (item) => item.personId === editPerson.id,
  )}
  busy={busy}
  onClose={() => setEditPerson(null)}
  onSaved={saveEditedPerson}
/>
```

- [x] **Step 4: 수정창 상단에 읽기 전용 `연결된 확인할 일` 목록과 상태 배지 구현**

```tsx
export function LinkedCheckItems({ items }: { items: CheckItemView[] }) {
  if (items.length === 0) return null;
  return (
    <section className="linked-check-items" aria-label="연결된 확인할 일">
      <h3>연결된 확인할 일</h3>
      {items.map((item) => (
        <article key={item.id}>
          <span>{item.status}</span>
          <p>{item.summary}</p>
        </article>
      ))}
    </section>
  );
}
```

- [x] **Step 5: 더블클릭 → 전문 확인 → Escape 닫기 E2E 추가 후 관련 검사 실행**

Run: `pnpm test && just e2e`

- [x] **Step 6: 연결 정보 흐름 커밋**

```bash
git add crates/qt-application/src/phase2.rs src/phase2.ts src/App.tsx src/Phase3Dialogs.tsx src/styles.css src/App.test.tsx tests/e2e/core.e2e.ts
git commit -m "feat: 신청자 수정창에 연결 확인 정보 표시 [skip ci]"
```

### Task 3: 타이포그래피·브랜드·입력 밀도 정비

**Files:**

- Modify: `src/AppNavigation.tsx`
- Modify: `src/styles.css`
- Modify: `src/phase3.css`
- Modify: `src/AppNavigation.test.tsx`
- Modify: `src/HelpPanel.tsx`
- Modify: `docs/RELEASE_NOTES_0.1.0.md`
- Test: `tests/e2e/core.e2e.ts`

**Interfaces:**

- CSS 토큰: `--font-xs: 11px`, `--font-sm: 12px`, `--font-md: 13px`, `--font-lg: 16px`, 테마별 `--placeholder`.
- `operator-status` 요소는 제거한다.

- [x] **Step 1: 내비게이션에서 상태점이 없고 확인할 일 연결 문구가 이름만 남는 실패 테스트 작성**

```tsx
expect(markup).not.toContain("operator-status");
expect(checkItemMarkup).toContain(">가상 신청자<");
expect(checkItemMarkup).not.toContain("가상 신청자 연결");
```

- [x] **Step 2: Vitest 실패 확인**

Run: `pnpm test -- --run src/AppNavigation.test.tsx`

- [x] **Step 3: 공통 글자 토큰과 관리 화면의 px/rem 혼용 값을 한 단계 상향하고 행·버튼 줄 높이를 최소 보정**

```css
:root {
  --font-xs: 11px;
  --font-sm: 12px;
  --font-md: 13px;
  --font-lg: 16px;
  --placeholder: #7f858e;
}
```

- [x] **Step 4: 브랜드 간격 확대, 초록점 제거, placeholder 대비, 얇은 키보드 포커스와 빠른 입력 높이 축소 적용**

```css
.rail-brand {
  gap: 5px;
}
.person-row:focus-visible {
  outline: 0;
  box-shadow: inset 0 0 0 1px var(--accent);
}
.sticky-input {
  padding-bottom: 6px;
}
```

- [x] **Step 5: 도움말·릴리스 노트와 900×640/1000×720 E2E 레이아웃 검증 갱신**

Run: `pnpm test && just e2e`

- [ ] **Step 6: 가독성 UI 커밋**

```bash
git add src/AppNavigation.tsx src/styles.css src/phase3.css src/AppNavigation.test.tsx src/HelpPanel.tsx docs/RELEASE_NOTES_0.1.0.md tests/e2e/core.e2e.ts
git commit -m "style: 현장 화면 글자와 정보 밀도 개선 [skip ci]"
```

### Task 4: 투명 외곽 앱 아이콘 재생성

**Files:**

- Modify: `src-tauri/icons/app-icon.svg`
- Modify: `src/assets/qt-manager-icon.png`
- Modify: `src-tauri/icons/*` generated desktop icon assets
- Test: `scripts/check_project.py`

**Interfaces:**

- 원본 SVG는 512×512 투명 캔버스 안에 흰 외곽선·그림자 없는 인디고 둥근 본체와 QT·성경책을 둔다.
- 모든 Tauri 아이콘과 좌측 레일 PNG는 같은 원본에서 생성한다.

- [ ] **Step 1: 모서리 alpha=0, 본체 경계의 흰 픽셀 부재, 본체 점유율 기준을 검사하는 실패 검증 추가**

```python
assert corner_alpha == 0
assert colored_bounds_ratio >= 0.88
assert outside_white_pixel_count == 0
```

- [ ] **Step 2: 프로젝트 검사 실패 확인**

Run: `python scripts/check_project.py`

- [ ] **Step 3: 기존 아이콘을 시각 기준으로 편집하고 투명 외곽·큰 본체 SVG/PNG 생성**

- [ ] **Step 4: Tauri 아이콘 생성 명령으로 macOS·Windows·레일 자산을 같은 원본에서 재생성**

Run: `pnpm tauri icon src-tauri/icons/app-icon.svg`

- [ ] **Step 5: alpha·점유율 검사와 macOS 앱 패키징 후 Dock/앱 화면을 실제 확인**

Run: `python scripts/check_project.py && just package`

- [ ] **Step 6: 아이콘 자산 커밋**

```bash
git add src-tauri/icons src/assets/qt-manager-icon.png scripts/check_project.py
git commit -m "style: 앱 아이콘 외곽과 크기 정비 [skip ci]"
```

### Task 5: 최종 검증과 배포 앱 갱신

**Files:**

- Verify: `PROJECT_SPEC.md`
- Verify: `docs/RELEASE_NOTES_0.1.0.md`
- Preserve untracked: `current-phase3.png`, `design-previews/`

- [ ] **Step 1: 라이트·다크, 900×640·1000×720 및 확장 창을 실제 캡처해 글자·간격·내부 스크롤을 비교**

- [ ] **Step 2: 전체 검사와 macOS 실제 Tauri E2E 실행**

Run: `just check && just e2e`

- [ ] **Step 3: macOS 앱과 DMG를 패키징하고 `/Applications/QT Manager.app`을 갱신**

Run: `just package`

- [ ] **Step 4: 개인정보 문자열과 의도하지 않은 파일 포함 여부 확인**

Run: `git diff --check && git status --short`

- [ ] **Step 5: 문서·테스트 잔여 변경이 있으면 검증 커밋으로 분리한 뒤 원격과의 차이를 확인하고 `main`에 푸시**

Run: `git fetch origin main && git rev-list --left-right --count origin/main...main && git push origin main`

- [ ] **Step 6: Windows 전용 검증 미실행과 로컬 검증 결과를 완료 보고에 구분해 기록**
