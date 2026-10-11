import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { validateDraftFields, validateDraftInput } from "./draftValidation";
import { Phase2DialogContent } from "./Phase2Dialogs";
import type { DeskPerson } from "./phase2";

const validInput = {
  name: "현장 신청자",
  cohort: "00",
  phone: "",
  quantity: 1,
};

describe("현장 간이 등록 입력", () => {
  it("adds to an existing profile with missing cohort without re-registering it, but still validates quantity", () => {
    expect(
      validateDraftFields({ ...validInput, name: "", cohort: "" }, true),
    ).toEqual({});
    expect(
      validateDraftFields(
        { ...validInput, name: "", cohort: "", quantity: 0 },
        true,
      ),
    ).toEqual({ quantity: "수량은 1권 이상 입력하세요." });
  });
  it("requires both name and cohort for annual on-site registration", () => {
    expect(validateDraftInput({ ...validInput, cohort: "" })).toBe(
      "또래를 입력하세요.",
    );
    expect(validateDraftInput({ ...validInput, name: "   " })).toBe(
      "이름을 입력하세요.",
    );
  });

  it("reports every required field in one submit and allows an omitted phone", () => {
    expect(
      validateDraftFields({ ...validInput, name: " ", cohort: " " }),
    ).toEqual({ name: "이름을 입력하세요.", cohort: "또래를 입력하세요." });
    expect(validateDraftFields(validInput)).toEqual({});
  });

  it("accepts only a two-digit cohort when it is provided", () => {
    expect(validateDraftInput({ ...validInput, cohort: "09" })).toBeNull();
    expect(validateDraftInput({ ...validInput, cohort: "9" })).toBe(
      "또래는 두 자리 숫자만 입력할 수 있습니다.",
    );
    expect(validateDraftInput({ ...validInput, cohort: "9a" })).toBe(
      "또래는 두 자리 숫자만 입력할 수 있습니다.",
    );
  });

  it("rejects a non-positive quantity", () => {
    expect(validateDraftInput({ ...validInput, quantity: 0 })).toBe(
      "수량은 1권 이상 입력하세요.",
    );
  });
});

describe("배부 확인", () => {
  it("renders a focused submit action for the second Enter", () => {
    const person: DeskPerson = {
      personId: "person-confirm",
      subscriptionId: "subscription-confirm",
      distributionTargets: [],
      name: "가상 신청자",
      cohort: "00",
      phone: null,
      personStatus: "정상",
      subscriptionStatus: "유효",
      distributionStatus: "미배부",
      targetQuantity: 2,
      distributedQuantity: 0,
      remainingQuantity: 2,
      lastIssue: "2026년 11~12월호",
      endDate: "2026-12-31",
      isLastIssue: false,
      hasMemo: false,
      canDistribute: true,
    };
    const markup = renderToStaticMarkup(
      <Phase2DialogContent
        dialog={{ type: "confirm-distribution", person }}
        issue={{ year: 2026, startMonth: 9 }}
        busy={false}
        onClose={vi.fn()}
        mutate={vi.fn().mockResolvedValue(true)}
        recordAction={vi.fn()}
      />,
    );

    expect(markup).toContain("배부하시겠습니까?");
    expect(markup).toContain("이번 호 2권");
    expect(markup).toContain('data-testid="confirm-distribution-form"');
    expect(markup).toContain('type="submit" autofocus');
  });

  it("renders explicit existing-person search and new-person entry controls", () => {
    const markup = renderToStaticMarkup(
      <Phase2DialogContent
        dialog={{ type: "purchase" }}
        issue={{ year: 2026, startMonth: 7 }}
        busy={false}
        onClose={vi.fn()}
        mutate={vi.fn().mockResolvedValue(true)}
        recordAction={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="purchase-person-search"');
    expect(markup).not.toContain("기존 신청자를 선택하면 구매");
  });

  it("marks the partial distribution dialog for balanced quantity spacing", () => {
    const person: DeskPerson = {
      personId: "person-partial",
      subscriptionId: "subscription-partial",
      distributionTargets: [],
      name: "가상 신청자",
      cohort: "00",
      phone: null,
      personStatus: "정상",
      subscriptionStatus: "유효",
      distributionStatus: "미배부",
      targetQuantity: 3,
      distributedQuantity: 0,
      remainingQuantity: 3,
      lastIssue: "2026년 11~12월호",
      endDate: "2026-12-31",
      isLastIssue: false,
      hasMemo: false,
      canDistribute: true,
    };
    const markup = renderToStaticMarkup(
      <Phase2DialogContent
        dialog={{ type: "partial", person }}
        issue={{ year: 2026, startMonth: 9 }}
        busy={false}
        onClose={vi.fn()}
        mutate={vi.fn().mockResolvedValue(true)}
        recordAction={vi.fn()}
      />,
    );

    expect(markup).toContain('class="dialog partial-distribution-dialog"');
    const group = renderToStaticMarkup(
      <Phase2DialogContent
        dialog={{ type: "group-distribution", person }}
        issue={{ year: 2026, startMonth: 9 }}
        busy={false}
        onClose={vi.fn()}
        mutate={vi.fn().mockResolvedValue(true)}
        recordAction={vi.fn()}
      />,
    );
    expect(group).toContain("이번에 배부한 권수");
    expect(group).not.toContain("추가로 기록합니다");
    expect(group).not.toContain("현재 0권 배부");
  });
});

describe("현장 구독 메뉴 이름", () => {
  it.each([
    ["draft", "1년 구독"],
    ["purchase", "1달 구독"],
  ] as const)(
    "identifies the %s form using its toolbar label",
    (type, label) => {
      const markup = renderToStaticMarkup(
        <Phase2DialogContent
          dialog={{ type }}
          issue={{ year: 2026, startMonth: 9 }}
          busy={false}
          onClose={vi.fn()}
          mutate={vi.fn().mockResolvedValue(true)}
          recordAction={vi.fn()}
        />,
      );
      expect(markup).toContain(`<h2 id="dialog-title">${label}</h2>`);
      expect(markup).toContain('class="dialog purchase-dialog"');
      expect(markup).toContain("선택 메모");
      expect(markup).not.toContain('name="cohort"');
      expect(markup).not.toContain('name="phone"');
      expect(markup).not.toContain('name="purchaseCohort"');
      expect(markup).toContain("2026년 9~10월호");
      if (type === "purchase") expect(markup).toContain("2026년 9~10월호");
    },
  );
});
