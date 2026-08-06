import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  type AppSupportInfo,
  loadAppSupportInfo,
  openLogDirectory,
} from "./support";

type HelpTopic =
  | "quick-start"
  | "distribution"
  | "notes"
  | "people"
  | "purchase"
  | "handover"
  | "shortcuts"
  | "install"
  | "app-info";

const topics: { id: HelpTopic; label: string }[] = [
  { id: "quick-start", label: "빠른 시작" },
  { id: "distribution", label: "검색과 배부" },
  { id: "notes", label: "메모" },
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
  const [activeTopic, setActiveTopic] = useState<HelpTopic>(topic);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<HelpTopic, HTMLElement>>>({});

  const registerSection = useCallback(
    (id: HelpTopic, element: HTMLElement | null) => {
      if (element) sectionRefs.current[id] = element;
      else delete sectionRefs.current[id];
    },
    [],
  );

  const syncActiveTopic = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;

    const marker = content.scrollTop + 48;
    let nextTopic = topics[0].id;
    const atBottom =
      content.scrollTop + content.clientHeight >= content.scrollHeight - 2;
    if (atBottom) {
      nextTopic = topics.at(-1)?.id ?? nextTopic;
    } else {
      for (const item of topics) {
        const section = sectionForTopic(content, item.id, sectionRefs.current);
        if (!section || sectionTopWithinContent(section, content) > marker)
          break;
        nextTopic = item.id;
      }
    }
    setActiveTopic((current) => (current === nextTopic ? current : nextTopic));
  }, []);

  useEffect(() => {
    void loadAppSupportInfo()
      .then(setSupport)
      .catch(() => setSupportError("앱 경로 정보를 불러오지 못했습니다."));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const positionAtTopic = () => {
      const section = sectionForTopic(content, topic, sectionRefs.current);
      if (!section) return;
      const top = Math.max(0, sectionTopWithinContent(section, content) - 8);
      // WebKit treats `scroll-behavior: smooth` as applying to direct scrollTop
      // assignments too. Disable it while restoring the initial topic so the
      // active section is deterministic as soon as the panel opens.
      content.style.scrollBehavior = "auto";
      content.scrollTop = top;
      content.scrollTo({
        top,
        behavior: "auto",
      });
      syncActiveTopic();
    };
    positionAtTopic();
    const retry = window.setTimeout(positionAtTopic, 250);
    content.addEventListener("scroll", syncActiveTopic, { passive: true });
    return () => {
      window.clearTimeout(retry);
      content.removeEventListener("scroll", syncActiveTopic);
    };
  }, [syncActiveTopic, topic]);

  function moveToTopic(nextTopic: HelpTopic) {
    setActiveTopic(nextTopic);
    const content = contentRef.current;
    const section = content
      ? sectionForTopic(content, nextTopic, sectionRefs.current)
      : null;
    if (!content || !section) return;
    const top = Math.max(0, sectionTopWithinContent(section, content) - 8);
    content.scrollTop = top;
    content.scrollTo({
      top,
      behavior: "smooth",
    });
  }

  return (
    <div
      className="modal-backdrop help-backdrop"
      data-testid="help-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <header className="help-heading">
          <div>
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
                className={item.id === activeTopic ? "active" : ""}
                href={`#help-${item.id}`}
                data-testid={`help-nav-${item.id}`}
                aria-current={item.id === activeTopic ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  moveToTopic(item.id);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div
            className="help-content"
            ref={contentRef}
            data-testid="help-content"
          >
            <HelpSection
              id="quick-start"
              title="처음 맡은 담당자의 빠른 시작"
              sectionRef={(element) => registerSection("quick-start", element)}
            >
              <ol className="help-step-list">
                <li>
                  <div className="help-step-copy">
                    <strong>담당자 설정</strong>
                    <span>첫 실행 시 현재 담당자 이름을 입력합니다.</span>
                  </div>
                </li>
                <li>
                  <div className="help-step-copy">
                    <strong>호 확인</strong>
                    <span>상단에서 오늘 배부할 QT 호를 선택합니다.</span>
                  </div>
                </li>
                <li>
                  <div className="help-step-copy">
                    <strong>찾기</strong>
                    <span>
                      검색창에 이름 일부, 또래 또는 또래+이름을 입력합니다.
                    </span>
                  </div>
                </li>
                <li>
                  <div className="help-step-copy">
                    <strong>배부</strong>
                    <span>책을 건넨 뒤 각 행의 ‘N권 배부’를 누릅니다.</span>
                  </div>
                </li>
                <li>
                  <div className="help-step-copy">
                    <strong>실수 복구</strong>
                    <span>
                      배부 취소 확인창 또는 상단 되돌리기를 사용합니다.
                    </span>
                  </div>
                </li>
              </ol>
            </HelpSection>

            <HelpSection
              id="distribution"
              title="검색과 배부"
              sectionRef={(element) => registerSection("distribution", element)}
            >
              <div className="help-card-grid">
                <HelpCard title="찾기">
                  <HelpList>
                    <li>이름 일부는 입력하는 즉시 결과가 바뀝니다.</li>
                    <li>두 자리 또래 또는 ‘94 홍’처럼 조합해 검색합니다.</li>
                    <li>
                      전화번호는 신청자 관리에서 검색하고 현장 배부에서는
                      사용하지 않습니다.
                    </li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="배부">
                  <HelpList>
                    <li>
                      2권 신청자는 기본 버튼 한 번으로 남은 2권을 처리합니다.
                    </li>
                    <li>
                      1권만 전달했다면 행의 메뉴에서 ‘일부만’을 선택합니다.
                    </li>
                    <li>만료·대상 아님 신청자는 일반 배부가 막힙니다.</li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="필터와 표">
                  <HelpList>
                    <li>
                      필터에서 미배부·일부·완료·만료를 여러 개 선택합니다.
                    </li>
                    <li>검색 중에도 선택한 필터가 그대로 적용됩니다.</li>
                    <li>표 머리글을 눌러 오름차순·내림차순을 바꿉니다.</li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="전화번호와 구독">
                  <HelpList>
                    <li>
                      현장 배부 표는 전화번호 열을 숨기고 이름·또래로 빠르게
                      찾습니다.
                    </li>
                    <li>
                      전체 전화번호는 행 툴팁·접근성 이름, 신청자 관리 상세와
                      정보 수정 화면에서 확인합니다.
                    </li>
                    <li>
                      구독 종료는 날짜 대신 ‘2027년 3~4월호까지’처럼 마지막 대상
                      QT 호로 표시합니다.
                    </li>
                    <li>
                      실제 배부 자격은 현장 배부에서 선택한 QT 호가 구독 기간에
                      포함되는지로 판단합니다.
                    </li>
                  </HelpList>
                </HelpCard>
              </div>
            </HelpSection>

            <HelpSection
              id="notes"
              title="메모"
              sectionRef={(element) => registerSection("notes", element)}
            >
              <div className="help-card-grid">
                <HelpCard title="메모 추가와 연결">
                  <HelpList>
                    <li>
                      메모는 현장 배부 오른쪽 입력란에서 바로 추가할 수
                      있습니다.
                    </li>
                    <li>
                      신청자 행의 점 세 개 또는 우클릭에서 추가하면 그 신청자와
                      연결됩니다.
                    </li>
                    <li>
                      신청자 관리의 상세·정보 수정 화면에서도 연락처 아래에 연결
                      메모를 추가하고 수정할 수 있습니다.
                    </li>
                    <li>
                      연결하지 않은 메모에는 별도 유형 표시가 붙지 않습니다.
                    </li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="읽기와 보관">
                  <HelpList>
                    <li>카드에는 긴 내용도 여러 줄로 모두 표시됩니다.</li>
                    <li>
                      카드를 두 번 클릭하면 전문·수정·보관·삭제 화면이 열립니다.
                    </li>
                    <li>
                      보관은 처리 완료 표시이며 보관함에서 다시 복원할 수
                      있습니다.
                    </li>
                    <li>
                      보관함에서는 메모를 복원하거나 삭제할 수 있습니다. 삭제는
                      확인 후 되돌릴 수 없습니다.
                    </li>
                    <li>
                      삭제는 확인 후 영구 삭제되므로 보관을 먼저 권장합니다.
                    </li>
                  </HelpList>
                </HelpCard>
              </div>
              <p className="help-note">
                메모 추가·수정·보관·복원은 저장 직후 되돌리기와 다시 실행을
                지원합니다. 새 동작을 하면 이전 다시 실행 대기는 사라집니다.
              </p>
            </HelpSection>

            <HelpSection
              id="people"
              title="신규 신청과 갱신"
              sectionRef={(element) => registerSection("people", element)}
            >
              <div className="help-card-grid">
                <HelpCard title="등록과 갱신">
                  <HelpList>
                    <li>
                      신청자 관리에서 이름을 입력하고, 또래·연락처를 선택적으로
                      입력해 신청자를 등록합니다.
                    </li>
                    <li>
                      현장 간이 등록자는 나중에 ‘정보 수정’으로 보완합니다.
                    </li>
                    <li>
                      갱신은 과거 구독을 수정하지 않고 새 6개 호를 추가합니다.
                    </li>
                    <li>기간이 다른 여러 권은 구독 이력을 따로 보존합니다.</li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="상세에서 확인">
                  <HelpList>
                    <li>신청자 목록에는 또래와 이름만 기본 표시됩니다.</li>
                    <li>정보 보완이나 보관 상태는 작은 표시로 구분합니다.</li>
                    <li>
                      `정보 보완 필요 N명`은 현장 간이 등록 상태가 아직 보완되지
                      않은 신청자 수입니다. 일반 등록자의 또래 누락만으로는 이
                      수에 포함하지 않습니다. 숫자를 누르면 대상자만 필터링되고,
                      마우스를 올리거나 포커스하면 대상 이름을 확인할 수
                      있습니다.
                    </li>
                    <li>
                      전화번호는 신청자 관리 목록에서는 숨기고, 선택한 신청자의
                      상세 또는 정보 수정 화면에서 전체 전화번호를 확인합니다.
                    </li>
                    <li>
                      구독 수·마지막 호는 상세에서 확인합니다. 구독 표는 오늘이
                      포함된 호를 기준으로 현재·예정·지난·보관을 나눕니다.
                    </li>
                    <li>
                      현장 배부 표의 점 세 개나 우클릭 메뉴에서 `상세 정보
                      보기`를 선택하면 해당 신청자의 신청자 관리 상세로 바로
                      이동합니다.
                    </li>
                    <li>
                      상세에서 메모를 바로 추가하고, 해당 신청자에 연결된 메모를
                      수정·보관·삭제할 수 있습니다.
                    </li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="Google 응답 붙여넣기">
                  <HelpList>
                    <li>
                      Google 응답 행을 한 줄 또는 여러 줄 복사해 붙여넣습니다.
                    </li>
                    <li>
                      응답 행 입력란에서 Tab을 눌러 탭 문자를 직접 넣을 수
                      있습니다.
                    </li>
                    <li>
                      오류 행·중복 후보·기존 신청자 연결을 미리 확인합니다.
                    </li>
                    <li>
                      갱신의 시작 연도와 수량은 목록 없이 직접 입력합니다.
                    </li>
                    <li>입금 여부는 앱에 저장하지 않습니다.</li>
                  </HelpList>
                </HelpCard>
              </div>
              <p className="help-note">
                긴 신청자 목록은 왼쪽 목록 안에서, 긴 구독·배부 이력은 오른쪽
                상세 안에서 각각 스크롤합니다. 신청자 관리 상단에는 제목 하나만
                표시되며, 초기 창은 1120×760이고 최소 900×640까지 조절할 수
                있습니다.
              </p>
            </HelpSection>

            <HelpSection
              id="purchase"
              title="현장 개별 구매"
              sectionRef={(element) => registerSection("purchase", element)}
            >
              <HelpCard title="한 호만 구매한 경우">
                <HelpList>
                  <li>배부 화면의 더보기 메뉴에서 ‘개별 구매’를 선택합니다.</li>
                  <li>구매 호와 수량을 기록하면 전달 완료로 저장됩니다.</li>
                  <li>구독 수량·배부 완료 상태에는 영향을 주지 않습니다.</li>
                </HelpList>
              </HelpCard>
            </HelpSection>

            <HelpSection
              id="handover"
              title="데이터 백업·복원"
              sectionRef={(element) => registerSection("handover", element)}
            >
              <div className="help-card-grid">
                <HelpCard title="백업과 복원 순서">
                  <HelpList>
                    <li>신청자 관리에서 ‘데이터 백업·복원’을 엽니다.</li>
                    <li>전체 상태를 XLSX 한 파일로 내보냅니다.</li>
                    <li>새 담당자는 교체 또는 병합을 선택해 가져옵니다.</li>
                    <li>
                      가져오기 직전 상태는 자동으로 복원 지점에 저장됩니다.
                    </li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="병합과 개인정보">
                  <HelpList>
                    <li>
                      병합은 같은 ID의 최신 수정값과 양쪽 고유 이력을
                      보존합니다.
                    </li>
                    <li>동일인 후보는 담당자가 직접 연결 여부를 선택합니다.</li>
                    <li>
                      가져오기 후에는 ‘가져오기 전 백업으로 복원’을 사용할 수
                      있습니다. 복원 전에는 이후 작업이 사라질 수 있음을
                      확인합니다.
                    </li>
                    <li>
                      XLSX는 암호화되지 않으므로 안전하게 전달·보관합니다.
                    </li>
                  </HelpList>
                </HelpCard>
              </div>
            </HelpSection>

            <HelpSection
              id="shortcuts"
              title="단축키"
              sectionRef={(element) => registerSection("shortcuts", element)}
            >
              <HelpCard title="자주 쓰는 동작">
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
                    <dd>메모 입력으로 이동</dd>
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
              </HelpCard>
            </HelpSection>

            <HelpSection
              id="install"
              title="macOS와 Windows 최초 실행"
              sectionRef={(element) => registerSection("install", element)}
            >
              <HelpCard title="경고가 표시될 때">
                <HelpList>
                  <li>
                    macOS: 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기를
                    선택합니다.
                  </li>
                  <li>
                    Windows: SmartScreen에서 추가 정보 → 실행을 선택합니다.
                  </li>
                  <li>
                    전달받은 설치 파일이 담당자가 보낸 원본인지 먼저 확인합니다.
                  </li>
                </HelpList>
              </HelpCard>
            </HelpSection>

            <HelpSection
              id="app-info"
              title="앱 정보와 문제 보고"
              sectionRef={(element) => registerSection("app-info", element)}
            >
              <div className="help-card-grid">
                <HelpCard title="오프라인 운영">
                  <HelpList>
                    <li>맑은샘광천교회 2026 교육국 제작입니다.</li>
                    <li>앱은 인터넷 없이 동작하고 테마 선택을 저장합니다.</li>
                    <li>
                      운영 로그에는 이름·전화번호·메모를 기록하지 않습니다.
                    </li>
                  </HelpList>
                </HelpCard>
                <HelpCard title="지원 정보">
                  {support ? (
                    <dl className="support-paths" data-testid="support-info">
                      <div>
                        <dt>앱 버전</dt>
                        <dd>{support.appVersion}</dd>
                      </div>
                      <div>
                        <dt>데이터 위치</dt>
                        <dd
                          data-testid="support-path-data"
                          title={support.dataDirectory}
                        >
                          {support.dataDirectory}
                        </dd>
                      </div>
                      <div>
                        <dt>로그 파일</dt>
                        <dd
                          data-testid="support-path-log"
                          title={support.logFile}
                        >
                          {support.logFile}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="help-note">
                      {supportError || "경로 확인 중…"}
                    </p>
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
                </HelpCard>
              </div>
            </HelpSection>

            <footer>
              앱 {support?.appVersion ?? "버전 확인 중"} · 도움말 2026-08-04
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
  sectionRef,
  children,
}: {
  id: HelpTopic;
  title: string;
  sectionRef?: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section id={`help-${id}`} data-testid={`help-${id}`} ref={sectionRef}>
      <div className="help-section-heading">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function HelpCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="help-card">
      <h4>{title}</h4>
      {children}
    </article>
  );
}

function HelpList({ children }: { children: ReactNode }) {
  return <ul className="help-list">{children}</ul>;
}

function sectionTopWithinContent(
  section: HTMLElement,
  content: HTMLElement,
): number {
  return (
    section.getBoundingClientRect().top -
    content.getBoundingClientRect().top +
    content.scrollTop
  );
}

function sectionForTopic(
  content: HTMLElement,
  topic: HelpTopic,
  refs: Partial<Record<HelpTopic, HTMLElement>>,
): HTMLElement | null {
  return (
    refs[topic] ??
    content.querySelector<HTMLElement>(`[data-testid="help-${topic}"]`)
  );
}
