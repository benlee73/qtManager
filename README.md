# QT Manager

맑은샘광천교회 교육국의 QT 신청·구독·현장 배부를 관리하는 오프라인 데스크톱 앱입니다.
서버나 인터넷 연결 없이 로컬 SQLite에 데이터를 저장하고, 담당자 간에는 XLSX 백업
파일 하나로 전체 상태를 주고받습니다.

- 현재 버전: **0.4.0**
- 지원 OS: macOS 12 이상(Intel·Apple Silicon), Windows 10/11 64비트

## 주요 기능

- QT 호(두 달 단위)별 신청자 검색과 1권·여러 권 배부, 배부 취소·되돌리기
- 1년 구독(연속 6개 호)과 1달 구독(한 호 구매), 구독 정정
- 신청자·구독·배부 이력 관리, 입금 확인, 군지체 배부 기록
- 구글 폼 응답 행을 복사해 붙여넣는 신청 등록
- XLSX 전체 백업·복원(교체·병합)과 가져오기 전 자동 복원 지점
- 메모와 보관함, 라이트·다크 테마, 단축키, 앱 안의 오프라인 도움말

## 설치와 사용

[Releases](https://github.com/benlee73/qtManager/releases)에서 macOS는 `.dmg`,
Windows는 `-setup.exe` 파일을 받아 설치합니다. 서명하지 않은 앱이라 처음 실행할 때
macOS Gatekeeper나 Windows SmartScreen 경고가 나올 수 있습니다. 실행 방법과 사용법은
[담당자 사용 안내](./docs/USER_GUIDE.md)와 앱의 도움말에 있습니다.

1. 앱을 실행하고 현재 담당자 이름을 입력합니다.
2. 기존 백업 XLSX가 있으면 **신청자 관리 → 데이터 백업·복원 → XLSX 가져오기**로
   복원합니다.
3. 상단에서 배부할 QT 호를 선택하고 이름 또는 또래로 검색해 배부합니다.

> XLSX 백업에는 이름·연락처가 암호화되지 않은 채 들어 있습니다. 파일을 전달·보관할
> 때 주의하고, 실제 운영 데이터(XLSX·SQLite·로그)는 저장소에 올리지 마세요.

## 개발 환경

| 도구    | 버전·비고                                       |
| ------- | ----------------------------------------------- |
| Node.js | 24 (`.node-version`)                            |
| pnpm    | 11.17.0 (`corepack enable`로 설치)              |
| Rust    | 1.97.1 (`rust-toolchain.toml`에 따라 자동 설치) |
| just    | 개발 명령 실행기                                |
| Python  | 3.x, 프로젝트 검사 스크립트용 (`python` 명령)   |

OS별 Tauri 준비물(macOS의 Xcode Command Line Tools, Windows의 MSVC Build Tools·WebView2)은
[Tauri 공식 안내](https://v2.tauri.app/start/prerequisites/)를 따릅니다.

```bash
pnpm install
git config core.hooksPath .githooks   # 커밋 전에 just check를 자동 실행
pnpm tauri dev                        # 개발 모드로 앱 실행
```

| 명령           | 내용                                            |
| -------------- | ----------------------------------------------- |
| `just check`   | 포맷·lint·Rust/TypeScript 테스트 (커밋 전 필수) |
| `just format`  | 포맷 자동 수정                                  |
| `just e2e`     | 실제 앱을 빌드해 E2E 테스트 실행                |
| `just package` | 현재 OS용 설치 파일 생성                        |

GitHub Actions의 `check` 워크플로가 main 반영과 PR마다 macOS·Windows에서 `just check`와
E2E를 실행합니다.

## 코드 구조

```text
src/                       React UI (화면, 대화상자, 도움말)
src-tauri/                 Tauri 앱 셸, UI와 Rust를 잇는 명령
crates/qt-domain/          업무 규칙 (QT 호, 구독 기간, 배부 상태, 검색)
crates/qt-application/     기능 흐름 (등록, 배부, 가져오기·병합 등)
crates/qt-infrastructure/  SQLite 저장소, XLSX 읽기·쓰기, 붙여넣기 해석
tests/e2e/                 실제 앱을 띄우는 E2E 테스트
scripts/                   프로젝트 규칙 검사
```

의존 방향은 UI·저장소 → 기능 흐름 → 업무 규칙입니다. 업무 규칙은 `qt-domain`에 두고
화면이나 저장소 코드에 넣지 않습니다.

## 바꿀 때 참고할 점

- **교회·부서 이름**: `index.html`, `src/AppNavigation.tsx`, `src/HelpPanel.tsx`,
  `src/handover.ts`(백업 파일명), `src-tauri/tauri.conf.json`,
  `crates/qt-infrastructure/src/state_xlsx_writer.rs`
- **도움말**: `src/HelpPanel.tsx`, 담당자 안내는 `docs/USER_GUIDE.md`
- **저장 형식**: 버전 상수는 `crates/qt-domain/src/lib.rs`, SQLite 마이그레이션은
  `crates/qt-infrastructure/src/sqlite_migrations.rs`에 있습니다. 형식을 바꿀 때는 기존
  데이터와 이전 백업을 계속 읽을 수 있게 합니다.
- **앱 버전**: `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json`을 함께 올립니다.
  E2E의 버전 기대값(`tests/e2e/core.e2e.ts`)도 같이 바꿉니다.
- **바꾸면 안 되는 값**: `src-tauri/tauri.conf.json`의 `identifier`는 앱 데이터 폴더
  위치를 정합니다. 바꾸면 기존 담당자의 데이터를 찾지 못합니다.
- 테스트 데이터에는 실제 이름·연락처를 쓰지 않습니다.

## 릴리스

GitHub Actions의 `release candidate` 워크플로를 수동 실행하거나 `v*` 태그를 push하면
양 OS에서 검사 후 macOS Universal DMG와 Windows 설치 파일을 만듭니다. 결과 아티팩트를
받아 GitHub Release에 첨부합니다.

## 문서

- [PROJECT_SPEC.md](./PROJECT_SPEC.md): 요구사항·업무 규칙·데이터 형식의 기준 문서.
  분량이 많으니 2~6장의 업무 설명부터 읽으면 됩니다.
- [docs/USER_GUIDE.md](./docs/USER_GUIDE.md): 담당자 사용 안내
- [docs/PROJECT_HISTORY.md](./docs/PROJECT_HISTORY.md): 결정 배경과 변경 이력
- `docs/RELEASE_NOTES_*.md`, `docs/RELEASE_CHECKLIST.md`: 버전별 변경 요약과 검증 기록
- [AGENTS.md](./AGENTS.md): AI 코딩 도구에 주는 작업 규칙. `docs/superpowers/`는 AI
  도구로 작업할 때 만든 계획 문서입니다.
- `crates/qt-infrastructure/examples/`의 `apply_legacy_2026`, `reconcile_*` 등은 2026년
  기존 스프레드시트를 앱으로 옮기고 보정할 때 한 번 사용한 도구입니다.

## 라이선스

[MIT](./LICENSE)
