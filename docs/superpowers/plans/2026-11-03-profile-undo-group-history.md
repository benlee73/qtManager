# Profile undo and group history Implementation Plan

**Goal:** 정보 수정 되돌리기의 또래 예외 손실을 고치고 군지체 배부 이력을 행별로 취소한다.
**Architecture:** 프로필 변경의 undo/redo 구성을 공통화한다. 군지체 기록 취소는 애플리케이션에서 소유자·원본·취소 여부를 검증하고 SQLite 트랜잭션으로 원본 보존/취소 이력을 추가한다. UI는 유효한 군지체 행만 표시하며 확인 후 선택 ID만 취소한다.
**Tech Stack:** React/TypeScript, Rust/Tauri, SQLite, Vitest, WebdriverIO, just.
**Spec:** PROJECT_SPEC.md FR-OPS-003, FR-UNDO-002/007, FR-GROUP-003/006.

- [x] 프로필 undo/redo의 true/false 예외 값, 또래·연락처·메모 보존 회귀 검사와 공통 action 구현. 두 화면에 적용.
- [x] 군지체의 최신/과거 배부 및 한 호 원장 기록에서 특정 ID 취소. 일반인·다른 소유자·취소 행·중복 취소 거부와 트랜잭션 재검증.
- [x] 상세 응답에 배부 ID·취소 여부 제공. 행 hover/focus의 투명 ×, 취소 확인, 처리 중 중복 제출 방지, 삭제 후 조회/합계 갱신.
- [x] SQLite/XLSX 보존·합계 및 실제 UI E2E 보강. 기존 일반 신청자 흐름 유지.
- [x] 기능 추가 버전 0.3.0, SQLite v7/XLSX v4 유지. Spec·이력·도움말·릴리스 문서 갱신.
- [x] just format/check, 일반 앱 빌드. 네이티브/Windows 미실행 항목은 통과로 표시하지 않는다.

운영 데이터와 기존 설치 ZIP은 변경하지 않는다. 외부 서비스·Git 쓰기·에이전트 위임은 추가하지 않는다.

## 검증 결과와 남은 항목

2026-11-03 `just check` 통과: 프론트엔드 171개·Rust 124개·Python 2개. 일반 Universal 0.3.0 앱 빌드 및 버전 확인. 실제 화면 E2E는 에이전트 환경의 embedded WebDriver 시작 타임아웃으로 미실행이다.

- [ ] 일반 macOS 터미널에서 갱신된 E2E 32개 실행.
- [ ] Windows 검사·실제 설치 및 배포 설치 파일 생성. 이전 0.2.1 성공을 재사용하지 않는다.

후속 범위는 [1달 구독 배부 분리 계획](2026-11-03-monthly-delivery-history.md)에서 0.4.0으로 확장했다. 그룹 전용 이력 API·UI 이름은 전체 배부 이력 이름으로 통합했다.
