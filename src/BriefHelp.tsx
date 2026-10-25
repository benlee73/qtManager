const shortcuts = [
  ["/", "검색창으로 이동하고 검색어 전체 선택"],
  ["Esc", "검색창에서 검색어 지우기 · 창 닫기"],
  ["↑ / ↓", "검색 결과에서 사람 선택"],
  ["Enter", "선택한 행의 배부 확인 · 만료된 사람의 구독 추가"],
  ["⌘/Ctrl + Enter", "선택한 사람 기본 배부 · 만료 시 구독 추가"],
  ["⌘/Ctrl + N", "1년 구독"],
  ["⌘/Ctrl + Shift + M", "메모 입력으로 이동"],
  ["⌘/Ctrl + Z", "최근 동작 되돌리기"],
  ["⌘/Ctrl + Shift + Z", "되돌린 동작 다시 실행"],
  ["⌘/Ctrl + 1", "현장 배부로 이동"],
  ["⌘/Ctrl + 2", "신청자 관리로 이동"],
  ["⌘/Ctrl + 3", "입금 관리로 이동"],
];
export function HelpShortcuts() {
  return (
    <dl className="shortcut-list">
      {shortcuts.map(([key, description]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}
export function BriefHelp() {
  return (
    <div className="help-brief" data-testid="help-brief">
      <section className="help-card" data-testid="brief-distribution">
        <h3>현장 배부 시나리오</h3>
        <ol>
          <li>
            이름을 검색합니다. 만료·예정·구독 없음도 ‘전체’에서 찾을 수
            있습니다.
          </li>
          <li>
            받을 사람을 선택하고 Enter → 배부 확인 → Enter로 기록합니다. 노란
            점이 있으면 먼저 메모를 확인하세요.
          </li>
          <li>
            만료된 사람은 ‘구독 추가’ 또는 행에서 Enter를 누릅니다. 현재 호 1년
            구독은 ‘신청 + 배부’, 1달 구독은 구매·전달을 함께 기록합니다.
          </li>
          <li>
            이번 호가 마지막이면 1년 구독의 시작 호를 다음 호로 선택합니다. 다른
            호 시작은 신청만 저장합니다.
          </li>
        </ol>
      </section>
      <section className="help-card" data-testid="brief-transfer">
        <h3>백업, 데이터 옮기는 방법</h3>
        <ol>
          <li>
            신청자 관리 → 데이터 백업·복원 → 전체 상태 내보내기로 XLSX 파일을
            저장합니다.
          </li>
          <li>
            다른 기기에 앱 설치 → 같은 화면에서 XLSX 가져오기 → ‘교체’ → 백업 후
            현재 데이터 교체를 누릅니다.
          </li>
          <li>
            신청자 수와 최근 배부 기록을 확인합니다. 양쪽 기록을 함께 보존해야
            할 때만 ‘병합’을 선택하세요.
          </li>
        </ol>
      </section>
      <section className="help-card" data-testid="brief-shortcuts">
        <h3>단축키 리스트</h3>
        <HelpShortcuts />
      </section>
    </div>
  );
}
