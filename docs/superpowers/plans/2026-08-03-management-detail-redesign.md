# 신청자 관리 정보구조 정비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신청자 목록의 비정상적인 행 확장을 제거하고 오늘이 포함된 QT 호 기준 구독 상태, 신청자 메모, 연결된 확인할 일과 읽기 쉬운 배부 이력을 신청자 관리 화면에 제공한다.

**Architecture:** 신청자 상세 유스케이스가 명시적인 기준 호를 받아 구독 상태를 계산하고, 신청자 관리 저장소 포트가 연결된 확인할 일을 함께 제공한다. Tauri 어댑터만 시스템 날짜를 읽으며 React UI는 반환된 상태를 표현하고 문자열이나 날짜로 업무 규칙을 재계산하지 않는다. 기존 SQLite v3 컬럼을 조회하므로 스키마 마이그레이션은 추가하지 않는다.

**Tech Stack:** Rust 1.97, Tauri 2, SQLite/rusqlite, React 19, TypeScript 5.9, CSS, Vitest, WebdriverIO Tauri E2E, Just

## Global Constraints

- 앱은 macOS와 Windows에서 인터넷 연결 없이 동일한 핵심 기능을 제공해야 한다.
- 실제 배부 자격은 현장 배부 화면에서 선택한 QT 호를 기준으로 유지한다.
- 신청자 관리의 구독 강조만 오늘 날짜가 실제로 포함된 두 달 단위 QT 호를 기준으로 한다.
- 이름, 전화번호, 신청자 메모와 확인할 일 내용은 애플리케이션 로그·업무 변경 이력 요약·테스트 fixture에 기록하지 않는다.
- 런타임 의존성이나 원격 폰트·CDN·원격 분석을 추가하지 않는다.
- 모든 제품 코드 변경은 실패하는 자동화 테스트를 먼저 작성하고 확인한 뒤 구현한다.
- 각 작업 커밋 전에 `just check`를 실행하며 pre-commit hook을 우회하지 않는다.
- `current-phase3.png`와 `design-previews/`는 사용자의 미추적 파일이므로 수정·추가·삭제하지 않는다.

---

## File map

- `crates/qt-application/src/phase3.rs`: 오늘 포함 호 변환, 구독 기간 상태, 신청자 연결 확인할 일 상세 계약과 정렬
- `crates/qt-application/src/lib.rs`: 새 Phase 3 공개 타입과 함수 재노출
- `crates/qt-infrastructure/src/sqlite_people_management.rs`: 신청자별 활성 확인할 일 SQLite 조회
- `crates/qt-infrastructure/tests/people_management.rs`: SQLite 재실행 후 상세 정보 통합 검증
- `src-tauri/src/lib.rs`: 서울 기준 시스템 날짜를 오늘 포함 호로 바꾸어 상세 유스케이스에 전달
- `src/phase3.ts`: 구독 상태와 연결 확인할 일 TypeScript 계약
- `src/ManagementDetail.tsx`: 신청자 목록과 상세 표시 전용 컴포넌트
- `src/ManagementDetail.test.tsx`: 목록·메모·확인할 일·구독·배부 표 정적 렌더링 회귀 테스트
- `src/ManagementScreen.tsx`: 조회·선택·대화상자 오케스트레이션과 상단 기능 위계
- `src/phase3.css`: 고정 행, 상태별 카드, 테마 경계선과 반응형 상세 배치
- `tests/e2e/core.e2e.ts`: 실제 Tauri 신청자 관리 핵심 흐름과 레이아웃·테마 검증
- `PROJECT_SPEC.md`: 요구사항, 업무 규칙, 화면, ADR, 로드맵과 변경 이력
- `src/HelpPanel.tsx`, `docs/USER_GUIDE.md`, `docs/RELEASE_NOTES_0.1.0.md`: 담당자용 설명과 릴리스 기록
- `src/HelpPanel.test.tsx`: 신청자 관리 도움말 문구 회귀 테스트

---

### Task 1: 오늘 포함 호와 신청자 상세 계약

**Files:**

- Modify: `crates/qt-application/src/phase3.rs:1-245, 560-850`
- Modify: `crates/qt-application/src/lib.rs:45-60`
- Modify: `src-tauri/src/lib.rs:1-25, 480-505`
- Modify: `crates/qt-infrastructure/tests/people_management.rs:1-135` (새 함수 인자 반영)

**Interfaces:**

- Produces: `issue_containing_date(today: &str) -> Result<Issue, ApplicationError>`
- Produces: `SubscriptionPeriodState::{Current, Scheduled, Past, Archived}` serialized as `current|scheduled|past|archived`
- Produces: `LinkedCheckItemView { id, summary, status, updated_at }`
- Changes: `load_person_detail(repository, person_id, reference_issue)`
- Changes: `PeopleManagementRepository::list_person_check_items(person_id)`; 기본 구현은 빈 목록이며 Task 2에서 SQLite 조회로 교체

- [ ] **Step 1: Write a failing date-to-issue test**

Add a parameterized test to `phase3.rs` proving that dates map to the issue that contains the day, not the next distribution issue.

```rust
#[test]
fn maps_today_to_the_issue_that_contains_the_calendar_month() {
    for (date, expected) in [
        ("2026-01-01", Issue::new(2026, 1).unwrap()),
        ("2026-02-28", Issue::new(2026, 1).unwrap()),
        ("2026-08-03", Issue::new(2026, 7).unwrap()),
        ("2026-12-31", Issue::new(2026, 11).unwrap()),
    ] {
        assert_eq!(issue_containing_date(date).unwrap(), expected);
    }
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cargo test -p qt-application maps_today_to_the_issue_that_contains_the_calendar_month`

Expected: compilation fails because `issue_containing_date` does not exist.

- [ ] **Step 3: Implement strict date-to-issue conversion**

Parse exact `YYYY-MM-DD` year and month, reject malformed values through a dedicated application error, and use odd `start_month` (`even month - 1`, otherwise the month) with `Issue::new`.

```rust
pub fn issue_containing_date(today: &str) -> Result<Issue, ApplicationError> {
    let year = today.get(0..4).and_then(|v| v.parse().ok());
    let month = today.get(5..7).and_then(|v| v.parse::<u8>().ok());
    let (Some(year), Some(month)) = (year, month) else {
        return Err(ApplicationError::InvalidCurrentDate);
    };
    Issue::new(year, if month % 2 == 0 { month - 1 } else { month })
        .map_err(Into::into)
}
```

- [ ] **Step 4: Verify GREEN, then add invalid-date coverage**

Run the focused test, add assertions for malformed text and month `00`, then run again. The first malformed-date assertion must fail before adding `ApplicationError::InvalidCurrentDate` to `crates/qt-application/src/lib.rs`.

- [ ] **Step 5: Write a failing detailed-state and linked-item test**

Extend `MemoryRepository` with `check_items: Vec<CheckItem>`. Create archived, past, current and scheduled subscriptions around reference issue `2026년 7~8월호`, plus needs-check, checked, archived and other-person items. Assert:

```rust
let detail = load_person_detail(&mut repository, "person-1", Issue::new(2026, 7).unwrap()).unwrap();
assert_eq!(
    detail.subscriptions.iter().map(|item| item.period_state).collect::<Vec<_>>(),
    vec![
        SubscriptionPeriodState::Current,
        SubscriptionPeriodState::Scheduled,
        SubscriptionPeriodState::Past,
        SubscriptionPeriodState::Archived,
    ],
);
assert_eq!(detail.check_items.len(), 2);
assert_eq!(detail.check_items[0].status, "확인 필요");
assert_eq!(detail.check_items[1].status, "확인 완료");
```

- [ ] **Step 6: Run the detailed-state test and verify RED**

Run: `cargo test -p qt-application loads_period_states_and_only_active_linked_check_items`

Expected: compilation fails because the new state, repository method, function parameter and detail field do not exist.

- [ ] **Step 7: Implement the minimal application contract**

Add the default repository method, serializable state/view types and `PersonDetail.check_items`. Map archived subscriptions first; otherwise reuse `Subscription::assess(reference_issue, false)`. Sort by state rank `current, scheduled, past, archived`, then descending `start_issue`. Map only repository-returned non-archived linked checks and use the existing Korean check-state labels.

- [ ] **Step 8: Run application tests and refactor**

Run: `cargo test -p qt-application phase3::tests`

Expected: all Phase 3 tests pass. Keep date parsing, state mapping and ordering as separate private functions rather than embedding them in DTO construction.

- [ ] **Step 9: Update every existing call site and the Tauri date adapter**

Pass an explicit reference issue from all Rust tests. In `load_person_detail_command`, create `SystemRuntime`, call `issue_containing_date(&runtime.today())`, and pass the result to the use case. Do not pass the field-distribution selected issue and do not log the date or person ID.

- [ ] **Step 10: Verify the full workspace and commit the application contract**

Run: `just check`

Expected: all existing call sites compile and every check passes before the commit.

```bash
git add crates/qt-application/src/phase3.rs crates/qt-application/src/lib.rs src-tauri/src/lib.rs crates/qt-infrastructure/tests/people_management.rs
git commit -m "feat: expose management subscription states"
```

---

### Task 2: SQLite 연결 확인할 일 조회

**Files:**

- Modify: `crates/qt-infrastructure/src/sqlite_people_management.rs:1-145`
- Modify: `crates/qt-infrastructure/tests/people_management.rs:1-135`

**Interfaces:**

- Consumes: `PeopleManagementRepository::list_person_check_items(person_id)`
- Produces: one atomic `PersonDetail` response containing subscriptions, distributions, person note and active linked check items

- [ ] **Step 1: Write a failing SQLite integration test**

In `people_management.rs`, use `DistributionDeskRepository::save_check_item` to store needs-check, checked, archived and other-person fixtures with synthetic content. Reopen SQLite and assert that `load_person_detail(..., Issue::new(2026, 7).unwrap())` returns only the first two in latest-update order and preserves the person note.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `cargo test -p qt-infrastructure --test people_management`

Expected: failure or empty items because `SqliteCoreRepository` has no person-linked check query.

- [ ] **Step 3: Implement the parameterized SQLite query**

Add:

```sql
SELECT id, person_id, content, status, operator_name, created_at, updated_at, checked_at
FROM check_items
WHERE person_id = ?1 AND status != 'archived'
ORDER BY updated_at DESC, id DESC
```

Map rows through the existing `check_item_from_row` helper; do not add a migration or new index for the 2026 data size.

- [ ] **Step 4: Verify SQLite GREEN**

Run: `cargo test -p qt-infrastructure --test people_management`

Expected: all tests pass after database reopen.

- [ ] **Step 5: Verify the full workspace and commit infrastructure**

Run:

```bash
cargo test -p qt-infrastructure --test people_management
cargo test -p qt-application phase3::tests
just check
```

Then commit:

```bash
git add crates/qt-infrastructure/src/sqlite_people_management.rs crates/qt-infrastructure/tests/people_management.rs
git commit -m "feat: load linked checks in person details"
```

---

### Task 3: 신청자 목록과 상세 컴포넌트

**Files:**

- Create: `src/ManagementDetail.tsx`
- Create: `src/ManagementDetail.test.tsx`
- Modify: `src/ManagementScreen.tsx:1-260`
- Modify: `src/phase3.ts:5-55`
- Modify: `src/phase3.css:1-235`

**Interfaces:**

- Consumes: `PersonSummary` and extended `PersonDetail`
- Produces: `ManagementPersonList` and `PersonDetailPanel` presentation components
- Produces test IDs: `management-person-primary`, `management-person-meta`, `person-note`, `linked-check-items`, `subscription-current|scheduled|past|archived`, `distribution-history-header`

- [ ] **Step 1: Write failing render tests against the desired TypeScript contract**

Create the test first and import the not-yet-existing presentation components. Describe fixture subscriptions with the desired discriminated union:

```ts
export type SubscriptionPeriodState =
  | "current"
  | "scheduled"
  | "past"
  | "archived";
```

Render a two-person list and detail fixture, then assert:

- phone text is absent from the list markup but present in detail markup;
- metadata reads `정식 등록 · 구독 2건`;
- the empty note text appears when `personNote` is null;
- needs-check and checked linked content both appear;
- all four state labels/classes render;
- `배부 호`, `처리`, `처리 시각` headers render.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm vitest run src/ManagementDetail.test.tsx`

Expected: failure because the presentation components do not exist.

- [ ] **Step 3: Extract focused presentation components**

Add `SubscriptionPeriodState`, `periodState` and `checkItems` to `src/phase3.ts`, then move list and detail rendering from `ManagementScreen.tsx` into `ManagementDetail.tsx`. Keep selection, mutation, dialog and async loading in `ManagementScreen`. The list component receives `people`, `selectedId`, and `onSelect`; the detail component receives `detail`, action callbacks and `busy`.

Render linked checks read-only with a native disabled checkbox or an `aria-checked` visual element so both text and non-color state are available. Do not reuse an interactive handler from the field screen.

- [ ] **Step 4: Implement CSS layout and state hierarchy**

Make rows content-sized:

```css
.management-person-list {
  align-content: start;
  grid-auto-rows: max-content;
}
```

Use a three-line row without phone, preserve the selected left accent, and add state classes using existing theme tokens. Add a true three-column distribution header and replace `#edf0ea` with `var(--line)`. Use `font-variant-numeric: tabular-nums` for quantity and timestamp. Ensure current state is most prominent while every state retains a text label.

- [ ] **Step 5: Verify component GREEN and accessibility**

Run:

```bash
pnpm vitest run src/ManagementDetail.test.tsx
pnpm lint
```

Check that buttons retain `type="button"`, selected rows keep an accessible state, full phone remains in detail, and long values retain truncation/title behavior where necessary.

- [ ] **Step 6: Write a failing top-action hierarchy assertion**

Render or inspect the management heading and assert that `신청자 등록` uses `primary-button compact`, while `데이터 백업·복원` and `Google 응답 붙여넣기` use `secondary-button compact` and all three remain present.

- [ ] **Step 7: Implement the compact heading actions and verify GREEN**

Shorten only the registration label from `+ QT 신청자 정식 등록` to `+ 신청자 등록`. Do not hide backup/restore. Run the focused Vitest file and ensure the three controls fit at the minimum window width.

- [ ] **Step 8: Run the full check and commit the UI unit**

Run: `just check`

Expected: frontend and Rust contracts compile together and all checks pass.

```bash
git add src/ManagementDetail.tsx src/ManagementDetail.test.tsx src/ManagementScreen.tsx src/phase3.ts src/phase3.css
git commit -m "feat: clarify management person details"
```

---

### Task 4: 실제 Tauri 흐름과 시각 회귀

**Files:**

- Modify: `tests/e2e/core.e2e.ts:850-970`

**Interfaces:**

- Consumes: production Tauri commands, SQLite and rendered management components
- Produces: screenshots `test-results/ui-management-light.png` and `test-results/ui-management-dark.png`

- [ ] **Step 1: Add failing E2E assertions before CSS/flow acceptance**

Extend the existing management scenario to calculate the current calendar issue in test code, create a current and a past subscription plus a linked check item, and assert:

- every visible management row height is below a fixed content-height ceiling and two results do not divide all remaining height;
- list text excludes the fixture phone while detail includes it;
- current and past state markers both appear;
- person note and linked check text appear in detail;
- three distribution headers are present;
- all three heading actions are visible and primary/secondary classes match the contract.

- [ ] **Step 2: Run Tauri E2E and verify RED**

Run: `just e2e`

Expected: the new DOM, state and row-height assertions fail against the old UI.

- [ ] **Step 3: Complete only fixes exposed by the desktop test**

Adjust responsive CSS at the supported minimum size without adding body/root scroll. Keep list and detail as independent internal scroll regions. If Retina coordinates differ, assert logical relationships and maximum row height rather than screenshot pixel equality.

- [ ] **Step 4: Capture and inspect both themes**

Save light and dark screenshots after the detail is populated. Compare them with the established Discord/TablePlus density and verify:

- selected row does not fill unused list height;
- current subscription is clear without overpowering the identity header;
- past subscriptions remain readable;
- distribution separators use the same `var(--line)` theme token as surrounding panels;
- no horizontal page scroll appears at minimum size or after resizing wider.

- [ ] **Step 5: Verify E2E GREEN and commit**

Run: `just e2e`

Expected: all desktop scenarios pass. Run `just check` once more, then commit only E2E source changes; generated screenshots stay ignored unless the repository already tracks the exact output path.

```bash
git add tests/e2e/core.e2e.ts
git commit -m "test: cover management detail hierarchy"
```

---

### Task 5: 프로젝트 기준 문서와 담당자 안내

**Files:**

- Modify: `PROJECT_SPEC.md`
- Modify: `src/HelpPanel.tsx:120-180`
- Create: `src/HelpPanel.test.tsx`
- Modify: `docs/USER_GUIDE.md:35-105`
- Modify: `docs/RELEASE_NOTES_0.1.0.md`

**Interfaces:**

- Documents: 오늘 포함 호는 관리 화면 표시 기준이며 선택 호는 배부 자격 기준
- Documents: 신청자 메모와 연결 확인할 일의 역할 및 보관 항목 위치

- [ ] **Step 1: Add help-copy assertions first**

Create `src/HelpPanel.test.tsx`, render `HelpPanel` with synthetic support info, and assert that the management help includes `오늘이 포함된 호`, `연결된 확인할 일`, and `신청자 메모`.

- [ ] **Step 2: Run the focused check and verify RED**

Run:

```bash
python scripts/check_project.py
pnpm test
```

Expected: the new help assertion fails before `HelpPanel.tsx` is updated.

- [ ] **Step 3: Update the single source of truth**

Add requirements and an ADR covering:

- content-height management rows and phone removal from list only;
- current/scheduled/past/archived subscription display based on today-containing issue;
- unchanged selected-issue distribution eligibility;
- read-only active linked checks and always-visible person note;
- table headers and theme token borders;
- no migration and no new read-only operational log event.

Update the Phase 3.5 completion note and change history without personal information.

- [ ] **Step 4: Update help, guide and release notes**

Explain where operators find full phone, person note and linked checks, and that archived checks remain in the field-screen archive. Keep the copy task-oriented and avoid internal terms such as DTO or repository.

- [ ] **Step 5: Verify and commit documentation**

Run:

```bash
python scripts/check_project.py
pnpm test
just check
```

Then commit:

```bash
git add PROJECT_SPEC.md src/HelpPanel.tsx src/HelpPanel.test.tsx docs/USER_GUIDE.md docs/RELEASE_NOTES_0.1.0.md
git commit -m "docs: explain management detail context"
```

---

### Task 6: 전체 검증, 설치본 교체와 전달

**Files:**

- Verify only: all changed files
- Preserve: `current-phase3.png`, `design-previews/`

**Interfaces:**

- Produces: checked source, macOS desktop E2E result, verified local application bundle and concise Windows validation status

- [ ] **Step 1: Review changes and privacy boundaries**

Run:

```bash
git status --short
git diff --check
rg -n "010-|가상관리|신청자 메모" PROJECT_SPEC.md docs src crates tests
```

Inspect matches so only synthetic test values exist in tests and no screenshots/logs with operating data are staged.

- [ ] **Step 2: Run the mandatory full check**

Run: `just check`

Expected: Prettier, ESLint, rustfmt, Clippy, project checker, all Vitest and Rust workspace tests pass with no warnings.

- [ ] **Step 3: Run macOS desktop E2E once more**

Run: `just e2e`

Expected: all Tauri WebdriverIO scenarios pass, including both management screenshots and scroll/layout assertions.

- [ ] **Step 4: Build and verify the local macOS application**

Run: `pnpm tauri build --bundles app`, ad-hoc sign the generated bundle if required, verify with `codesign --verify --deep --strict`, safely replace `/Applications/QT Manager.app`, and open it. Preserve Application Support data and keep the previous bundle in a recoverable temporary location until the new app launches.

- [ ] **Step 5: Record cross-platform status**

Do not consume paid GitHub Actions minutes. Record macOS local verification as complete and Windows package/runtime verification as pending until the $0-budget Actions reset or a Windows device is available. No OS-specific CSS, path or runtime dependency may remain.

- [ ] **Step 6: Final commit and push**

If verification required source or document corrections, commit each correction by purpose after rerunning `just check`. Confirm only the two pre-existing untracked design paths remain, then push `main` without bypassing hooks.

- [ ] **Step 7: Report completion**

Summarize changed information structure, today-vs-selected-issue distinction, absence of SQLite migration, test counts, visual inspection, installed app result, commits, push and Windows validation status.
