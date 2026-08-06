import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ManagementPersonList, PersonDetailPanel } from "./ManagementDetail";
import { ManagementEditDialog, ManagementScreen } from "./ManagementScreen";
import type { PersonDetail, PersonSummary } from "./phase3";

const people: PersonSummary[] = [
  {
    id: "person-one",
    name: "가상 신청자",
    cohort: "00",
    phone: "010-0000-0000",
    status: "정식 등록",
    personNote: null,
    subscriptionCount: 2,
    latestLastIssue: "2027년 3~4월호",
  },
  {
    id: "person-two",
    name: "예시 신청자",
    cohort: "01",
    phone: null,
    status: "정보 보완 필요",
    personNote: "정보 확인 중",
    subscriptionCount: 1,
    latestLastIssue: null,
  },
];

const detail: PersonDetail = {
  id: "person-one",
  name: "가상 신청자",
  cohort: "00",
  phone: "010-0000-0000",
  status: "정식 등록",
  personNote: null,
  subscriptions: [
    {
      id: "subscription-current",
      startIssue: "2026년 5~6월호",
      lastIssue: "2027년 3~4월호",
      quantity: 2,
      appliedAt: "2026-04-20",
      source: "직접 등록",
      memo: "현재 구독 메모",
      archived: false,
      periodState: "current",
    },
    {
      id: "subscription-scheduled",
      startIssue: "2027년 5~6월호",
      lastIssue: "2028년 3~4월호",
      quantity: 1,
      appliedAt: null,
      source: "Google Forms",
      memo: null,
      archived: false,
      periodState: "scheduled",
    },
    {
      id: "subscription-past",
      startIssue: "2025년 5~6월호",
      lastIssue: "2026년 3~4월호",
      quantity: 1,
      appliedAt: null,
      source: "기존 XLSX",
      memo: "2026년 기존 배부현황 최초 이전",
      archived: false,
      periodState: "past",
    },
    {
      id: "subscription-archived",
      startIssue: "2024년 5~6월호",
      lastIssue: "2025년 3~4월호",
      quantity: 1,
      appliedAt: null,
      source: "현장 신청",
      memo: null,
      archived: true,
      periodState: "archived",
    },
  ],
  distributions: [
    {
      issue: "2026년 7~8월호",
      quantity: 2,
      distributedAt: "2026-06-28T12:30:00+09:00",
      reversed: false,
    },
  ],
  checkItems: [
    {
      id: "check-needed",
      summary: "다음 배부 때 수량 확인",
      status: "확인 필요",
      updatedAt: "2026-08-02T10:00:00+09:00",
    },
    {
      id: "check-done",
      summary: "연락처 확인 완료",
      status: "확인 완료",
      updatedAt: "2026-08-01T10:00:00+09:00",
    },
  ],
  memos: [
    {
      id: "memo-needed",
      content: "다음 배부 때 수량 확인",
      status: "활성",
      updatedAt: "2026-08-02T10:00:00+09:00",
    },
    {
      id: "memo-done",
      content: "연락처 확인 완료",
      status: "활성",
      updatedAt: "2026-08-01T10:00:00+09:00",
    },
  ],
};

describe("ManagementPersonList", () => {
  it("keeps rows focused on cohort and name while preserving context accessibly", () => {
    const markup = renderToStaticMarkup(
      <ManagementPersonList
        people={people}
        selectedId="person-one"
        onSelect={vi.fn()}
      />,
    );

    expect(markup).not.toContain("010-0000-0000");
    expect(markup).toContain('data-testid="management-person-primary"');
    expect(markup).not.toContain('data-testid="management-person-meta"');
    expect(markup).not.toContain('data-testid="management-person-period"');
    expect(markup).toContain(
      'aria-label="00 가상 신청자 · 구독 2건 · 2027년 3~4월호까지"',
    );
    expect(markup).not.toContain("정식 등록");
    expect(markup).toContain('data-testid="management-person-status-marker"');
    expect(markup).toContain('aria-label="정보 보완 필요"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it("does not mark an active applicant without a cohort as needing profile completion", () => {
    const markup = renderToStaticMarkup(
      <ManagementPersonList
        people={[
          {
            ...people[0],
            id: "person-without-cohort",
            name: "또래 미입력 신청자",
            cohort: null,
            status: "정식 등록",
          },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).not.toContain('aria-label="정보 보완 필요"');
    expect(markup).toContain('aria-label="또래 정보 없음 또래 미입력 신청자');
    expect(markup).toContain("또래 미입력 신청자");
  });
});

describe("PersonDetailPanel", () => {
  it("shows the complete phone and linked memo content", () => {
    const markup = renderToStaticMarkup(
      <PersonDetailPanel
        detail={detail}
        busy={false}
        onEdit={vi.fn()}
        onRenew={vi.fn()}
        onToggleArchived={vi.fn()}
      />,
    );

    expect(markup).toContain("010-0000-0000");
    expect(markup).not.toContain("정식 등록");
    expect(markup).toContain('data-testid="linked-memos"');
    expect(markup).toContain("다음 배부 때 수량 확인");
    expect(markup).toContain("연락처 확인 완료");
    expect(markup).toContain('data-testid="person-memo-form"');
    expect(markup).toContain("메모");
  });

  it("does not add an empty-state sentence to the linked memo section", () => {
    const markup = renderToStaticMarkup(
      <PersonDetailPanel
        detail={{ ...detail, checkItems: [], memos: [] }}
        busy={false}
        onEdit={vi.fn()}
        onRenew={vi.fn()}
        onToggleArchived={vi.fn()}
      />,
    );

    expect(markup).not.toContain("연결된 메모가 없습니다.");
    expect(markup).not.toContain('class="person-note empty"');
  });

  it("keeps the cohort badge and applicant name on the same identity line", () => {
    const markup = renderToStaticMarkup(
      <PersonDetailPanel
        detail={detail}
        busy={false}
        onEdit={vi.fn()}
        onRenew={vi.fn()}
        onToggleArchived={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="person-identity"');
    expect(markup).toContain('data-testid="person-cohort"');
    expect(markup).toContain('data-testid="person-name"');
    expect(markup).toMatch(
      /data-testid="person-cohort"[\s\S]*data-testid="person-name"/,
    );
  });

  it("distinguishes every subscription period with text and exposes distribution columns", () => {
    const markup = renderToStaticMarkup(
      <PersonDetailPanel
        detail={detail}
        busy={false}
        onEdit={vi.fn()}
        onRenew={vi.fn()}
        onToggleArchived={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="subscription-current"');
    expect(markup).toContain("현재 구독");
    expect(markup).toContain("시작");
    expect(markup).toContain("끝");
    expect(markup).toContain('class="subscription-quantity numeric"');
    expect(markup).toContain("2권");
    expect(markup).not.toContain("→");
    expect(markup).not.toContain("기존 XLSX");
    expect(markup).not.toContain("2026년 기존 배부현황 최초 이전");
    expect(markup).toContain('data-testid="subscription-scheduled"');
    expect(markup).toContain("예정 구독");
    expect(markup).toContain('data-testid="subscription-past"');
    expect(markup).toContain("지난 구독");
    expect(markup).toContain('data-testid="subscription-archived"');
    expect(markup).toContain("보관된 구독");
    expect(markup).toContain('data-testid="distribution-history-header"');
    expect(markup).toContain("배부 호");
    expect(markup).toContain("처리");
    expect(markup).toContain("처리 시각");
  });
});

describe("ManagementScreen heading actions", () => {
  it("keeps all three compact actions and gives registration primary emphasis", () => {
    const markup = renderToStaticMarkup(
      <ManagementScreen
        issue={{ year: 2026, startMonth: 7 }}
        notify={vi.fn()}
        recordAction={vi.fn()}
      />,
    );

    expect(markup).toMatch(
      /class="secondary-button compact"[^>]*data-testid="open-handover"/,
    );
    expect(markup).toMatch(
      /class="secondary-button compact"[^>]*data-testid="open-application-import"/,
    );
    expect(markup).toMatch(
      /class="primary-button compact"[^>]*data-testid="open-register-person"/,
    );
    expect(markup).toContain("데이터 백업·복원");
    expect(markup).toContain("Google 응답 붙여넣기");
    expect(markup).toContain("+ 신청자 등록");
    expect(markup).toContain("정보 보완 필요 0명");
    expect(markup).toContain(
      "현장 간이 등록 상태가 아직 보완되지 않은 신청자 수",
    );
    expect(markup).not.toContain("+ QT 신청자 정식 등록");
    expect(markup).toContain('data-testid="management-heading-help"');
    expect(markup).toMatch(
      /data-testid="management-heading-help"[\s\S]*role="tooltip"[\s\S]*과거 구독과 배부 기록을 보존하면서 정보를 보완하고 갱신합니다\./,
    );
    expect(markup).not.toContain(
      "과거 구독과 배부 기록을 보존하면서 정보를 보완하고 갱신합니다.</p>",
    );
    expect(markup).toContain("<h2>신청자 관리</h2>");
    expect(markup).not.toContain("신청과 구독");
    expect(markup).not.toContain("신청자 정보와 전체 이력");
  });
});

describe("ManagementEditDialog", () => {
  it("keeps the selected person's linked memo content visible", () => {
    const markup = renderToStaticMarkup(
      <ManagementEditDialog
        person={detail}
        busy={false}
        onClose={vi.fn()}
        onSaved={vi.fn(async () => true)}
      />,
    );

    expect(markup).toContain('data-testid="linked-memos-editor"');
    expect(markup).toContain("다음 배부 때 수량 확인");
    expect(markup).toContain("연락처 확인 완료");
    expect(markup).toContain("메모");
    expect(markup).not.toContain("linked-memo-actions");
    expect(markup).not.toContain(">보관<");
    expect(markup).not.toContain(">삭제<");
  });
});
