# 탭별 입력·목록·입금 화면 개선 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, task by task. Steps use checkbox syntax to track progress.

**Goal:** 현장 신청·구매 선택을 빠르고 확실하게 만들고, 실제 누락 기준으로 신청자를 정렬하며, 입금 대기와 내역 표의 위치를 일치시킨다.

**Architecture:** React 입력·선택 UI, Rust 애플리케이션의 신규 연간 신청 검증, SQLite 조회 정렬을 각 책임 계층에서 수정한다. 저장 스키마와 XLSX 형식은 유지한다.

**Tech Stack:** React/TypeScript, Rust, SQLite, Vitest, WebdriverIO/Tauri, just.

**Spec:** PROJECT_SPEC.md FR-DRAFT-001, FR-SALE-002/007/008/009, FR-SUB-014/022/023/028/032, FR-MEMO-016, FR-APPLY-006/007, FR-PAY-002/003, FR-XLSX-021, FR-HELP-006.

## Global Constraints

- 사용자 확정: 연간 신청 버튼 클릭 시 이름·또래의 오류를 빨간 입력칸과 메시지로 표시하고 저장하지 않는다. 연락처는 선택이다.
- 사용자 확정: 실제 또래 누락자를 먼저, 나머지는 이름·ID 순으로 표시한다. 군지체와 보관된 사람은 누락 우선 대상에서 제외한다.
- 또래 필수는 현장 신규 1년 구독에 적용한다. 기존 데이터·정보 수정·1달 구매의 선택 또래 계약은 유지한다.
- 개인정보가 있는 스크린샷을 fixture나 저장소에 복사하지 않는다. 새 패키지·원격 리소스를 추가하지 않는다.
- 조회·포커스 변경에 업무 이력을 만들지 않는다. 확정 저장의 기존 로그·업무 이력을 유지하고 검증 실패의 저장 부재를 검사한다.
- 현재 권한은 프로젝트 내부 쓰기만 허용한다. 외부 설치와 Git 메타데이터 쓰기에는 권한 제한이 있으므로 허용 범위에서 코드·검증 산출물을 준비한다.

## Review Focus

1. 빈 또래가 UI를 우회해 저장됨: Rust 거부·저장 부재와 UI 필드 오류 테스트.
2. IME Enter가 구매 선택/저장을 실행함: 조합 중 키 무시 E2E.
3. 검색 후보를 한 번 눌러도 선택되지 않음: 네이티브 포인터 단일 클릭 E2E, 후보 DOM 안정성 점검.
4. 내부 draft나 군지체가 누락자로 정렬됨: SQLite 혼합 상태·또래·군지체 정렬 통합 테스트.
5. 대기/내역의 내용에 따라 열 위치·높이가 변함: 최소·기본 창에서 머리글 좌표/크기와 체크박스 크기 E2E.

## Task 1 — 현장 신청 검증과 검색 표시

Files: src/draftValidation.ts, src/Phase2Dialogs.tsx, src/Phase2Dialogs.test.tsx, src/App.tsx, src/styles.css, crates/qt-application/src/phase2.rs, tests/e2e/core.e2e.ts.

- [x] 이름·또래 필수/00 허용/선택 연락처/저장 부재 회귀 테스트를 추가하고 단위 테스트 실패·수정 후 통과 확인.
- [x] 연간 설명을 제거하고 필드별 aria-invalid·오류 연결·첫 오류 포커스를 구현한다. Rust 신규 연간 신청에도 또래 필수를 적용한다.
- [x] 메모 돋보기를 입력창 안으로 배치하고 기존 검색 동작을 유지한다.
- [x] 관련 단위·통합 테스트 통과를 확인한다.

## Task 2 — 1달 구매 후보 선택

Files: src/Phase2Dialogs.tsx, src/PurchasePersonPicker.tsx, src/PurchasePersonPicker.test.tsx, src/purchasePeople.ts, src/styles.css, tests/e2e/core.e2e.ts.

- [x] 방향키·Enter·IME·단일 포인터 클릭·맨 아래 신규 항목의 E2E 회귀 테스트를 추가한다.
- [ ] 실제 데스크톱에서 회귀 테스트를 실행한다(현재 앱 시작 단계에서 차단).
- [x] 선택 UI를 작은 컴포넌트로 분리하고 combobox/listbox 선택 상태를 제공한다. 기존인 선택과 신규 모드는 명시적인 조작으로만 확정한다.
- [x] 장문 설명은 제거하고 선택 호만 간결하게 표시한다. 신규 항목은 결과 목록 마지막에 배치한다.
- [ ] 미일치 자동 신규, 조회 실패, 익명 구매, 되돌리기 동작을 검증한다.

## Task 3 — 신청자 관리 정렬·문구·배치

Files: crates/qt-infrastructure/src/sqlite_people_management.rs, crates/qt-infrastructure/tests/people_management.rs, src/Phase3Dialogs.tsx, src/ManagementDetail.tsx, src/phase3.css, src/styles.css, src/HandoverDialog.tsx, src/ApplicationImportDialog.tsx 및 관련 테스트.

- [x] 실제 누락 우선 정렬의 통합 테스트와 표시 변경의 회귀 테스트를 추가하고 통과를 확인한다.
- [x] 누락 우선·이름순 조회를 적용하고 또래가 있는 draft는 일반 이름순으로 포함한다.
- [x] 메모 빈 안내·정보 툴팁 제거, 구독 추가 명칭 통일, 신청일:메모 폭을 2:3으로 조정한다.
- [x] 구독 이력의 정확한 내부 메모 ‘현장 간이 등록’을 숨기되 저장값은 보존한다.
- [x] 결과 수의 위·아래 여백을 확보하고 백업 개인정보 안내를 세 개 bullet로 제공한다.
- [x] 붙여넣기 안내는 미선택/기존인 선택/신규 선택 상태에 맞춰 표시한다.
- [x] 관련 단위·통합 테스트 통과를 확인한다.

## Task 4 — 입금 표의 공통 배치

Files: src/PaymentQueue.tsx, src/styles.css, src/PaymentQueue.test.tsx, tests/e2e/core.e2e.ts.

- [x] 공통 열 정의의 단위 테스트에서 실패·수정 후 통과를 확인하고, 두 모드 머리글 좌표·크기 및 체크박스 크기 E2E를 추가한다.
- [x] 공통 colgroup과 고정 table layout을 사용한다. 헤더 높이·표 시작선을 동일하게 맞추고 체크박스를 20px로 키운다.
- [x] 대기의 강조 헤더·주 확인 버튼과 내역의 중립 헤더·보조 취소 동작을 유지한다.
- [ ] 최소 창·기본 창과 라이트·다크 테마에서 잘림·겹침을 검증한다.

## Task 5 — 문서·전체 검증

Files: PROJECT_SPEC.md, docs/PROJECT_HISTORY.md, docs/USER_GUIDE.md, docs/RELEASE_NOTES_0.1.0.md, src/HelpPanel.tsx 및 관련 도움말 테스트.

- [x] 연간 또래 필수·오류 표시·누락 우선 정렬·구매 키보드 선택·구독 추가 명칭을 문서와 도움말에 반영한다.
- [x] just format, just check, just e2e, just e2e-build를 실행한다. 실패는 원인과 범위를 기록한다.
- [x] 변경 diff와 요구사항을 대조해 피드백 누락·개인정보·저장 경계를 검토한다.
- [x] Windows 실기 검증, 외부 앱 설치, 커밋에 권한/환경 제한이 있으면 완료로 표시하지 않고 결과에 명시한다.

## Execution Record

- 계획 확정: 연간 클릭 시 검증 및 실제 누락 우선 정렬을 사용자 답변으로 확정했다.

- 구현: 다섯 작업의 코드·문서 수정을 반영했다. 조회는 저장·로그를 발생시키지 않으며 저장 변경은 기존 연간 생성 이벤트를 유지한다.
- 검증: just check 통과(프론트엔드 124개 및 Rust 단위·통합 테스트). just e2e-build 통과.
- E2E 미완료: 테스트 앱 빌드는 성공했으나 `Embedded WebDriver server did not become ready on port 4445 within 60000ms`로 onPrepare 실패. 직접 실행에서도 `Connection Invalid error for service com.apple.hiservices-xpcservice.` 발생. 따라서 실제 포인터·IME·두 모드 좌표와 라이트/다크 시각 검증을 완료로 표시하지 않는다.
- 패키징: just package는 .app 생성 후 bundle_dmg.sh에서 실패했다. DMG 및 Windows 검증은 미완료다. 현재 환경의 외부 앱 설치와 Git 메타데이터 쓰기 제한 때문에 설치·커밋을 수행하지 않는다.
- 검토 보정: 체크 해제한 정상 신규 행은 추가 예정 문구 대신 제외 안내로 바꾼다. 후보 탐색 중 aria-selected는 하나의 항목에만 표시한다.

- 최신 산출물: 일반 앱 번들만 생성하는 빌드로 최신 소스의 `target/release/bundle/macos/QT Manager.app`을 준비한다. DMG 생성과 설치 반영은 미완료다.

## 후속 피드백 실행 계획

1. 오류가 있는 연간 입력의 높이를 맞추고 기존인 명시 선택·기간 겹침 확인으로 연간 구독을 추가한다. 신규 이름·또래 필수와 기존 누락 프로필 호환을 유지한다.
2. 신규 선택 상태를 표시하고 후보를 닫는다. 월간 설명을 제거하고 한국어 필드 검증으로 저장을 막는다.
3. 문서 공통 IME 클릭 처리를 적용해 확정된 입력으로 한 번 실행하며 취소·비활성·일반 클릭을 보존한다.
4. 메모 상세 최소 높이를 제거하고 보관함 삭제 후 남은 목록을 유지한다.
5. 자동 테스트와 핵심 E2E를 보강하고 문서·도움말을 갱신한 뒤 just check·e2e-build·e2e와 일반 앱 번들을 검증한다. 설치·실기 실행 제한은 별도로 기록한다.

- 구현 및 자동 테스트 보강 완료. IME 이벤트 순서와 취소 회귀 테스트의 실패 후 수정 확인. 실제 네이티브 한글 입력 검증은 앱 실행 환경 확인 후 기록한다.

- 후속 검증: just check 통과(프론트엔드 134개 및 Rust 전체 테스트), just e2e-build 통과. just e2e는 앱 빌드 후 `Embedded WebDriver server did not become ready on port 4445 within 60000ms`로 onPrepare 실패해 실제 화면·IME 검증은 미완료다. 설치 앱 교체·커밋은 허용된 쓰기 범위 밖이라 수행하지 않는다.

## 저녁 추가 피드백

- 두 구독창을 월간 폭·순서로 통일하고 연간 선택 메모를 구독에 보존한다. 필수 입력 규칙은 유지한다.
- 필드 오류·신규 필드·목록 시작 부분의 겹친 여백을 줄이고 검색과 필터 왼쪽선을 맞춘다. 입금 행·동작 높이를 통일하며 이름 대비를 높인다.
- IME 누름 소비·역순 놓음/누름에 대한 실패 회귀 테스트를 추가해 보정하고 중복 실행·드래그·만료·일반 클릭 방어를 유지한다. 실제 네이티브 입력 검증과 자동 이벤트 재현을 구분한다.

- 저녁 검증 결과: just check 통과(프론트엔드 137개 및 Rust 전체 테스트), just e2e-build 통과. just e2e는 `Embedded WebDriver server did not become ready on port 4445 within 60000ms`로 onPrepare 실패했다. 실제 한글 조합 클릭·화면 좌표는 미검증이며 일반 앱 번들을 생성해 전달한다.
