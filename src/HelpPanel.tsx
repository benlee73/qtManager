import { useEffect, useState } from "react";

import {
  type AppSupportInfo,
  loadAppSupportInfo,
  openLogDirectory,
} from "./support";

type HelpTopic =
  | "quick-start"
  | "distribution"
  | "people"
  | "purchase"
  | "handover"
  | "shortcuts"
  | "install"
  | "app-info";

const topics: { id: HelpTopic; label: string }[] = [
  { id: "quick-start", label: "빠른 시작" },
  { id: "distribution", label: "검색과 배부" },
  { id: "people", label: "신규 신청과 갱신" },
  { id: "purchase", label: "개별 구매" },
  { id: "handover", label: "데이터 백업·복원" },
  { id: "shortcuts", label: "단축키" },
  { id: "install", label: "설치 문제" },
  { id: "app-info", label: "앱 정보" },
];

export function HelpPanel({
  topic = "quick-start",
  onClose,
}: {
  topic?: HelpTopic;
  onClose: () => void;
}) {
  const [support, setSupport] = useState<AppSupportInfo | null>(null);
  const [supportError, setSupportError] = useState("");

  useEffect(() => {
    void loadAppSupportInfo()
      .then(setSupport)
      .catch(() => setSupportError("앱 경로 정보를 불러오지 못했습니다."));
  }, []);

  return (
    <div className="modal-backdrop help-backdrop" role="presentation">
      <section
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <header className="help-heading">
          <div>
            <p className="section-label">인터넷 없이 보는 사용법</p>
            <h2 id="help-title">QT Manager 도움말</h2>
          </div>
          <button type="button" aria-label="도움말 닫기" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="help-layout">
          <nav aria-label="도움말 목차">
            {topics.map((item) => (
              <a
                key={item.id}
                className={item.id === topic ? "active" : ""}
                href={`#help-${item.id}`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="help-content">
            <HelpSection id="quick-start" title="처음 맡은 담당자의 빠른 시작">
              <ol>
                <li>처음 실행할 때 현재 담당자 이름을 입력합니다.</li>
                <li>
                  왼쪽 메뉴에서 현장 배부, 신청자 관리, 도움말과 테마를
                  전환합니다.
                </li>
                <li>배부할 QT 호가 맞는지 상단에서 확인합니다.</li>
                <li>
                  검색창이 비어 있으면 아직 배부하지 않은 신청자가 보입니다.
                </li>
                <li>책을 건넨 뒤 각 행의 ‘N권 배부’를 누릅니다.</li>
                <li>
                  배부를 잘못 완료했다면 해당 행의 ‘배부 취소’를 누르고
                  확인합니다.
                </li>
              </ol>
            </HelpSection>
            <HelpSection id="distribution" title="검색과 배부">
              <p>
                이름 일부, 두 자리 또래, ‘94 홍’ 같은 조합, 전화번호 숫자로
                검색할 수 있습니다. 2권 신청자는 기본 버튼으로 남은 2권을 모두
                처리하고, 1권만 건넸다면 ‘일부만’을 사용합니다. 구독 만료 또는
                대상 아님 상태에서는 일반 배부가 막힙니다.
              </p>
              <p>
                ‘필터’에서 미배부, 일부 배부, 배부 완료, 구독 만료를 여러 개
                선택할 수 있습니다. ‘남은 배부’는 미배부와 일부 배부를, ‘전체’는
                네 상태를 한 번에 선택합니다. 검색어를 입력한 동안에도 선택한
                필터가 그대로 적용됩니다. 닫힌 필터 버튼에는 현재 선택한 상태의
                종류와 개수가 요약되고, 마우스를 올리면 전체 선택 항목을 볼 수
                있습니다. 표 머리글의 또래·신청자·구독·배부를 누르면 오름차순과
                내림차순을 바꿀 수 있습니다.
              </p>
              <p>
                현장 배부 표는 구독과 배부 상태를 넓게 보여주기 위해 전화번호
                열을 숨깁니다. 전화번호 숫자 검색은 그대로 동작하며, 이름에
                마우스를 올리거나 행을 더블클릭해 정보 수정 화면을 열면 전체
                전화번호와 그 신청자에게 연결된 미보관 확인할 일을 확인할 수
                있습니다. 수정 창은 Escape로 닫을 수 있습니다. 신청자 관리
                화면에서도 전체 전화번호를 확인할 수 있습니다. 구독 종료는 날짜
                대신 ‘2027년 3~4월호까지’처럼 마지막 대상 QT 호로 표시하고, 이번
                호가 마지막이거나 만료됐을 때만 상태 문구를 표시합니다.
              </p>
              <p className="help-note">
                확인할 일은 체크박스가 비어 있으면 확인 필요, 체크되어 있으면
                확인 완료입니다. 신청자 행의 점 세 개 또는 우클릭으로 신청자와
                연결하고, 이름 옆의 작은 노란 상태점으로 연결 여부를 확인합니다.
                우측 목록의 연결 표시는 ‘연결’이라는 말을 반복하지 않고 신청자
                이름만 보여줍니다. 오른쪽 입력란에서는 일반 확인할 일을
                만듭니다. 보관한 확인할 일과 고정 메모는 ‘보관함’에서 확인하고
                복원할 수 있습니다. 필요 없는 확인할 일과 고정 메모는 삭제 확인
                후 영구 삭제할 수 있습니다. 배부·배부 취소·신청자 정보 수정·개별
                구매와 확인할 일·고정 메모의 지원 동작 직후에는 상단 되돌리기와
                다시 실행을 사용할 수 있습니다. 새 동작을 하면 이전 다시 실행
                대기는 사라집니다.
              </p>
            </HelpSection>
            <HelpSection id="people" title="신규 신청, 정보 보완과 갱신">
              <p>
                ‘신청자 관리’에서 모든 정보를 입력해 정식 등록합니다. 현장 간이
                등록자는 상세 화면의 ‘정보 수정’으로 연락처와 신청자 메모를
                보완할 수 있습니다. 배부 목록에서는 신청자를 더블클릭하거나 점
                세 개·우클릭 메뉴의 ‘신청자 정보 수정’을 사용합니다. 갱신은 과거
                구독을 수정하지 않고 새 6개 호 구독을 추가합니다. 한 사람이 여러
                권을 서로 다른 기간으로 신청하면 권별 구독을 따로 두고 현재 호의
                배부 수량만 한 행에 합산합니다.
              </p>
              <p className="help-note">
                Google 응답 시트에서 한 행 또는 여러 행을 복사한 뒤 ‘Google 응답
                붙여넣기’에 넣으세요. 미리보기에서 오류 행은 제외되고, 같은 사람
                후보는 기존 신청자 연결 또는 새 신청자 추가를 선택합니다. 이미
                가져온 같은 응답은 다시 추가되지 않습니다. 입금 여부는 앱에서
                관리하지 않습니다.
              </p>
            </HelpSection>
            <HelpSection id="purchase" title="현장 개별 구매">
              <p>
                연간 구독이 아니라 한 호만 현장에서 구매한 경우 배부 화면의
                ‘더보기 · 개별 구매’를 사용합니다. 이 기록은 구독 수량이나 배부
                완료 상태를 바꾸지 않습니다.
              </p>
            </HelpSection>
            <HelpSection id="handover" title="데이터 백업·복원">
              <p>
                신청자 관리의 ‘데이터 백업·복원’에서 전체 상태를 XLSX 한 파일로
                내보냅니다. 새 담당자는 파일을 선택한 뒤 현재 데이터를 교체할지
                병합할지 정합니다. 병합은 같은 ID의 최신 수정값과 양쪽 고유
                이력을 보존하며, 동일인 후보는 직접 연결 여부를 선택합니다.
              </p>
              <p>
                가져오기 직전 상태는 자동 백업되며 앱을 다시 실행해도 ‘가져오기
                되돌리기’를 사용할 수 있습니다. 최근 자동 백업 10개를
                보관합니다. XLSX는 암호화되지 않고 이름과 연락처가 포함되므로
                안전하게 전달·보관하고, 백업·복원 후 불필요한 사본을 삭제하세요.
              </p>
            </HelpSection>
            <HelpSection id="shortcuts" title="단축키">
              <dl className="shortcut-list">
                <div>
                  <dt>/</dt>
                  <dd>검색창으로 이동</dd>
                </div>
                <div>
                  <dt>⌘/Ctrl + Enter</dt>
                  <dd>선택한 사람 기본 배부</dd>
                </div>
                <div>
                  <dt>⌘/Ctrl + N</dt>
                  <dd>현장 간이 등록</dd>
                </div>
                <div>
                  <dt>⌘/Ctrl + Shift + M</dt>
                  <dd>확인할 일 입력으로 이동</dd>
                </div>
                <div>
                  <dt>⌘/Ctrl + Z</dt>
                  <dd>최근 동작 되돌리기</dd>
                </div>
                <div>
                  <dt>⌘/Ctrl + Shift + Z</dt>
                  <dd>되돌린 동작 다시 실행</dd>
                </div>
                <div>
                  <dt>?</dt>
                  <dd>도움말 열기</dd>
                </div>
              </dl>
            </HelpSection>
            <HelpSection id="install" title="macOS와 Windows 최초 실행">
              <p>
                내부 배포용 미서명 앱은 경고가 나타날 수 있습니다. macOS에서는
                앱을 한 번 연 뒤 ‘시스템 설정 → 개인정보 보호 및 보안 → 그래도
                열기’를 사용합니다. Windows에서는 전달받은 원본이 맞는지 확인한
                뒤 SmartScreen의 ‘추가 정보 → 실행’을 선택합니다.
              </p>
            </HelpSection>
            <HelpSection id="app-info" title="앱 정보와 문제 보고">
              <p>
                맑은샘광천교회 2026 교육국 제작. 문제가 생기면 아래 로그 폴더의
                파일을 개발 담당자에게 전달하세요. 운영 로그에는 고정 이벤트와
                시각만 기록하며 이름·전화번호·메모는 기록하지 않습니다.
              </p>
              <p>
                첫 실행은 다크 테마이며 이후에는 마지막으로 선택한 라이트·다크
                테마를 이 컴퓨터에 저장해 다음 실행에도 유지합니다. 창 크기는
                조절할 수 있고 목록 영역의 스크롤 색상도 현재 테마에 맞춰
                바뀝니다.
              </p>
              {support ? (
                <dl className="support-paths" data-testid="support-info">
                  <div>
                    <dt>앱 버전</dt>
                    <dd>{support.appVersion}</dd>
                  </div>
                  <div>
                    <dt>데이터 위치</dt>
                    <dd title={support.dataDirectory}>
                      {support.dataDirectory}
                    </dd>
                  </div>
                  <div>
                    <dt>로그 파일</dt>
                    <dd title={support.logFile}>{support.logFile}</dd>
                  </div>
                </dl>
              ) : (
                <p className="help-note">{supportError || "경로 확인 중…"}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  void openLogDirectory().catch(() =>
                    setSupportError("로그 폴더를 열지 못했습니다."),
                  );
                }}
              >
                로그 폴더 열기
              </button>
            </HelpSection>
            <footer>
              앱 {support?.appVersion ?? "버전 확인 중"} · 도움말 2026-08-03
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}

function HelpSection({
  id,
  title,
  children,
}: {
  id: HelpTopic;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`help-${id}`} data-testid={`help-${id}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
