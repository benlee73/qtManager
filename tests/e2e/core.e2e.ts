import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { beforeEach } from "mocha";

const execFileAsync = promisify(execFile);
const nativeVisualEnabled = process.env.QT_MANAGER_NATIVE_VISUAL === "1";
const nativeCommandTimeoutMs = 5_000;

describe("QT Manager desktop flow", () => {
  before(async () => {
    // CI checkouts do not contain the ignored screenshot directory yet.
    mkdirSync(resolve("test-results"), { recursive: true });
    if (nativeVisualEnabled) await assertNativeVisualPreflight();
  });

  beforeEach(async () => {
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector('[data-testid="people-search"]') !== null,
        ),
      { timeoutMsg: "E2E 초기화 전에 QT Manager 화면이 준비되지 않았습니다." },
    );
    await invokeTauri("reset_e2e_state_command");
    await refreshApp(
      "E2E 테스트 상태를 초기화한 뒤 화면을 새로 열지 못했습니다.",
    );
    // The search input is rendered before the async desk refresh completes.
    // Wait for either the operator dialog or an already persisted operator so
    // the first test action cannot race the initial database load.
    await configureOperatorIfNeeded();
    await setPersonFilterPreset("남은 배부");
  });

  it("registers an on-site applicant, partially distributes, completes and undoes", async () => {
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.title)) === "QT Manager" &&
        (await browser.execute(
          () =>
            document.querySelector('[data-testid="people-search"]') !== null,
        )),
      { timeoutMsg: "QT Manager 현장 배부 화면이 준비되지 않았습니다." },
    );

    const applicant = `가상현장${Date.now()}`;

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-draft"]')
        ?.click();
    });
    await browser.waitUntil(async () =>
      browser.execute(
        () =>
          document.querySelector<HTMLButtonElement>(
            '[data-testid="draft-form"] button[type="submit"]',
          )?.disabled === false,
      ),
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="draft-form"]')
        ?.requestSubmit(
          document.querySelector<HTMLButtonElement>(
            '[data-testid="annual-submit-save"]',
          )!,
        );
    });
    await waitForText('[data-testid="draft-form-error"]', "이름을 입력하세요.");
    expect(
      await browser.execute(() => {
        const name =
          document.querySelector<HTMLInputElement>("input[name='name']")!;
        const cohort = document.querySelector<HTMLInputElement>(
          "input[name='cohort']",
        )!;
        return name.getAttribute("aria-invalid") === "true" && cohort === null;
      }),
    ).toBe(true);
    const alignedInputs = async () =>
      browser.execute(() => {
        const name = document
          .querySelector<HTMLInputElement>("input[name='phone']")!
          .getBoundingClientRect();
        const cohort = document
          .querySelector<HTMLInputElement>("input[name='cohort']")!
          .getBoundingClientRect();
        return (
          Math.abs(name.top - cohort.top) < 1 &&
          Math.abs(name.height - cohort.height) < 1
        );
      });
    await setInput("input[name='name']", applicant);
    await clickButtonByText("신청만 저장");
    await waitForText(
      '[data-testid="draft-cohort-error"]',
      "또래를 입력하세요.",
    );
    expect(await alignedInputs()).toBe(true);
    await setInput("input[name='cohort']", "00");
    await setInput("input[name='quantity']", "2");
    await setInput("input[name='note']", "가상 연간 메모");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="draft-form"]')
        ?.requestSubmit(
          document.querySelector<HTMLButtonElement>(
            '[data-testid="annual-submit-save"]',
          )!,
        );
    });
    await waitForText(".toast", "1년 구독 신청을 저장했습니다");

    await setInput('[data-testid="people-search"]', applicant);
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes(applicant) &&
        (await textOf('[data-testid="person-row"]')).includes("2권 배부"),
      { timeoutMsg: "간이 등록한 2권 구독 신청자를 찾지 못했습니다." },
    );
    await setInput("#quick-item", "간격 검증 메모");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="add-memo"]')
        ?.click();
    });
    await waitForText(".memo-list", "간격 검증 메모");
    const spacing = await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"]',
      );
      const memoList = document.querySelector<HTMLElement>(".memo-list");
      const memoCard = document.querySelector<HTMLElement>(".memo-card");
      return {
        personRowHeight: row
          ? Math.round(row.getBoundingClientRect().height)
          : 0,
        personRowPadding: row ? getComputedStyle(row).padding : "",
        memoListGap: memoList ? getComputedStyle(memoList).rowGap : "",
        memoCardPadding: memoCard ? getComputedStyle(memoCard).padding : "",
      };
    });
    expect(spacing.personRowHeight).toBeGreaterThanOrEqual(68);
    expect(spacing.personRowPadding).toBe("8px 11px");
    expect(spacing.memoListGap).toBe("8px");
    expect(spacing.memoCardPadding).toBe("11px");

    await clickButtonByText("", `${applicant} 메뉴`);
    await clickButtonByText("일부만 배부");
    const partialInputSpacing = await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".partial-distribution-dialog input[name='quantity']",
      );
      if (!input) return null;
      const style = getComputedStyle(input);
      return {
        minHeight: style.minHeight,
        padding: style.padding,
      };
    });
    expect(partialInputSpacing).toEqual({
      minHeight: "48px",
      padding: "12px 16px",
    });
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("일부 배부 기록");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1 / 2권"),
      { timeoutMsg: "1권 일부 배부가 화면에 반영되지 않았습니다." },
    );
    await setPersonFilterPreset("전체");

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.click();
    });
    await dispatchShortcut("Enter");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("배부 완료") &&
        (await textOf('[data-testid="person-row"]')).includes("2 / 2권"),
      { timeoutMsg: "남은 1권 기본 배부가 완료되지 않았습니다." },
    );

    await clickButtonByText("배부 취소");
    await waitForText("#dialog-title", "배부를 취소할까요?");
    await waitForText(".dialog-description", applicant);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(".dialog .danger-button")
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1 / 2권"),
      { timeoutMsg: "최근 배부 되돌리기가 반영되지 않았습니다." },
    );
    await clickButtonByText("", "마지막 동작 되돌리기");
    await waitForText('[data-testid="person-row"]', "배부 완료");
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText('[data-testid="person-row"]', "일부 배부");
  });

  it("selects purchase candidates by keyboard and one pointer click, including the last new-person option", async () => {
    const prefix = `가상선택${Date.now()}`;
    await registerE2ePerson(`${prefix}가`);
    await registerE2ePerson(`${prefix}나`);
    await clickButtonByText("+ 1달 구독");
    const initialSlotHeight = await browser.execute(
      () =>
        document
          .querySelector(".purchase-person-slot > .field")!
          .getBoundingClientRect().height,
    );
    await setInput('[data-testid="purchase-person-search"]', prefix);
    await waitForText('[data-testid="purchase-person-result"]', prefix);
    const search = '[data-testid="purchase-person-search"]';
    const key = async (value: string, composing = false) =>
      browser.execute(
        (selector, value, composing) => {
          document.querySelector<HTMLInputElement>(selector)?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: value,
              bubbles: true,
              isComposing: composing,
            }),
          );
        },
        search,
        value,
        composing,
      );
    await key("ArrowDown");
    await key("Enter", true);
    expect(
      await browser.execute(
        () => document.querySelector(".purchase-person-selected") === null,
      ),
    ).toBe(true);
    await key("ArrowDown");
    await key("ArrowUp");
    await key("Enter");
    await waitForText(".purchase-person-selected", `${prefix}가`);
    expect(await browser.$(search).isExisting()).toBe(false);
    const selectedSlotHeight = await browser.execute(
      () =>
        document
          .querySelector(".purchase-person-selected")!
          .getBoundingClientRect().height,
    );
    expect(Math.abs(selectedSlotHeight - initialSlotHeight)).toBeLessThan(1);
    await clickButtonByText("선택 해제");
    expect(await browser.$(search).isExisting()).toBe(true);
    expect(
      await browser.execute(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
    ).toBe("purchase-person-search");
    await setInput(search, prefix);
    await waitForText('[data-testid="purchase-person-result"]', prefix);
    await browser.$('[data-testid="purchase-person-result"]').click();
    await waitForText(".purchase-person-selected", `${prefix}가`);
    expect(await browser.$(search).isExisting()).toBe(false);
    await clickButtonByText("선택 해제");
    expect(await browser.$(search).isExisting()).toBe(true);
    expect(
      await browser.execute(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
    ).toBe("purchase-person-search");
    await setInput(search, prefix);
    await waitForText('[data-testid="purchase-person-result"]', prefix);
    expect(
      await browser.execute(() =>
        document
          .querySelector(".purchase-person-results")
          ?.lastElementChild?.getAttribute("data-testid"),
      ),
    ).toBe("purchase-new-person-toggle");
    await key("ArrowUp");
    await key("Enter");
    await waitForText(".purchase-new-person-fields", "또래 (선택)");
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="new-person-selected"]') !==
            null && document.querySelector(".purchase-person-results") === null,
      ),
    ).toBe(true);
    await browser.keys("Escape");
  });

  it("adds an annual subscription to the explicitly selected person without duplicating their profile", async () => {
    const name = `가상기존연간${Date.now()}`;
    const personId = await registerE2ePerson(name);
    await clickButtonByText("+ 1년 구독");
    await setInput("input[name='name']", name);
    await waitForText('[data-testid="purchase-person-result"]', name);
    await browser.$('[data-testid="purchase-person-result"]').click();
    await waitForText(".purchase-person-selected", name);
    expect(
      await browser.execute(
        () => document.querySelector("input[name='cohort']") === null,
      ),
    ).toBe(true);
    await setInput("input[name='quantity']", "2");
    await clickButtonByText("신청만 저장");
    await waitForText(
      ".duplicate-warning",
      "기존 구독과 기간이 겹칠 수 있습니다.",
    );
    await browser.$('.duplicate-warning input[type="checkbox"]').click();
    await clickButtonByText("신청만 저장");
    await waitForText(".toast", "1년 구독 신청을 저장했습니다.");
    const detail = await invokeTauri<{
      cohort: string;
      subscriptions: { quantity: number; paymentStatus: string }[];
    }>("load_person_detail_command", { personId });
    expect(detail.cohort).toBe("00");
    expect(detail.subscriptions).toHaveLength(2);
    expect(
      detail.subscriptions.some(
        (subscription) =>
          subscription.quantity === 2 &&
          subscription.paymentStatus === "pending",
      ),
    ).toBe(true);
    const management = await invokeTauri<{ people: { id: string }[] }>(
      "load_people_management_command",
      { query: name, includeArchived: false },
    );
    expect(management.people.map((person) => person.id)).toEqual([personId]);
  });

  it("activates quick memo add once when IME release arrives before press", async () => {
    const content = `가상한글조합메모${Date.now()}`;
    await setInput("#quick-item", content);
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>("#quick-item")!;
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="add-memo"]',
      )!;
      input.focus();
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      button.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
    });
    await waitForText(".memo-list", content);
    expect(
      await browser.execute(
        (content) =>
          [...document.querySelectorAll(".memo-card")].filter((card) =>
            card.textContent?.includes(content),
          ).length,
        content,
      ),
    ).toBe(1);
    expect(await browser.$("#quick-item").getValue()).toBe("");
  });

  it("explicitly links a one-time purchase or creates a purchase-only applicant", async () => {
    const existing = `가상구매연결${Date.now()}`;
    await registerE2ePerson(existing);

    await clickButtonByText("+ 1달 구독");
    await setInput("input[name='buyerName']", existing);
    await waitForText('[data-testid="purchase-person-result"]', existing);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="purchase-person-result"]',
        )
        ?.click();
    });
    await waitForText(".purchase-person-selected", existing);
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    expect(
      await browser.execute(
        () =>
          document.querySelector('.table-toolbar [aria-label="기타 기능"]') ===
          null,
      ),
    ).toBe(true);

    await clickButtonByText("신청자 관리");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector(".management-host.screen-visible") !== null,
        ),
      { timeoutMsg: "신청자 관리 화면이 표시되지 않았습니다." },
    );
    await setInput('[data-testid="management-search"]', existing);
    await waitForText('[data-testid="management-person"]', existing);
    await waitForText('[data-testid="person-detail"]', "구독 이력 2건");
    await waitForText('[data-testid="purchase-history"]', "구매·전달 1권");

    const newPerson = `가상구매신규${Date.now()}`;
    await clickButtonByText("현장 배부");
    await clickButtonByText("+ 1달 구독");
    await setInput("input[name='buyerName']", newPerson);
    await waitForText(".purchase-new-person-fields", "또래 (선택)");
    await setInput("input[name='purchasePhone']", "11111111111");
    await clickButtonByText("구매·전달 기록");
    await waitForText(
      "#purchase-phone-error",
      "연락처는 010-xxxx-xxxx 형식으로 입력하세요.",
    );
    await setInput("input[name='purchasePhone']", "");
    await setInput("input[name='purchaseCohort']", "01");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await clickButtonByText("", "마지막 동작 되돌리기");
    await waitForText(".toast", "1달 구독: 되돌렸습니다.");
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText(".toast", "1달 구독: 다시 실행했습니다.");

    await clickButtonByText("신청자 관리");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector(".management-host.screen-visible") !== null,
        ),
      { timeoutMsg: "신청자 관리 화면이 표시되지 않았습니다." },
    );
    await setInput('[data-testid="management-search"]', newPerson);
    await waitForText('[data-testid="management-person"]', newPerson);
    expect(
      await browser.execute(
        () =>
          document.querySelectorAll('[data-testid="management-person"]').length,
      ),
    ).toBe(1);
    await waitForText('[data-testid="person-detail"]', "구독 이력 3건");
    await waitForText('[data-testid="purchase-history"]', "구매·전달 1권");
  });

  it("searches by cohort and name, blocks an expired subscription, renews it, and marks a last issue", async () => {
    await setPersonFilterPreset("전체");
    const selected = await selectedIssue();
    const expiredStart = shiftIssue(selected, -6);
    const lastIssueStart = shiftIssue(selected, -5);
    const unique = String(Date.now()).slice(-8);
    const expiredName = `가상만료${unique}`;
    const expiredPhone = `010-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const expiredId = await invokeTauri<string>("register_person_command", {
      request: {
        name: expiredName,
        cohort: "00",
        phone: expiredPhone,
        personNote: null,
        issueYear: expiredStart.year,
        issueMonth: expiredStart.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });

    // Direct fixture writes bypass both screens' normal mutation refresh. Load
    // the management snapshot before opening detail, so its stale empty list
    // cannot clear the freshly focused applicant while the test clicks Edit.
    await refreshApp("만료 신청자 fixture를 관리 목록에 불러오지 못했습니다.");
    await configureOperatorIfNeeded();
    await waitForText('[data-testid="management-person"]', expiredName);
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', `00 ${expiredName}`);
    await waitForText('[data-testid="person-row"]', "구독 만료");
    expect(
      await browser.execute(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="renew-subscription"]',
        );
        return {
          disabled: button?.disabled ?? null,
          label: button?.textContent?.trim() ?? "",
        };
      }),
    ).toEqual({ disabled: false, label: "구독 추가" });

    await setInput(
      '[data-testid="people-search"]',
      expiredPhone.replaceAll("-", ""),
    );
    await waitForText(
      '[data-testid="empty-list"]',
      "일치하는 신청자가 없습니다",
    );
    await setInput('[data-testid="people-search"]', expiredName);
    await waitForText('[data-testid="person-row"]', expiredName);
    const phoneAccess = await browser.execute((phone) => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"]',
      );
      return {
        visibleInRow: row?.textContent?.includes(phone) ?? false,
        accessibleFromRow:
          row?.getAttribute("aria-label")?.includes(phone) ?? false,
        phoneHeaderVisible: [
          ...document.querySelectorAll<HTMLElement>(".table-head > *"),
        ].some((cell) => cell.textContent?.trim() === "전화번호"),
      };
    }, expiredPhone);
    expect(phoneAccess).toEqual({
      visibleInRow: false,
      accessibleFromRow: true,
      phoneHeaderVisible: false,
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        );
    });
    await waitForText('[data-testid="person-detail"]', expiredPhone);
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="edit-person-form"]') === null,
      ),
    ).toBe(true);
    await clickButtonByText("정보 수정");
    await browser.waitUntil(
      async () =>
        (await browser.$("input[name='phone']").getValue()) === expiredPhone,
      { timeoutMsg: "신청자 수정 화면에서 전체 전화번호를 찾지 못했습니다." },
    );
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector('[data-testid="edit-person-form"]') === null,
        ),
      { timeoutMsg: "Escape로 신청자 수정 창이 닫히지 않았습니다." },
    );
    await clickButtonByText("현장 배부");
    await browser.$('[data-testid="person-row"]').click();
    await browser.execute(() =>
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')!
        .focus(),
    );
    await browser.keys("Enter");
    await waitForText("#management-dialog-title", `${expiredName} · 구독 추가`);
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelector('[data-testid="renew-form"]') === null,
        ),
      { timeoutMsg: "만료 신청자 갱신 창이 Escape로 닫히지 않았습니다." },
    );
    await dispatchShortcut("1");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector('[data-testid="people-search"]') !== null,
        ),
      {
        timeoutMsg: "갱신 창을 닫은 뒤 현장 배부 화면으로 돌아오지 못했습니다.",
      },
    );
    await invokeTauri("renew_subscription_command", {
      request: {
        personId: expiredId,
        issueYear: selected.year,
        issueMonth: selected.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmOverlap: false,
      },
    });
    await setInput('[data-testid="people-search"]', "");
    await setInput('[data-testid="people-search"]', expiredName);
    await waitForText('[data-testid="person-row"]', "1권 배부");
    expect(await textOf('[data-testid="person-row"]')).not.toContain("유효");
    await clickButtonByText("1권 배부");
    await waitForText('[data-testid="person-row"]', "배부 완료");

    const lastName = `가상마지막${unique}`;
    await invokeTauri<string>("register_person_command", {
      request: {
        name: lastName,
        cohort: "01",
        phone: null,
        personNote: null,
        issueYear: lastIssueStart.year,
        issueMonth: lastIssueStart.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });
    await setInput('[data-testid="people-search"]', lastName);
    await waitForText('[data-testid="person-row"]', "이번 호 마지막");
    await waitForText(
      '[data-testid="person-row"]',
      `${selected.year}년 ${selected.startMonth}~${selected.startMonth + 1}월호까지`,
    );
  });

  it("automatically dismisses a guarded deletion error without deleting history", async () => {
    const name = `가상알림${Date.now()}`;
    await registerE2ePerson(name);
    await refreshApp("알림 검사 fixture를 관리 목록에 불러오지 못했습니다.");
    await configureOperatorIfNeeded();
    await clickButtonByText("신청자 관리");
    await setInput('[data-testid="management-search"]', name);
    await waitForText('[data-testid="person-detail"]', name);
    await browser.execute(() => {
      const original = window.confirm;
      try {
        window.confirm = () => true;
        document
          .querySelector<HTMLButtonElement>('[data-testid="delete-person"]')!
          .click();
      } finally {
        window.confirm = original;
      }
    });
    await waitForText(".toast.error", "삭제할 수 없습니다");
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.querySelector(".toast.error") === null),
      { timeout: 10000, timeoutMsg: "오류 알림이 자동으로 닫히지 않았습니다." },
    );
    await waitForText('[data-testid="person-detail"]', name);
  });

  it("keeps help layouts and shortcut wording readable", async () => {
    await browser.setWindowSize(1600, 1000);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-help"]')
        ?.click();
    });
    await waitForText("#help-title", "QT Manager 도움말");
    await browser.$('[data-testid="help-detailed-toggle"]').click();
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="help-backdrop"]')
            ?.classList.contains("help-backdrop-open"),
        ),
      { timeoutMsg: "도움말 우측 패널 열기 애니메이션이 시작되지 않았습니다." },
    );
    expect(
      await browser.execute(() => {
        const backdrop = document.querySelector<HTMLElement>(
          '[data-testid="help-backdrop"]',
        );
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        if (!backdrop || !panel) return null;
        const rect = panel.getBoundingClientRect();
        const backdropStyle = getComputedStyle(backdrop);
        const panelStyle = getComputedStyle(panel);
        return {
          widthRatio: rect.width / window.innerWidth,
          heightRatio: rect.height / window.innerHeight,
          flexDirection: getComputedStyle(panel).flexDirection,
          backdropDisplay: backdropStyle.display,
          justifyContent: backdropStyle.justifyContent,
          alignItems: backdropStyle.alignItems,
          layoutRight: panel.offsetLeft + panel.offsetWidth,
          topGap: rect.top,
          animationName: panelStyle.animationName,
        };
      }),
    ).toMatchObject({
      widthRatio: expect.any(Number),
      heightRatio: expect.any(Number),
      flexDirection: "column",
      backdropDisplay: "flex",
      justifyContent: "flex-end",
      alignItems: "stretch",
    });
    const motion = await browser.execute(() => {
      const style = getComputedStyle(
        document.querySelector<HTMLElement>('[data-testid="help-panel"]')!,
      );
      return {
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
      };
    });
    if (motion.reduced) {
      expect(motion.transitionProperty).toBe("none");
      expect(motion.animationName).toBe("none");
    } else {
      expect(motion.transitionProperty).toContain("transform");
      expect(motion.transitionDuration).toContain("0.18s");
      expect(motion.animationName).toBe("help-panel-slide-in");
      expect(motion.animationDuration).toBe("0.18s");
    }
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        return (
          rect.width / window.innerWidth >= 0.7 &&
          rect.width / window.innerWidth <= 0.8 &&
          rect.height / window.innerHeight >= 0.98 &&
          Math.abs(window.innerWidth - (panel.offsetLeft + panel.offsetWidth)) <
            1 &&
          rect.top < 1
        );
      }),
    ).toBe(true);
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        const heading = panel?.querySelector<HTMLElement>(".help-heading");
        const content = panel?.querySelector<HTMLElement>(".help-content");
        const sectionHeading = panel?.querySelector<HTMLElement>(
          ".help-section-heading",
        );
        if (!panel || !heading || !content || !sectionHeading) return null;
        const panelRect = panel.getBoundingClientRect();
        const headingStyle = getComputedStyle(heading);
        const contentStyle = getComputedStyle(content);
        const sectionHeadingStyle = getComputedStyle(sectionHeading);
        return {
          widthRatio: panelRect.width / window.innerWidth,
          heightRatio: panelRect.height / window.innerHeight,
          headingVerticalPadding:
            parseFloat(headingStyle.paddingTop) +
            parseFloat(headingStyle.paddingBottom),
          contentPaddingBottom: parseFloat(contentStyle.paddingBottom),
          sectionHeadingPaddingTop: parseFloat(sectionHeadingStyle.paddingTop),
        };
      }),
    ).toEqual({
      widthRatio: expect.any(Number),
      heightRatio: expect.any(Number),
      headingVerticalPadding: expect.any(Number),
      contentPaddingBottom: expect.any(Number),
      sectionHeadingPaddingTop: expect.any(Number),
    });
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        const heading = panel?.querySelector<HTMLElement>(".help-heading");
        const content = panel?.querySelector<HTMLElement>(".help-content");
        const sectionHeading = panel?.querySelector<HTMLElement>(
          ".help-section-heading",
        );
        if (!heading || !content || !sectionHeading) return false;
        const headingStyle = getComputedStyle(heading);
        const contentStyle = getComputedStyle(content);
        const sectionHeadingStyle = getComputedStyle(sectionHeading);
        return (
          parseFloat(headingStyle.paddingTop) +
            parseFloat(headingStyle.paddingBottom) <=
            36 &&
          parseFloat(contentStyle.paddingBottom) <= 32 &&
          parseFloat(sectionHeadingStyle.paddingTop) <= 16
        );
      }),
    ).toBe(true);
    expect(
      await browser.execute(() => {
        const title = document.querySelector<HTMLElement>("#help-title");
        if (!title) return null;
        const style = getComputedStyle(title);
        return {
          whiteSpace: style.whiteSpace,
          height: title.getBoundingClientRect().height,
        };
      }),
    ).toEqual({
      whiteSpace: "nowrap",
      height: expect.any(Number),
    });
    const headerControls = await browser.execute(() => {
      const selectors = [
        "#help-title",
        ".help-mode button:first-child",
        ".help-mode button:last-child",
        '[data-testid="help-search"]',
        '.help-heading > button[aria-label="도움말 닫기"]',
      ];
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`도움말 헤더 요소 없음: ${selector}`);
        const rect = element.getBoundingClientRect();
        return { height: rect.height, centerY: rect.top + rect.height / 2 };
      });
    });
    // The title now occupies the same control slot as the view buttons and
    // search, rather than the previous text-only title box (<=32px).
    expect(headerControls.map((control) => control.height)).toEqual([
      36, 36, 36, 36, 36,
    ]);
    for (const control of headerControls) {
      expect(
        Math.abs(control.centerY - headerControls[0].centerY),
      ).toBeLessThan(1);
    }
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        const layout = panel?.querySelector<HTMLElement>(".help-layout");
        return layout?.getBoundingClientRect().height ?? 0;
      }),
    ).toBeGreaterThan(100);
    await setInput('[data-testid="help-search"]', "백업");
    await browser.waitUntil(
      async () => {
        const result = await browser.execute(() => ({
          hasBackup: Boolean(
            document.querySelector('[data-testid="help-nav-handover"]'),
          ),
          hidesShortcuts: !document.querySelector(
            '[data-testid="help-nav-shortcuts"]',
          ),
        }));
        return result.hasBackup && result.hidesShortcuts;
      },
      { timeoutMsg: "도움말 검색 결과가 목차에 반영되지 않았습니다." },
    );
    await setInput('[data-testid="help-search"]', "");
    // Clearing the input restores sections immediately, but the filtered
    // navigation is restored by the deferred search effect.
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const link = document.querySelector(
            '[data-testid="help-nav-shortcuts"]',
          );
          const section = document.querySelector<HTMLElement>(
            '[data-testid="help-shortcuts"]',
          );
          return Boolean(link && section && !section.hidden);
        }),
      {
        timeoutMsg: "도움말 검색 초기화 후 단축키 목차가 복원되지 않았습니다.",
      },
    );
    await browser.execute(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        '[data-testid="help-nav-shortcuts"]',
      );
      if (!link) throw new Error("복원된 단축키 목차를 찾지 못했습니다.");
      link.click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="help-nav-shortcuts"]')
            ?.getAttribute("aria-current"),
        )) === "location",
      { timeoutMsg: "도움말 단축키 섹션으로 이동하지 않았습니다." },
    );
    expect(
      await browser.execute(() => {
        const shortcutList = document.querySelector<HTMLElement>(
          ".shortcut-list > div",
        );
        return shortcutList ? getComputedStyle(shortcutList).fontSize : "";
      }),
    ).toBe("14px");
    expect(
      await browser.execute(() => {
        const section = document.querySelector<HTMLElement>(
          '[data-testid="help-shortcuts"] .help-card-grid',
        );
        const text =
          document.querySelector<HTMLElement>('[data-testid="help-shortcuts"]')
            ?.textContent ?? "";
        return {
          stacked:
            section?.classList.contains("help-card-grid-stacked") ?? false,
          usesKoreanDirection: text.includes("아래 방향키"),
          hasBrowserKeyName: text.includes("ArrowDown"),
        };
      }),
    ).toEqual({
      stacked: true,
      usesKoreanDirection: true,
      hasBrowserKeyName: false,
    });
    await browser.saveScreenshot("test-results/ui-help-shortcuts-dark.png");

    await browser.execute(() => {
      document
        .querySelector<HTMLAnchorElement>('[data-testid="help-nav-app-info"]')
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="help-nav-app-info"]')
            ?.getAttribute("aria-current"),
        )) === "location",
      { timeoutMsg: "도움말 앱 정보 섹션으로 이동하지 않았습니다." },
    );
    await waitForText('[data-testid="support-info"]', "0.2.1");
    expect(
      await browser.execute(() => {
        const supportLabel = document.querySelector<HTMLElement>(
          '[data-testid="support-info"] dt',
        );
        const supportValue = document.querySelector<HTMLElement>(
          '[data-testid="support-info"] dd',
        );
        return {
          supportLabelFontSize: supportLabel
            ? getComputedStyle(supportLabel).fontSize
            : "",
          supportValueFontSize: supportValue
            ? getComputedStyle(supportValue).fontSize
            : "",
        };
      }),
    ).toEqual({
      supportLabelFontSize: "14px",
      supportValueFontSize: "14px",
    });
    expect(
      await browser.execute(() => {
        const cards = document.querySelector<HTMLElement>(
          '[data-testid="help-app-info"] .help-card-grid',
        );
        const action = document.querySelector<HTMLButtonElement>(
          '[data-testid="help-app-info"] .help-secondary-action',
        );
        return {
          stacked: cards?.classList.contains("help-card-grid-stacked") ?? false,
          actionFontSize: action ? getComputedStyle(action).fontSize : "",
          actionText: action?.textContent?.trim() ?? "",
        };
      }),
    ).toEqual({
      stacked: true,
      actionFontSize: "14px",
      actionText: "로그 폴더 열기",
    });
    await browser.saveScreenshot("test-results/ui-help-support-dark.png");
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          Boolean(document.querySelector("#help-title")),
        )) === false,
      { timeoutMsg: "도움말 단축키 검증 후 닫히지 않았습니다." },
    );
    await browser.setWindowSize(1120, 760);
  });

  // 이전 기록 타입의 UI 회귀 시나리오는 새 메모 화면으로 대체했다. 구버전
  // check_items/pinned_notes 어댑터는 Rust 통합 테스트에서 계속 검증한다.
  it("requires active linked memo confirmation before distribution and cancels without recording", async () => {
    const name = `가상배부확인${Date.now()}`;
    const personId = await registerE2ePerson(name);
    const contents = ["먼저 안내할 사항\n둘째 줄도 확인", "추가로 전달할 안내"];
    for (const content of contents) {
      await invokeTauri("create_memo_command", {
        request: { personId, content },
      });
    }
    const archived = await invokeTauri<string>("create_memo_command", {
      request: { personId, content: "보관한 메모는 확인에서 제외" },
    });
    await invokeTauri("update_memo_status_command", {
      request: { id: archived, archived: true },
    });
    await invokeTauri("create_memo_command", {
      request: { personId: null, content: "미연결 메모도 확인에서 제외" },
    });
    // Direct fixture writes do not use the UI mutation's refresh. Reload after
    // the final write so an earlier search response cannot retain active memos
    // whose archived state has since been committed.
    await refreshApp("메모 fixture의 최종 보관 상태를 불러오지 못했습니다.");
    await configureOperatorIfNeeded();
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', name);
    for (const content of contents) await waitForText(".memo-list", content);
    const distributionCount = async () =>
      (
        await invokeTauri<{ distributions: unknown[] }>(
          "load_person_detail_command",
          { personId },
        )
      ).distributions.length;
    const openConfirmation = async () => {
      await browser.execute(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="distribute"]')
          ?.click(),
      );
      await waitForText("#dialog-title", "배부 전 메모 확인");
    };

    await openConfirmation();
    for (const content of contents)
      expect(await textOf('[data-testid="distribution-memos"]')).toContain(
        content,
      );
    expect(await textOf('[data-testid="distribution-memos"]')).not.toContain(
      "보관한 메모",
    );
    expect(await textOf('[data-testid="distribution-memos"]')).not.toContain(
      "미연결 메모",
    );
    expect(await distributionCount()).toBe(0);
    await browser.saveScreenshot(
      "test-results/distribution-memo-confirmation.png",
    );
    await clickButtonByText("취소");
    expect(await distributionCount()).toBe(0);
    await openConfirmation();
    await browser.keys("Escape");
    expect(await distributionCount()).toBe(0);

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"]',
      );
      row?.focus();
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    await waitForText("#dialog-title", "배부 전 메모 확인");
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="confirm-distribution-form"] button[type="submit"]',
        )
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            repeat: true,
            bubbles: true,
          }),
        ),
    );
    expect(await distributionCount()).toBe(0);
    await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-distribution-form"] button[type="submit"]',
      );
      button?.click();
      button?.click();
    });
    await waitForText('[data-testid="person-row"]', "배부 완료");
    expect(await distributionCount()).toBe(1);

    const noMemoName = `가상메모없음${Date.now()}`;
    const noMemoPersonId = await registerE2ePerson(noMemoName);
    const onlyArchived = await invokeTauri<string>("create_memo_command", {
      request: { personId: noMemoPersonId, content: "보관만 있는 사람" },
    });
    await invokeTauri("update_memo_status_command", {
      request: { id: onlyArchived, archived: true },
    });
    await refreshApp("보관 메모만 있는 신청자 상태를 불러오지 못했습니다.");
    await configureOperatorIfNeeded();
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', noMemoName);
    await waitForText('[data-testid="person-row"]', noMemoName);
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="distribute"]')
        ?.click(),
    );
    await waitForText('[data-testid="person-row"]', "배부 완료");
    expect(
      await browser.execute(
        () =>
          document.querySelector(
            '[data-testid="confirm-distribution-form"]',
          ) === null,
      ),
    ).toBe(true);
  });

  it("keeps subscription shortcuts beside search and opens each form directly", async () => {
    await browser.setWindowSize(1800, 1280);
    const toolbar = await browser.execute(() => {
      const search = document
        .querySelector<HTMLElement>('[data-testid="people-search"]')!
        .getBoundingClientRect();
      const annual = document.querySelector<HTMLElement>(
        '[data-testid="open-draft"]',
      )!;
      const monthly = document.querySelector<HTMLElement>(
        '[data-testid="open-purchase"]',
      )!;
      const annualRect = annual.getBoundingClientRect();
      const monthlyRect = monthly.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>(".table-toolbar")!;
      return {
        annual: annual.textContent,
        monthly: monthly.textContent,
        extraMenu: panel.querySelector('[aria-label="기타 기능"]') !== null,
        sameRow: Math.abs(annualRect.top - monthlyRect.top) < 1,
        afterSearch: annualRect.left >= search.right,
        fits: monthlyRect.right <= panel.getBoundingClientRect().right,
        searchWidth: search.width,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(toolbar.annual).toContain("1년 구독");
    expect(toolbar.monthly).toContain("1달 구독");
    expect(toolbar.extraMenu).toBe(false);
    expect(toolbar.sameRow && toolbar.afterSearch && toolbar.fits).toBe(true);
    expect(toolbar.searchWidth).toBeGreaterThan(80);
    expect(toolbar.overflow).toBe(false);
    await browser.saveScreenshot("test-results/subscription-shortcuts.png");
    await clickButtonByText("+ 1년 구독");
    await waitForText("#dialog-title", "1년 구독");
    await browser.keys("Escape");
    await clickButtonByText("+ 1달 구독");
    await waitForText("#dialog-title", "1달 구독");
    const issue = await selectedIssue();
    await waitForText(
      ".purchase-dialog",
      `${issue.year}년 ${issue.startMonth}~${issue.startMonth + 1}월호`,
    );
    await browser.keys("Escape");
  });

  it("promotes searched applicants' memos and restores the default order when cleared", async () => {
    const name = `가상검색메모${Date.now()}`;
    const personId = await registerE2ePerson(name);
    const linkedId = await invokeTauri<string>("create_memo_command", {
      request: { personId, content: "검색 대상의 오래된 연결 메모" },
    });
    await setInput("#quick-item", "최근에 추가한 미연결 메모");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="add-memo"]')
        ?.click();
    });
    await waitForText(".memo-list", "최근에 추가한 미연결 메모");
    const memoIds = () =>
      browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(".memo-list .memo-card"),
          (card) => card.dataset.memoId,
        ),
      );
    const originalOrder = await memoIds();
    expect(originalOrder).toHaveLength(2);
    expect(originalOrder[1]).toBe(linkedId);

    await setInput('[data-testid="people-search"]', `00 ${name}`);
    await browser.waitUntil(async () => (await memoIds())[0] === linkedId, {
      timeoutMsg: "검색한 신청자의 메모가 상단으로 이동하지 않았습니다.",
    });
    expect(await memoIds()).toEqual([linkedId, originalOrder[0]]);

    await setInput('[data-testid="people-search"]', "일치하지않는이름");
    await browser.waitUntil(
      async () => (await memoIds())[0] === originalOrder[0],
    );
    expect(await memoIds()).toEqual(originalOrder);
    await setInput('[data-testid="people-search"]', name);
    await browser.waitUntil(async () => (await memoIds())[0] === linkedId);
    await setInput('[data-testid="people-search"]', "");
    await browser.waitUntil(
      async () => (await memoIds())[0] === originalOrder[0],
    );
    expect(await memoIds()).toEqual(originalOrder);
  });

  it("creates, edits, archives, restores and removes both linked and unlinked memos", async () => {
    const person = `가상메모${Date.now()}`;
    await registerE2ePerson(person);
    await setPersonFilterPreset("전체");
    const unlinked = `연결하지 않은 메모 ${Date.now()}`;
    await setInput("#quick-item", unlinked);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="add-memo"]')
        ?.click();
    });
    await waitForText(".toast", "메모를 추가했습니다.");
    await waitForText(".memo-list", unlinked);
    expect(
      await browser.execute(
        () => document.querySelector(".notes-panel .count-badge") === null,
      ),
    ).toBe(true);

    await clickButtonByText("", "마지막 동작 되돌리기");
    await browser.waitUntil(
      async () => !(await textOf(".memo-list")).includes(unlinked),
      { timeoutMsg: "메모 추가 되돌리기가 반영되지 않았습니다." },
    );
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText(".memo-list", unlinked);

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await clickButtonByText("메모 추가");
    await waitForText("#dialog-title", "메모 추가");
    const linked = `연결 메모 ${Date.now()}`;
    await setInput("textarea[name='content']", linked);
    await clickButtonByText("메모 저장");
    await waitForText(".toast", "메모를 저장했습니다.");
    await waitForText(".memo-list", linked);
    await waitForText(".memo-list", person);

    await browser.execute((content) => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".memo-card"),
      ].find((candidate) => candidate.textContent?.includes(content));
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, linked);
    await waitForText(".memo-detail-dialog", linked);
    expect(
      await browser.execute(() => {
        const dialog = document
          .querySelector(".memo-detail-dialog")!
          .getBoundingClientRect();
        const actions = document
          .querySelector(".memo-detail-actions")!
          .getBoundingClientRect();
        return dialog.bottom - actions.bottom;
      }),
    ).toBeLessThanOrEqual(25);
    expect(
      await browser.execute(
        () => document.querySelector(".memo-detail-editor") === null,
      ),
    ).toBe(true);
    await clickButtonByText("", "메모 본문. 눌러서 편집");
    const edited = `${linked} 수정`;
    await setInput(".memo-detail-editor", edited);
    await clickButtonByText("저장");
    await waitForText(".toast", "메모를 수정했습니다.");
    await waitForText(".memo-list", edited);

    await browser.execute((content) => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".memo-card"),
      ].find((candidate) => candidate.textContent?.includes(content));
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, edited);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-detail-dialog .memo-detail-actions .secondary-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 보관했습니다.");
    await browser.waitUntil(
      async () => !(await textOf(".memo-list")).includes(edited),
      { timeoutMsg: "메모 보관이 활성 목록에 반영되지 않았습니다." },
    );
    await clickButtonByText("보관함");
    await waitForText(".memo-archive-dialog", edited);
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector(".memo-archive-dialog") === null,
        )) === true,
      { timeoutMsg: "Escape로 메모 보관함을 닫지 못했습니다." },
    );
    await clickButtonByText("보관함");
    await waitForText(".memo-archive-dialog", edited);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-archive-dialog .memo-archive-actions .danger-link-button",
        )
        ?.click();
    });
    await waitForText(".delete-confirm-dialog", "영구 삭제");
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector(".delete-confirm-dialog") === null,
        )) === true,
      { timeoutMsg: "메모 삭제 확인창 Escape 닫기가 반영되지 않았습니다." },
    );
    expect(
      await browser.execute(
        () => document.querySelector(".memo-archive-dialog") !== null,
      ),
    ).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-archive-dialog .memo-archive-actions .quiet-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 복원했습니다.");
    await waitForText(".memo-list", edited);

    await browser.execute((content) => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".memo-card"),
      ].find((candidate) => candidate.textContent?.includes(content));
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, edited);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-detail-dialog .memo-detail-actions .danger-button",
        )
        ?.click();
    });
    await waitForText(".delete-confirm-dialog", "영구 삭제");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".delete-confirm-dialog .danger-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 삭제했습니다.");
    await browser.waitUntil(
      async () => !(await textOf(".memo-list")).includes(edited),
      { timeoutMsg: "메모 삭제가 활성 목록에 반영되지 않았습니다." },
    );

    const archivedOnly = `보관함에서 삭제할 메모 ${Date.now()}`;
    await setInput("#quick-item", archivedOnly);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="add-memo"]')
        ?.click();
    });
    await waitForText(".memo-list", archivedOnly);
    await browser.execute((content) => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".memo-card"),
      ].find((candidate) => candidate.textContent?.includes(content));
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, archivedOnly);
    await waitForText(".memo-detail-dialog", archivedOnly);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-detail-dialog .memo-detail-actions .secondary-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 보관했습니다.");
    await clickButtonByText("보관함");
    await waitForText(".memo-archive-dialog", archivedOnly);
    expect(
      await browser.execute(
        () =>
          document.querySelector(
            ".memo-archive-actions .danger-link-button",
          ) !== null,
      ),
    ).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-archive-dialog .memo-archive-actions .danger-link-button",
        )
        ?.click();
    });
    await waitForText(".delete-confirm-dialog", "영구 삭제");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".delete-confirm-dialog .danger-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 삭제했습니다.");
    await browser.waitUntil(
      async () =>
        await browser.execute((content) => {
          const archive = document.querySelector(".memo-archive-dialog");
          return (
            archive !== null &&
            !archive.textContent?.includes(content) &&
            document.querySelector(".delete-confirm-dialog") === null
          );
        }, archivedOnly),
      { timeoutMsg: "삭제된 메모를 제외한 보관함이 유지되지 않았습니다." },
    );
  });

  it("focuses search with slash without stealing text entry", async () => {
    await setInput("#quick-item", "가상 임시 확인할 일 초안");
    await refreshApp("확인할 일 초안 복원 후 화면을 새로 열지 못했습니다.");
    expect(await browser.$("#quick-item").getValue()).toBe(
      "가상 임시 확인할 일 초안",
    );
    await setInput("#quick-item", "");
    await browser.execute(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    });
    const focused = await browser.execute(
      () => document.activeElement?.getAttribute("data-testid") ?? "",
    );
    expect(focused).toBe("people-search");

    await browser.execute(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await dispatchShortcut("n");
    await waitForText("#dialog-title", "1년 구독");
    await clickButtonByText("", "닫기");

    await dispatchShortcut("m", true);
    const quickFocused = await browser.execute(
      () => document.activeElement?.id ?? "",
    );
    expect(quickFocused).toBe("quick-item");
  });

  it("navigates distribution rows from search, confirms with Enter, and submits a memo", async () => {
    const keyboardFixture = `가상키보드${Date.now()}`;
    await registerE2ePerson(`${keyboardFixture}가`);
    await registerE2ePerson(`${keyboardFixture}나`);
    await setPersonFilterPreset("남은 배부");
    await setInput('[data-testid="people-search"]', keyboardFixture);
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('[data-testid="person-row"]').length,
        )) === 2,
      { timeoutMsg: "키보드 탐색용 신청자 두 명을 찾지 못했습니다." },
    );

    await browser.execute(() => {
      const search = document.querySelector<HTMLInputElement>(
        '[data-testid="people-search"]',
      );
      search?.focus();
      search?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="person-row"]',
            ),
          ];
          return (
            rows[0]?.getAttribute("aria-selected") === "true" &&
            document.activeElement === rows[0]
          );
        }),
      { timeoutMsg: "검색창에서 첫 신청자 행으로 이동하지 못했습니다." },
    );

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"][aria-selected="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.getAttribute("data-testid") ===
              "people-search" &&
            !document.querySelector(
              '[data-testid="person-row"][aria-selected="true"]',
            ),
        ),
      {
        timeoutMsg: "첫 신청자에서 위 방향키로 검색창으로 돌아가지 못했습니다.",
      },
    );

    await browser.execute(() => {
      const search = document.querySelector<HTMLInputElement>(
        '[data-testid="people-search"]',
      );
      search?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches('[data-testid="person-row"]') &&
            Boolean(
              document.querySelector(
                '[data-testid="person-row"][aria-selected="true"]',
              ),
            ),
        ),
      { timeoutMsg: "검색창에서 첫 신청자로 다시 이동하지 못했습니다." },
    );
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="person-row"]',
            ),
          ];
          return (
            rows[1]?.getAttribute("aria-selected") === "true" &&
            document.activeElement === rows[1]
          );
        }),
      { timeoutMsg: "아래 방향키로 다음 신청자를 선택하지 못했습니다." },
    );

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"][aria-selected="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="person-row"]',
            ),
          ];
          return (
            rows[0]?.getAttribute("aria-selected") === "true" &&
            document.activeElement === rows[0]
          );
        }),
      { timeoutMsg: "위 방향키로 이전 신청자를 선택하지 못했습니다." },
    );
    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"][aria-selected="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="person-row"]',
            ),
          ];
          return (
            rows[1]?.getAttribute("aria-selected") === "true" &&
            document.activeElement === rows[1]
          );
        }),
      { timeoutMsg: "아래 방향키로 배부 대상 신청자에게 돌아가지 못했습니다." },
    );

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"][aria-selected="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await waitForText("#dialog-title", "배부하시겠습니까?");

    await browser.keys("Escape");
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector("#dialog-title"),
        )) === null,
      { timeoutMsg: "Escape로 배부 확인창을 닫지 못했습니다." },
    );
    await browser.keys("Enter");
    await waitForText("#dialog-title", "배부하시겠습니까?");
    await browser.keys("Enter");
    await waitForText(".toast", "배부했습니다");

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.focus();
    });
    await browser.keys("ArrowRight");
    expect(await browser.execute(() => document.activeElement?.id ?? "")).toBe(
      "quick-item",
    );
    await browser.keys("ArrowLeft");
    expect(
      await browser.execute(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      ),
    ).toBe("person-row");
    await browser.keys("ArrowRight");
    expect(await browser.execute(() => document.activeElement?.id ?? "")).toBe(
      "quick-item",
    );
    await setInput("#quick-item", `키보드 메모 ${keyboardFixture}`);
    await browser.keys("Enter");
    await waitForText(".memo-list", `키보드 메모 ${keyboardFixture}`);

    await browser.execute(() => {
      const memo = document.querySelector<HTMLTextAreaElement>("#quick-item");
      memo?.focus();
    });
    await setInput("#quick-item", "첫 줄");
    expect(await browser.$("#quick-item").getValue()).toBe("첫 줄");
    await browser.$("#quick-item").click();
    const shiftEnter = await browser.execute(() => {
      const memo = document.querySelector<HTMLTextAreaElement>("#quick-item");
      if (!memo) throw new Error("메모 입력을 찾지 못했습니다.");
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      memo.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, value: memo.value };
    });
    // Shift+Enter는 textarea의 기본 줄바꿈에 맡기고 앱이 저장/초기화하지 않아야 한다.
    expect(shiftEnter).toEqual({ defaultPrevented: false, value: "첫 줄" });
  });

  it("switches to payments with Ctrl or Command from search and respects modal boundaries", async () => {
    for (const modifier of ["ctrlKey", "metaKey"] as const) {
      await browser.execute((key) => {
        const search = document.querySelector<HTMLInputElement>(
          '[data-testid="people-search"]',
        )!;
        search.focus();
        search.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "3",
            [key]: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, modifier);
      await waitForText(".payments-host.screen-visible h2", "입금 관리");
      await dispatchShortcut("1");
      await browser.waitUntil(async () =>
        browser.execute(
          () => document.querySelector(".desk.screen-visible") !== null,
        ),
      );
    }
    await browser.keys([
      process.platform === "darwin" ? "Meta" : "Control",
      "3",
    ]);
    await waitForText(".payments-host.screen-visible h2", "입금 관리");
    await dispatchShortcut("1");
    await browser.waitUntil(async () =>
      browser.execute(
        () => document.querySelector(".desk.screen-visible") !== null,
      ),
    );
    await clickButtonByText("+ 1년 구독");
    await dispatchShortcut("3");
    expect(
      await browser.execute(
        () => document.querySelector(".payments-host.screen-visible") === null,
      ),
    ).toBe(true);
    await browser.keys("Escape");
    await clickButtonByText("도움말");
    await waitForText("#help-title", "QT Manager 도움말");
    await browser.$('[data-testid="help-detailed-toggle"]').click();
    await dispatchShortcut("3");
    expect(
      await browser.execute(
        () => document.querySelector(".payments-host.screen-visible") === null,
      ),
    ).toBe(true);
    await browser.keys("Escape");
    await browser.waitUntil(async () =>
      browser.execute(() => document.querySelector("#help-title") === null),
    );
    await dispatchShortcut("3");
    await waitForText(".payments-host.screen-visible h2", "입금 관리");
  });

  it("moves through management applicants from the search field and refreshes detail", async () => {
    const keyboardFixture = `가상관리키보드${Date.now()}`;
    await registerE2ePerson(`${keyboardFixture}가`);
    await registerE2ePerson(`${keyboardFixture}나`);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await dispatchShortcut("1");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelector(".desk.screen-visible") !== null,
        ),
      {
        timeoutMsg: "Command/Ctrl+1로 현장 배부 화면으로 이동하지 못했습니다.",
      },
    );
    await dispatchShortcut("2");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector(".management-host.screen-visible") !== null,
        ),
      {
        timeoutMsg:
          "Command/Ctrl+2로 신청자 관리 화면으로 이동하지 못했습니다.",
      },
    );
    await setInput('[data-testid="management-search"]', keyboardFixture);
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelectorAll('[data-testid="management-person"]')
              .length,
        )) === 2,
      { timeoutMsg: "관리 키보드 탐색용 신청자 두 명을 찾지 못했습니다." },
    );

    await browser.execute(() => {
      const search = document.querySelector<HTMLInputElement>(
        '[data-testid="management-search"]',
      );
      search?.focus();
      search?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[0]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[0]
          );
        }),
      { timeoutMsg: "관리 검색창에서 첫 신청자를 선택하지 못했습니다." },
    );

    // A mouse-selected row must remain the keyboard anchor. This catches the
    // WebKit/Tauri case where the asynchronous detail refresh used to return
    // focus to the scroll container and let ArrowDown scroll instead.
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="management-person"][aria-pressed="true"]',
        )
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-person"][aria-pressed="true"]',
            ) ?? false,
        ),
      {
        timeoutMsg: "마우스로 선택한 신청자 행에 포커스를 유지하지 못했습니다.",
      },
    );
    await browser.keys("Escape");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const selected = document.querySelector<HTMLElement>(
            '[data-testid="management-person"][aria-pressed="true"]',
          );
          return (
            document.activeElement !== selected &&
            selected?.matches(":focus-visible") !== true &&
            selected?.matches(":focus") !== true
          );
        }),
      {
        timeoutMsg:
          "신청자 관리에서 Escape 후 선택 행에 포커스 테두리가 남았습니다.",
      },
    );
    await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="management-person"]',
        ),
      ];
      rows.at(-1)?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-person"][aria-pressed="true"]',
            ) ?? false,
        ),
      { timeoutMsg: "관리 목록의 마지막 신청자를 선택하지 못했습니다." },
    );
    await browser.keys("ArrowDown");
    await browser.keys("ArrowUp");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[0]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[0]
          );
        }),
      {
        timeoutMsg: "마지막 신청자에서 ArrowDown 후 ArrowUp 이동이 깨졌습니다.",
      },
    );
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          const last = rows.at(-1);
          return (
            last?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === last &&
            rows.filter((row) => row.getAttribute("aria-pressed") === "true")
              .length === 1
          );
        }),
      {
        timeoutMsg:
          "관리 목록 마지막 신청자에서 아래 방향키가 포커스를 잃었습니다.",
      },
    );
    await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="management-person"]',
        ),
      ];
      rows[0]?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-person"][aria-pressed="true"]',
            ) ?? false,
        ),
      {
        timeoutMsg: "관리 키보드 회귀 검증용 첫 신청자를 선택하지 못했습니다.",
      },
    );
    await browser.keys("ArrowDown");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[1]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[1] &&
            document.querySelector(".detail-empty") === null
          );
        }),
      {
        timeoutMsg:
          "마우스 선택 후 아래 방향키가 신청자 이동으로 동작하지 않았습니다.",
      },
    );
    await browser.keys("ArrowUp");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-person"][aria-pressed="true"]',
            ) ?? false,
        ),
      {
        timeoutMsg:
          "마우스 선택 후 위 방향키가 신청자 이동으로 동작하지 않았습니다.",
      },
    );
    await browser.keys("/");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-search"]',
            ) ?? false,
        ),
      {
        timeoutMsg:
          "신청자 관리 화면의 슬래시 단축키가 검색창으로 이동하지 않았습니다.",
      },
    );

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="management-person"][aria-pressed="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.getAttribute("data-testid") ===
            "management-search",
        ),
      {
        timeoutMsg:
          "관리 첫 신청자에서 위 방향키로 검색창으로 돌아가지 못했습니다.",
      },
    );

    await browser.execute(() => {
      const search = document.querySelector<HTMLInputElement>(
        '[data-testid="management-search"]',
      );
      search?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.activeElement?.matches(
              '[data-testid="management-person"]',
            ) &&
            Boolean(
              document.querySelector(
                '[data-testid="management-person"][aria-pressed="true"]',
              ),
            ),
        ),
      { timeoutMsg: "관리 검색창에서 첫 신청자로 다시 이동하지 못했습니다." },
    );

    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="management-person"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[1]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[1]
          );
        }),
      { timeoutMsg: "관리 목록에서 다음 신청자로 이동하지 못했습니다." },
    );
    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="management-person"][aria-pressed="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[0]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[0]
          );
        }),
      {
        timeoutMsg:
          "관리 목록에서 위 방향키로 이전 신청자로 이동하지 못했습니다.",
      },
    );
    await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="management-person"][aria-pressed="true"]',
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return (
            rows[1]?.getAttribute("aria-pressed") === "true" &&
            document.activeElement === rows[1]
          );
        }),
      {
        timeoutMsg:
          "관리 목록에서 아래 방향키로 다음 신청자로 돌아가지 못했습니다.",
      },
    );
    await waitForText('[data-testid="person-detail"]', `${keyboardFixture}나`);
  });

  it("keeps one action menu open, closes it outside, toggles selection and filters the list", async () => {
    const menuFixture = `가상메뉴대상${Date.now()}`;
    await registerE2ePerson(menuFixture);
    await registerE2ePerson(`${menuFixture}보조`);
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', "");
    await browser.waitUntil(async () =>
      browser.execute(
        () =>
          document.querySelectorAll('[data-testid="person-row"] .menu-trigger')
            .length >= 2,
      ),
    );
    await browser.execute(() => {
      document
        .querySelectorAll<HTMLButtonElement>(
          '[data-testid="person-row"] .menu-trigger',
        )[1]
        ?.click();
    });
    expect(
      await browser.execute(
        () => document.querySelectorAll(".menu-popover").length,
      ),
    ).toBe(1);
    const firstPersonMenu = await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="person-row"] .menu-trigger',
      );
      button?.click();
      return button?.getAttribute("aria-label") ?? "";
    });
    expect(firstPersonMenu).not.toBe("");
    expect(
      await browser.execute(
        () => document.querySelectorAll(".menu-popover").length,
      ),
    ).toBe(1);
    // Synthetic PointerEvent dispatch can hang WebKit's embedded driver. Use
    // a real WebDriver click so the same outside-click path is exercised on
    // WebKit and Edge.
    await browser.$(".table-title").click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll(".menu-popover").length,
        )) === 0,
      { timeoutMsg: "바깥 영역을 눌러 메뉴가 닫히지 않았습니다." },
    );

    const firstPersonRow = browser.$('[data-testid="person-row"]');
    // The row selection is React state. Wait for the outside-click render to
    // settle before asserting the first toggle so WebKit does not read the
    // previous aria-selected value during a rapid sequence.
    await browser.waitUntil(
      async () =>
        (await firstPersonRow.getAttribute("aria-selected")) === "false",
      { timeoutMsg: "메뉴를 닫은 뒤 신청자 행 상태가 안정되지 않았습니다." },
    );
    await firstPersonRow.click();
    await browser.waitUntil(
      async () =>
        (await firstPersonRow.getAttribute("aria-selected")) === "true",
      { timeoutMsg: "신청자 행을 선택하지 못했습니다." },
    );
    await firstPersonRow.click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector('[data-testid="person-row"]')
            ?.getAttribute("aria-selected"),
        )) === "false",
      { timeoutMsg: "신청자 행을 다시 눌러 선택을 해제하지 못했습니다." },
    );
    expect(
      await browser.execute(() =>
        document
          .querySelector('[data-testid="person-row"]')
          ?.getAttribute("aria-selected"),
      ),
    ).toBe("false");

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await waitForText('[data-testid="person-detail"]', menuFixture);
    await clickButtonByText("정보 수정");
    await waitForText("#management-dialog-title", "QT 신청자 정보 수정");
    await clickButtonByText("", "닫기");
    await clickButtonByText("현장 배부");
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await waitForText(".menu-popover", "신청자 정보 수정");
    await browser.$(".table-title").click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll(".menu-popover").length,
        )) === 0,
      { timeoutMsg: "바깥 영역을 눌러 신청자 메뉴가 닫히지 않았습니다." },
    );

    await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="person-row"]'),
      ];
      const first = rows[0];
      if (!first) throw new Error("선택 상태 검증용 신청자 행이 없습니다.");
      if (first.getAttribute("aria-selected") !== "true") first.click();
      first.focus();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="person-row"]')
            ?.getAttribute("aria-selected"),
        )) === "true",
      { timeoutMsg: "우클릭 전 신청자 선택이 반영되지 않았습니다." },
    );
    await browser.execute(() => {
      const first = document.querySelector<HTMLElement>(
        '[data-testid="person-row"]',
      );
      first?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await waitForText(".menu-popover", "메모 추가");
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll(".menu-popover").length,
        )) === 0,
      { timeoutMsg: "Escape로 신청자 메뉴가 닫히지 않았습니다." },
    );
    expect(
      await browser.execute(
        () =>
          document.activeElement?.closest<HTMLElement>(
            '[data-testid="person-row"]',
          ) === null,
      ),
    ).toBe(true);
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })),
    );
    expect(
      await browser.execute(() => {
        const rows = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="person-row"]',
          ),
        ];
        const selected = rows.findIndex((row) =>
          row.classList.contains("selected"),
        );
        const focused = rows.findIndex((row) => row === document.activeElement);
        return {
          selectedCount: rows.filter((row) =>
            row.classList.contains("selected"),
          ).length,
          selected,
          focused,
        };
      }),
    ).toEqual({ selectedCount: 1, selected: 1, focused: 1 });

    await setPersonFilters(["배부 완료", "구독 만료"]);
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="person-row"]',
            ),
          ].every(
            (row) =>
              row.textContent?.includes("배부 완료") ||
              row.textContent?.includes("구독 만료"),
          ),
        ),
      { timeoutMsg: "배부 완료 필터가 목록에 반영되지 않았습니다." },
    );
    await setInput('[data-testid="people-search"]', "가상");
    expect(
      await browser.execute(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="person-row"]',
          ),
        ].every(
          (row) =>
            row.textContent?.includes("배부 완료") ||
            row.textContent?.includes("구독 만료"),
        ),
      ),
    ).toBe(true);
    await setPersonFilterPreset("남은 배부");
    expect(await textOf(".filter-trigger")).toBe("필터 · 2개");
    expect(
      await browser.execute(
        () =>
          document.querySelector(".filter-trigger")?.getAttribute("title") ??
          "",
      ),
    ).toBe("미배부, 일부 배부");

    const sortLabelBefore = await browser.execute(
      () =>
        document
          .querySelector<HTMLButtonElement>(
            '.table-head button[aria-label^="신청자"]',
          )
          ?.getAttribute("aria-label") ?? "",
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '.table-head button[aria-label^="신청자"]',
        )
        ?.click();
    });
    const sortLabelAfter = await browser.execute(
      () =>
        document
          .querySelector<HTMLButtonElement>(
            '.table-head button[aria-label^="신청자"]',
          )
          ?.getAttribute("aria-label") ?? "",
    );
    expect(sortLabelAfter).not.toBe(sortLabelBefore);
  });

  it("opens management detail from a row menu and preserves both screen states", async () => {
    const applicant = `가상상세이동${Date.now()}`;
    await registerE2ePerson(applicant);
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', applicant);
    await waitForText('[data-testid="person-row"]', applicant);

    await browser.execute(() => {
      const list = document.querySelector<HTMLElement>(".person-list")!;
      const fixture = document.createElement("div");
      fixture.dataset.tabStateFixture = "distribution";
      fixture.style.height = `${list.clientHeight + 900}px`;
      fixture.setAttribute("aria-hidden", "true");
      list.append(fixture);
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="person-row"]')
            ?.getAttribute("aria-selected"),
        )) === "true",
      { timeoutMsg: "화면 상태 보존용 신청자 선택이 반영되지 않았습니다." },
    );
    const distributionBefore = await browser.execute(() => {
      const list = document.querySelector<HTMLElement>(".person-list")!;
      list.scrollTop = 32;
      return {
        scrollTop: list.scrollTop,
        selected: document
          .querySelector<HTMLElement>('[data-testid="person-row"]')
          ?.getAttribute("aria-selected"),
      };
    });
    expect(distributionBefore.selected).toBe("true");
    expect(distributionBefore.scrollTop).toBeGreaterThan(0);

    await clickButtonByText("", `${applicant} 메뉴`);
    await clickButtonByText("상세 정보 보기");
    await waitForText("h2", "신청자 관리");
    await waitForText('[data-testid="person-detail"]', applicant);

    const managementBefore = await browser.execute(() => {
      const detail = document.querySelector<HTMLElement>(
        '[data-testid="person-detail"]',
      )!;
      const fixture = document.createElement("div");
      fixture.dataset.tabStateFixture = "management";
      fixture.style.height = `${detail.clientHeight + 900}px`;
      fixture.setAttribute("aria-hidden", "true");
      detail.append(fixture);
      detail.scrollTop = 32;
      return detail.scrollTop;
    });
    expect(managementBefore).toBeGreaterThan(0);

    await clickButtonByText("현장 배부");
    await waitForText('[data-testid="selected-issue"]', "월호");
    const distributionAfter = await browser.execute(() => ({
      scrollTop: document.querySelector<HTMLElement>(".person-list")?.scrollTop,
      selected: document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.getAttribute("aria-selected"),
    }));
    expect(distributionAfter.scrollTop).toBe(distributionBefore.scrollTop);
    expect(distributionAfter.selected).toBe("true");

    await clickButtonByText("신청자 관리");
    await waitForText('[data-testid="person-detail"]', applicant);
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLElement>('[data-testid="person-detail"]')
            ?.scrollTop,
      ),
    ).toBe(managementBefore);

    await browser.execute(() => {
      document
        .querySelectorAll(
          '[data-tab-state-fixture="distribution"], [data-tab-state-fixture="management"]',
        )
        .forEach((fixture) => fixture.remove());
    });
  });

  it("persists theme and keeps the resizable scroll-safe four-stat layout", async () => {
    // macOS가 이전 개발 실행의 창 크기를 복원할 수 있으므로 기준 크기로 맞춘다.
    await browser.setWindowSize(2000, 1440);
    await browser.execute(() => {
      localStorage.removeItem("qt-manager-theme");
    });
    await refreshApp("새로고침 뒤 기본 테마가 적용되지 않았습니다.");
    expect(
      await browser.execute(() => document.documentElement.dataset.theme),
    ).toBe("dark");
    await browser.waitUntil(
      async () =>
        (await invokeTauri<"dark" | "light" | null>("plugin:window|theme", {
          label: "main",
        })) === "dark",
      { timeoutMsg: "네이티브 제목 표시줄 다크 테마가 적용되지 않았습니다." },
    );
    const darkScrollbar = await browser.execute(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--scroll-thumb")
        .trim(),
    );
    const darkScrollbarStyle = await browser.execute(
      () =>
        getComputedStyle(document.querySelector<HTMLElement>(".person-list")!)
          .scrollbarColor,
    );
    expect(await textOf(".info-tooltip [role='tooltip']")).toContain(
      "2026 교육국 제작",
    );
    expect(
      await browser.execute(
        () => document.querySelector("img.book-logo") !== null,
      ),
    ).toBe(true);
    const brand = await browser.execute(() => {
      const operator = document.querySelector(".rail-operator")!;
      const info = document.querySelector(".rail-info")!;
      return {
        wordmark:
          document.querySelector(".rail-wordmark")?.textContent?.trim() ?? "",
        height: Math.round(
          document
            .querySelector<HTMLElement>(".rail-brand")!
            .getBoundingClientRect().height,
        ),
        viewportHeight: window.innerHeight,
        infoAfterOperator: Boolean(
          operator.compareDocumentPosition(info) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        logoClip: getComputedStyle(
          document.querySelector<HTMLElement>(".book-logo")!,
        ).clipPath,
      };
    });
    expect(brand.wordmark).toBe("큐티매니저");
    // Compact viewports intentionally use a 76px brand to keep the rail
    // usable at the 900x640 minimum size (including hosted macOS runners).
    expect(brand.height).toBeGreaterThanOrEqual(
      brand.viewportHeight <= 680 ? 76 : 84,
    );
    expect(brand.infoAfterOperator).toBe(true);
    expect(brand.logoClip).not.toBe("none");

    const issueBefore = await issuePickerGeometry();
    await clickButtonByText("", "다음 호");
    await browser.waitUntil(
      async () => (await selectedIssue()).startMonth !== issueBefore.startMonth,
      { timeoutMsg: "다음 호로 이동하지 않았습니다." },
    );
    const issueAfter = await issuePickerGeometry();
    expect(
      Math.abs(issueAfter.yearSuffixLeft - issueBefore.yearSuffixLeft),
    ).toBeLessThan(1);
    expect(
      Math.abs(issueAfter.monthSuffixLeft - issueBefore.monthSuffixLeft),
    ).toBeLessThan(1);
    expect(
      Math.abs(issueAfter.headingCenter - issueAfter.arrowsCenter),
    ).toBeLessThan(1);
    expect(Number.parseFloat(issueAfter.gap)).toBeGreaterThan(0);
    await clickButtonByText("", "이전 호");

    const compactPanels = await panelWidths();
    await browser.setWindowSize(2400, 1440);
    const widePanels = await panelWidths();
    expect(widePanels.people).toBeGreaterThan(compactPanels.people);
    expect(widePanels.notes).toBeGreaterThan(compactPanels.notes);
    await browser.setWindowSize(2000, 1440);
    mkdirSync("test-results", { recursive: true });
    await browser.saveScreenshot("test-results/ui-dark.png");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')
        ?.click();
    });
    expect(
      await browser.execute(() => document.documentElement.dataset.theme),
    ).toBe("light");
    await browser.waitUntil(
      async () =>
        (await invokeTauri<"dark" | "light" | null>("plugin:window|theme", {
          label: "main",
        })) === "light",
      { timeoutMsg: "네이티브 제목 표시줄 라이트 테마가 적용되지 않았습니다." },
    );
    const lightScrollbar = await browser.execute(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--scroll-thumb")
        .trim(),
    );
    expect(lightScrollbar).not.toBe(darkScrollbar);
    const lightScrollbarStyle = await browser.execute(
      () =>
        getComputedStyle(document.querySelector<HTMLElement>(".person-list")!)
          .scrollbarColor,
    );
    // WebKit on hosted macOS may not expose scrollbar-color through
    // getComputedStyle even though the custom theme variable is applied.
    // Keep the native property assertion when the runtime reports it, while
    // relying on --scroll-thumb as the portable theme contract above.
    if (darkScrollbarStyle || lightScrollbarStyle) {
      expect(lightScrollbarStyle).not.toBe(darkScrollbarStyle);
    }
    expect(
      await browser.execute(
        () =>
          getComputedStyle(document.querySelector<HTMLElement>(".book-logo")!)
            .clipPath,
      ),
    ).toBe("none");
    await setInput('[data-testid="people-search"]', "일치하지않는가상검색");
    await waitForText(
      '[data-testid="empty-list"]',
      "일치하는 신청자가 없습니다",
    );
    await browser.saveScreenshot("test-results/ui-light-short-list.png");
    await setInput('[data-testid="people-search"]', "");
    await browser.saveScreenshot("test-results/ui-light.png");
    await refreshApp("새로고침 뒤 저장한 테마가 적용되지 않았습니다.");
    expect(
      await browser.execute(() => document.documentElement.dataset.theme),
    ).toBe("light");

    const layout = await browser.execute(() => {
      const stats = [
        ...document.querySelectorAll<HTMLElement>(".summary-grid > div"),
      ];
      const sizes = stats.map((item) => {
        const rect = item.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      });
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const peopleStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".person-list")!,
      );
      const memoStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".memo-list")!,
      );
      const rail = document
        .querySelector<HTMLElement>(".app-navigation")!
        .getBoundingClientRect();
      const desk = document
        .querySelector<HTMLElement>(".desk")!
        .getBoundingClientRect();
      const stickyInput = document
        .querySelector<HTMLElement>(".sticky-input")!
        .getBoundingClientRect();
      const root = getComputedStyle(document.documentElement);
      const brand = getComputedStyle(
        document.querySelector<HTMLElement>(".rail-brand")!,
      );
      const placeholderColor = root.getPropertyValue("--placeholder").trim();
      const hexAlpha = placeholderColor.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
      const percentAlpha = placeholderColor.match(/\/\s*([0-9.]+)%\)/);
      const decimalAlpha = placeholderColor.match(/,\s*([0-9.]+)\)$/);
      const placeholderAlpha = hexAlpha
        ? Number.parseInt(hexAlpha[1], 16) / 255
        : percentAlpha
          ? Number.parseFloat(percentAlpha[1]) / 100
          : decimalAlpha
            ? Number.parseFloat(decimalAlpha[1])
            : 1;
      return {
        labels: stats.map((item) => item.querySelector("span")?.textContent),
        sizes,
        summaryTextAlign: stats.map((item) => getComputedStyle(item).textAlign),
        rootOverflow: `${rootStyle.overflowX}/${rootStyle.overflowY}`,
        bodyOverflow: `${bodyStyle.overflowX}/${bodyStyle.overflowY}`,
        bodyFits:
          document.body.scrollWidth === document.body.clientWidth &&
          document.body.scrollHeight === document.body.clientHeight,
        internal: [peopleStyle.overflowY, memoStyle.overflowY],
        numericStyle: getComputedStyle(
          document.querySelector<HTMLElement>(".summary-grid")!,
        ).fontVariantNumeric,
        rail: {
          left: Math.round(rail.left),
          width: Math.round(rail.width),
          height: Math.round(rail.height),
          viewportHeight: window.innerHeight,
          activeCount: document.querySelectorAll(
            ".app-navigation [aria-current='page']",
          ).length,
        },
        deskLeft: Math.round(desk.left),
        stickyInputHeight: Math.round(stickyInput.height),
        fontMedium: root.getPropertyValue("--font-md").trim(),
        fontSmall: root.getPropertyValue("--font-sm").trim(),
        fontMeta: root.getPropertyValue("--font-meta").trim(),
        tableHeadFontSize: getComputedStyle(
          document.querySelector<HTMLElement>(".table-head")!,
        ).fontSize,
        summaryLabelFontSize: getComputedStyle(
          document.querySelector<HTMLElement>(".summary-grid span")!,
        ).fontSize,
        summaryCellPadding: getComputedStyle(
          document.querySelector<HTMLElement>(".summary-grid > div")!,
        ).padding,
        toolbarBorderBottom: getComputedStyle(
          document.querySelector<HTMLElement>(".table-toolbar")!,
        ).borderBottomStyle,
        tableHeadBorderTop: getComputedStyle(
          document.querySelector<HTMLElement>(".table-head")!,
        ).borderTopStyle,
        tableHeadBorderBottom: getComputedStyle(
          document.querySelector<HTMLElement>(".table-head")!,
        ).borderBottomStyle,
        brandGap: Number.parseFloat(brand.rowGap),
        placeholderAlpha,
        hasOperatorStatus: document.querySelector(".operator-status") !== null,
      };
    });
    expect(layout.labels).toEqual(["대상", "완료", "남음", "배부"]);
    expect(new Set(layout.sizes.map(String)).size).toBe(1);
    expect(layout.summaryTextAlign).toEqual([
      "center",
      "center",
      "center",
      "center",
    ]);
    expect(layout.rootOverflow).toBe("hidden/hidden");
    expect(layout.bodyOverflow).toBe("hidden/hidden");
    expect(layout.bodyFits).toBe(true);
    expect(layout.internal).toEqual(["auto", "auto"]);
    expect(layout.numericStyle).toContain("tabular-nums");
    expect(layout.rail).toEqual({
      left: 0,
      width: 88,
      height: layout.rail.viewportHeight,
      viewportHeight: layout.rail.viewportHeight,
      activeCount: 1,
    });
    expect(layout.deskLeft).toBe(88);
    expect(layout.stickyInputHeight).toBeLessThanOrEqual(94);
    expect(layout.fontMedium).toBe("15px");
    expect(layout.fontSmall).toBe("14px");
    expect(layout.fontMeta).toBe("13px");
    expect(layout.tableHeadFontSize).toBe("14px");
    expect(layout.summaryLabelFontSize).toBe("14px");
    expect(layout.summaryCellPadding).toBe("9px 6px 10px");
    expect(layout.toolbarBorderBottom).toBe("none");
    expect(layout.tableHeadBorderTop).toBe("none");
    expect(layout.tableHeadBorderBottom).toBe("solid");
    expect(layout.brandGap).toBeGreaterThanOrEqual(4);
    expect(layout.placeholderAlpha).toBeLessThanOrEqual(0.65);
    expect(layout.hasOperatorStatus).toBe(false);

    const windowContract = await browser.execute(async () => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
            ) => Promise<{ width: number; height: number; resizable: boolean }>;
          };
        }
      ).__TAURI_INTERNALS__;
      return internals.invoke("main_window_contract_command");
    });
    // The Tauri config declares a 1120x760 initial size (verified by the
    // project contract check), but hosted WebDriver may restore/maximize a
    // native window before the webview is attached. Assert the portable
    // runtime contract here and verify the configured values statically.
    expect(windowContract.resizable).toBe(true);
    expect(windowContract.width).toBeGreaterThanOrEqual(900);
    expect(windowContract.height).toBeGreaterThanOrEqual(640);
    // WebDriver 크기는 Retina 물리 픽셀 기준이고 Tauri 계약은 논리 픽셀 기준이다.
    await browser.setWindowSize(2200, 1560);
    const resized = await invokeTauri<{
      width: number;
      height: number;
      resizable: boolean;
    }>("main_window_contract_command");
    expect(resized.resizable).toBe(true);
    // Native WebDriver window units vary with hosted macOS Retina scaling;
    // assert the portable minimum contract while the Tauri 1120x760 defaults
    // remain covered by scripts/check_project.py.
    expect(resized.width).toBeGreaterThanOrEqual(900);
    expect(resized.height).toBeGreaterThanOrEqual(640);
    await browser.setWindowSize(1800, 1280);
    const minimumLayout = await browser.execute(() => {
      const rail = document
        .querySelector<HTMLElement>(".app-navigation")!
        .getBoundingClientRect();
      return {
        bodyFits:
          document.body.scrollWidth === document.body.clientWidth &&
          document.body.scrollHeight === document.body.clientHeight,
        railFits: rail.top === 0 && rail.bottom === window.innerHeight,
        horizontalScroll:
          document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(minimumLayout).toEqual({
      bodyFits: true,
      railFits: true,
      horizontalScroll: false,
    });
    await browser.setWindowSize(2000, 1440);
  });

  it("shows linked memos in management detail and applicant editing", async () => {
    const applicant = `가상관리메모${Date.now()}`;
    const personId = await registerE2ePerson(applicant);
    const linked = `상세 연결 메모 ${Date.now()}`;
    await invokeTauri("create_memo_command", {
      request: { personId, content: linked },
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="management-heading-help"] button',
        )
        ?.focus();
    });
    const headingTooltip = await browser.execute(() => {
      const tooltip = document.querySelector<HTMLElement>(
        '[data-testid="management-heading-help"] [role="tooltip"]',
      );
      if (!tooltip) return null;
      // Webdriver's focus handling is not consistent across the macOS WebView
      // and tauri-driver. Force the tooltip into its visible layout state so
      // this assertion measures the actual max-content sizing contract rather
      // than the driver's transient :focus-within state.
      tooltip.style.display = "block";
      const rect = tooltip.getBoundingClientRect();
      const style = getComputedStyle(tooltip);
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        whiteSpace: style.whiteSpace,
      };
    });
    expect(headingTooltip).not.toBeNull();
    expect(headingTooltip?.width).toBeGreaterThan(120);
    expect(headingTooltip?.height).toBeLessThan(120);
    expect(headingTooltip?.whiteSpace).toBe("normal");
    await setInput('[data-testid="management-search"]', applicant);
    await selectManagementPerson(applicant);
    await waitForText('[data-testid="person-detail"]', linked);
    await waitForText('[data-testid="linked-memos"]', linked);

    const inline = `상세에서 바로 추가 ${Date.now()}`;
    await setInput('[data-testid="person-memo-input"]', inline);
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="person-memo-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "메모를 저장했습니다.");
    await waitForText('[data-testid="linked-memos"]', inline);

    await browser.execute((content) => {
      const card = [
        ...document.querySelectorAll<HTMLElement>(".detail-memo-card"),
      ].find((candidate) => candidate.textContent?.includes(content));
      card?.click();
    }, linked);
    await waitForText(".memo-detail-dialog", linked);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-detail-dialog .memo-detail-actions .secondary-button",
        )
        ?.click();
    });
    await waitForText(".toast", "메모를 보관했습니다.");
    await browser.waitUntil(
      async () =>
        !(await textOf('[data-testid="linked-memos"]')).includes(linked),
      { timeoutMsg: "신청자 상세 메모 보관이 반영되지 않았습니다." },
    );

    await clickButtonByText("정보 수정");
    await waitForText('[data-testid="linked-memos-editor"]', inline);
    const editMemo = `수정창에서 추가 ${Date.now()}`;
    await setInput("textarea[aria-label='연결 메모 추가']", editMemo);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(".linked-memo-create button")
        ?.click();
    });
    await waitForText(".toast", "메모를 저장했습니다.");
    await waitForText('[data-testid="linked-memos-editor"]', editMemo);
    await browser.execute((content) => {
      const memo = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-memos-editor"] .linked-memo-content',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      memo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, editMemo);
    await waitForText(".memo-detail-dialog", editMemo);
    const editedEditMemo = `${editMemo} 수정`;
    await clickButtonByText("", "메모 본문. 눌러서 편집");
    await setInput(".memo-detail-editor", editedEditMemo);
    await clickButtonByText("저장");
    await waitForText(".toast", "메모를 수정했습니다.");
    await waitForText('[data-testid="linked-memos-editor"]', editedEditMemo);
    await browser.execute((content) => {
      const memo = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-memos-editor"] .linked-memo-content',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      memo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, editedEditMemo);
    await waitForText(".memo-detail-dialog", editedEditMemo);
    expect(
      await browser.execute(
        () => document.querySelector(".linked-memo-actions") === null,
      ),
    ).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".memo-detail-dialog button[aria-label='닫기']",
        )
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector(".memo-detail-dialog"),
        )) === null,
      { timeoutMsg: "신청자 수정창 메모 상세가 닫히지 않았습니다." },
    );
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-testid="edit-person-form"]'),
        )) === null,
      { timeoutMsg: "신청자 정보 수정창을 Escape로 닫지 못했습니다." },
    );
    await clickButtonByText("현장 배부");
    await waitForText('[data-testid="selected-issue"]', "월호");
  });

  it("orders management distribution history by QT issue when timestamps match", async () => {
    const applicant = `가상이력${Date.now()}`;
    const personId = await invokeTauri<string>("register_person_command", {
      request: {
        name: applicant,
        cohort: "00",
        phone: null,
        personNote: null,
        issueYear: 2026,
        issueMonth: 1,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });
    const detail = await invokeTauri<{
      subscriptions: { id: string }[];
    }>("load_person_detail_command", { personId });
    const subscriptionId = detail.subscriptions[0]?.id;
    if (!subscriptionId)
      throw new Error("배부 이력 fixture 구독을 찾지 못했습니다.");
    for (const issueMonth of [1, 3, 5, 7, 9]) {
      await invokeTauri("record_distribution_command", {
        request: {
          issueYear: 2026,
          issueMonth,
          subscriptionId,
          quantity: 1,
          note: null,
        },
      });
    }

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await setInput('[data-testid="management-search"]', applicant);
    await selectManagementPerson(applicant);
    await waitForText('[data-testid="person-detail"]', applicant);
    const issues = await browser.execute(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          ".distribution-history-row strong",
        ),
      ].map((row) => row.textContent?.trim() ?? ""),
    );
    expect(issues).toEqual([
      "2026년 9~10월호",
      "2026년 7~8월호",
      "2026년 5~6월호",
      "2026년 3~4월호",
      "2026년 1~2월호",
    ]);
  });

  it("refreshes incomplete on-site intakes immediately and confirms annual and one-issue payments", async () => {
    await clickButtonByText("신청자 관리");
    await waitForText('[data-testid="draft-count-filter"]', "누락");
    expect(
      await browser.execute(() => {
        const search = document
          .querySelector(".management-search")!
          .getBoundingClientRect();
        const filters = document
          .querySelector(".management-counts")!
          .getBoundingClientRect();
        const count = document
          .querySelector(".management-result-count")!
          .getBoundingClientRect();
        const list = document
          .querySelector(".management-person-list")!
          .getBoundingClientRect();
        return (
          Math.abs(search.left - filters.left) < 1 &&
          list.top - count.bottom <= 4
        );
      }),
    ).toBe(true);

    await clickButtonByText("현장 배부");
    const annual = `가상입금연간${Date.now()}`;
    const monthly = `가상입금한호${Date.now()}`;
    await clickButtonByText("+ 1년 구독");
    await setInput("input[name='name']", annual);
    await clickButtonByText("신청만 저장");
    await waitForText(
      '[data-testid="draft-cohort-error"]',
      "또래를 입력하세요.",
    );
    await setInput("input[name='cohort']", "00");
    await clickButtonByText("신청만 저장");
    await waitForText(".toast", "1년 구독 신청을 저장했습니다");
    await clickButtonByText("신청자 관리");
    await waitForText('[data-testid="draft-count-filter"]', "누락");
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="draft-count-filter"]')
        ?.click(),
    );
    expect(await textOf('[data-testid="management-person"]')).not.toContain(
      annual,
    );
    await clickButtonByText("현장 배부");
    await clickButtonByText("+ 1달 구독");
    await setInput("input[name='buyerName']", monthly);
    await waitForText(".purchase-new-person-fields", "또래 (선택)");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await clickButtonByText("신청자 관리");
    await browser.waitUntil(async () =>
      browser.execute(
        (name) =>
          Array.from(
            document.querySelectorAll('[data-testid="management-person"]'),
          ).some((row) => row.textContent?.includes(name)),
        monthly,
      ),
    );
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="payment-count-filter"]') ===
          null,
      ),
    ).toBe(true);
    await clickButtonByText("입금 관리");
    await waitForText(".payments-host.screen-visible h2", "입금 관리");
    await waitForText('[data-testid="payment-queue"]', annual);
    await waitForText('[data-testid="payment-queue"]', monthly);
    await setInput('[data-testid="payment-search"]', monthly);
    expect(await textOf('[data-testid="payment-queue"]')).not.toContain(annual);
    await clickButtonByText("신청자 관리");
    await clickButtonByText("입금 관리");
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLInputElement>(
            '[data-testid="payment-search"]',
          )?.value,
      ),
    ).toBe(monthly);
    await setInput('[data-testid="payment-search"]', "");
    await browser.execute((name) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="payment-row"]'),
      ).find((row) => row.textContent?.includes(name));
      row?.querySelector<HTMLButtonElement>(".text-button")?.click();
    }, annual);
    await waitForText(
      ".management-host.screen-visible .person-detail-panel",
      annual,
    );
    await clickButtonByText("입금 관리");
    await waitForText('[data-testid="payment-queue"]', monthly);
    await browser.execute(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", bubbles: true }),
      );
    });
    expect(
      await browser.execute(() =>
        document.activeElement?.getAttribute("data-testid"),
      ),
    ).toBe("payment-search");
    await browser.setWindowSize(1800, 1280);
    const paymentControlsFit = await browser.execute(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="confirm-payment"]',
        ),
      );
      return buttons.every(
        (button) =>
          getComputedStyle(button).whiteSpace === "nowrap" &&
          button.scrollWidth <= button.clientWidth,
      );
    });
    expect(paymentControlsFit).toBe(true);
    expect(
      await browser.execute(() => {
        const queue = document.querySelector('[data-testid="payment-queue"]');
        return (
          queue?.getAttribute("data-mode") === "pending" &&
          queue
            .querySelector('[data-testid="confirm-payment"]')
            ?.classList.contains("primary-button")
        );
      }),
    ).toBe(true);
    await browser.saveScreenshot("test-results/payment-queue.png");
    await clickButtonByText("도움말");
    await browser.$('[data-testid="help-detailed-toggle"]').click();
    await browser.waitUntil(async () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="help-nav-payments"]')
            ?.getAttribute("aria-current") === "location",
      ),
    );
    await waitForText('[data-testid="help-payments"]', "선택 입금 확인");
    await browser.keys("Escape");
    await browser.waitUntil(async () =>
      browser.execute(() => document.querySelector("#help-title") === null),
    );
    await browser.setWindowSize(2000, 1440);
    await browser.execute((name) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="payment-row"]'),
      ).find((row) => row.textContent?.includes(name));
      row
        ?.querySelector<HTMLButtonElement>('[data-testid="confirm-payment"]')
        ?.click();
    }, annual);
    await waitForText('[data-testid="payment-queue"] h3', "1건");
    await browser.execute(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    await waitForText('[data-testid="payment-queue"] h3', "2건");
    await browser.execute(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await waitForText('[data-testid="payment-queue"] h3', "1건");
    expect(await textOf('[data-testid="payment-queue"]')).not.toContain(annual);
    const headerGeometry = async () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll(".payment-queue th")).map(
          (cell) => {
            const rect = cell.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              font: getComputedStyle(cell).fontSize,
            };
          },
        ),
      );
    const rowHeight = async () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="payment-row"]')!
            .getBoundingClientRect().height,
      );
    const pendingRowHeight = await rowHeight();
    expect(
      await browser.execute(() => {
        const name = document.querySelector(".payment-person-link")!;
        const cell = document.querySelector(
          ".payment-queue tbody td:nth-child(3)",
        )!;
        return getComputedStyle(name).color === getComputedStyle(cell).color;
      }),
    ).toBe(true);
    const pendingGeometry = await headerGeometry();
    await clickButtonByText("확인한 내역 보기");
    await waitForText('[data-testid="payment-queue"]', annual);
    expect(await headerGeometry()).toEqual(pendingGeometry);
    expect(await rowHeight()).toBe(pendingRowHeight);
    for (const width of [900, 1120]) {
      await browser.setWindowSize(width, 760);
      const historyGeometry = await headerGeometry();
      await clickButtonByText("확인 대기 보기");
      expect(await headerGeometry()).toEqual(historyGeometry);
      expect(
        await browser.execute(() => {
          const checkbox = document.querySelector<HTMLInputElement>(
            ".payment-queue th input",
          )!;
          return (
            checkbox.getBoundingClientRect().width >= 20 &&
            checkbox.getBoundingClientRect().height >= 20
          );
        }),
      ).toBe(true);
      await clickButtonByText("확인한 내역 보기");
      expect(await headerGeometry()).toEqual(historyGeometry);
    }
    await browser.setWindowSize(2000, 1440);
    expect(
      await browser.execute(() => {
        const queue = document.querySelector('[data-testid="payment-queue"]');
        return (
          queue?.getAttribute("data-mode") === "history" &&
          queue.querySelector(".payment-return") !== null &&
          queue
            .querySelector('[data-testid="confirm-payment"]')
            ?.classList.contains("payment-cancel")
        );
      }),
    ).toBe(true);
    expect(
      await browser.execute(() => {
        const button = document.querySelector<HTMLElement>(".payment-return")!;
        return (
          button.scrollHeight <= button.clientHeight &&
          button.scrollWidth <= button.clientWidth
        );
      }),
    ).toBe(true);
    await browser.saveScreenshot("test-results/payment-history.png");
    await clickButtonByText("확인 취소");
    await waitForText('[data-testid="payment-queue"] h3', "0건");
    await clickButtonByText("확인 대기 보기");
    await waitForText('[data-testid="payment-queue"] h3', "2건");
    await browser.execute(() =>
      document
        .querySelector<HTMLInputElement>(
          '[aria-label="보이는 입금 건 모두 선택"]',
        )
        ?.click(),
    );
    await clickButtonByText("선택 입금 확인");
    await waitForText(
      '[data-testid="payment-queue"]',
      "입금 확인이 필요한 신청이 없습니다.",
    );
    await waitForText('[data-testid="payment-queue"] h3', "0건");
    const people = await invokeTauri<{
      people: { id: string; name: string }[];
    }>("load_people_management_command", {
      query: monthly,
      includeArchived: true,
    });
    await invokeTauri("set_person_archived_command", {
      personId: people.people[0].id,
      archived: true,
    });
    await clickButtonByText("현장 배부");
    await clickButtonByText("신청자 관리");
    await browser.execute(() =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="archived-count-filter"]',
        )
        ?.click(),
    );
    await browser.waitUntil(async () =>
      browser.execute(
        (name) =>
          Array.from(
            document.querySelectorAll('[data-testid="management-person"]'),
          ).some((row) => row.textContent?.includes(name)),
        monthly,
      ),
    );
    expect(await textOf(".management-person-list")).not.toContain(annual);
    await clickButtonByText("입금 관리");
    await clickButtonByText("확인한 내역 보기");
    await waitForText('[data-testid="payment-queue"]', monthly);
    await browser.execute((name) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="payment-row"]'),
      ).find((row) => row.textContent?.includes(name));
      row?.querySelector<HTMLButtonElement>(".text-button")?.click();
    }, monthly);
    await waitForText(
      ".management-host.screen-visible .person-detail-panel",
      monthly,
    );
    expect(
      await browser.execute(() =>
        document
          .querySelector('[data-testid="archived-count-filter"]')
          ?.getAttribute("aria-pressed"),
      ),
    ).toBe("true");
  });

  it("records group quantities, searches memos, and shows the complete statistic at minimum width", async () => {
    await invokeTauri("seed_e2e_group_command");
    await refreshApp("군지체 fixture를 표시하지 못했습니다.");
    await configureOperatorIfNeeded();
    await setPersonFilterPreset("남은 배부");
    await waitForText('[data-testid="person-row"]', "군지체");
    await waitForText(".table-title h2", "남은 신청자 0");
    expect(await textOf(".table-title h2")).not.toContain("군지체");
    expect(
      await browser.execute(() => ({
        remaining: document
          .querySelector(".summary-grid")
          ?.children[2]?.textContent?.replace(/\s/g, ""),
        listed: document.querySelector(".table-title h2 b")?.textContent,
      })),
    ).toEqual({ remaining: "남음0명", listed: "0" });
    await clickButtonByText("권수 입력");
    await setInput("input[name='quantity']", "7");
    await clickButtonByText("배부 기록");
    await waitForText('[data-testid="person-row"]', "7권 배부");
    await clickButtonByText("권수 입력");
    await setInput("input[name='quantity']", "13");
    await clickButtonByText("배부 기록");
    await waitForText('[data-testid="person-row"]', "20권 배부");
    await clickButtonByText("", "마지막 동작 되돌리기");
    await waitForText('[data-testid="person-row"]', "7권 배부");
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText('[data-testid="person-row"]', "20권 배부");
    await setInput("#quick-item", "가상 검색 메모 하나");
    await clickButtonByText("추가");
    await waitForText(".memo-list", "가상 검색 메모 하나");
    await setInput("#quick-item", "다른 참고 기록");
    await clickButtonByText("추가");
    await waitForText(".memo-list", "다른 참고 기록");
    await setInput('[data-testid="memo-search"]', "검색메모");
    await waitForText(".memo-list", "가상 검색 메모 하나");
    expect(await textOf(".memo-list")).not.toContain("다른 참고 기록");
    await browser.setWindowSize(1800, 1280);
    const statistics = await browser.execute(() => {
      const value = document.querySelector<HTMLElement>(
        ".summary-grid > div:last-child b",
      )!;
      value.textContent = "30/119권";
      const style = getComputedStyle(value);
      return {
        text: value.textContent,
        fits: value.scrollWidth <= value.clientWidth,
        ellipsis: style.textOverflow === "ellipsis",
      };
    });
    expect(statistics).toEqual({
      text: "30/119권",
      fits: true,
      ellipsis: false,
    });
    const memoSearchFits = await browser.execute(() => {
      const search = document.querySelector<HTMLElement>(".memo-search")!;
      const list = document.querySelector<HTMLElement>(".memo-list")!;
      return (
        search.clientHeight <= 40 && list.clientHeight > search.clientHeight
      );
    });
    expect(memoSearchFits).toBe(true);
    await browser.saveScreenshot("test-results/group-minimum.png");
    await clickButtonByText("신청자 관리");
    await waitForText('[data-testid="draft-count-filter"]', "누락");
    await clickButtonByText("입금 관리");
    await waitForText(
      '[data-testid="payment-queue"]',
      "입금 확인이 필요한 신청이 없습니다.",
    );
    await browser.setWindowSize(2000, 1440);
  });

  it("filters and names applicants that need profile completion", async () => {
    const draftName = `가상보완대상${Date.now()}`;
    await clickButtonByText("+ 1달 구독");
    await setInput('[data-testid="purchase-person-search"]', draftName);
    await waitForText(".purchase-new-person-fields", "또래 (선택)");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await setInput('[data-testid="management-search"]', draftName);
    await waitForText('[data-testid="management-person"]', draftName);
    await waitForText('[data-testid="draft-count-filter"]', "누락");
    const countLabel = await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="draft-count-filter"]',
      );
      return {
        ariaLabel: button?.getAttribute("aria-label") ?? "",
        title: button?.title ?? "",
      };
    });
    expect(countLabel.ariaLabel).toContain(draftName);
    expect(countLabel.title).toContain(draftName);
    await browser.setWindowSize(1800, 1280);
    const filtersAlign = await browser.execute(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(".management-filters > button"),
      );
      const rects = buttons.map((button) => button.getBoundingClientRect());
      const labels = buttons.map((button) => button.textContent?.trim());
      return (
        buttons.length === 3 &&
        labels.join("/") === "전체/누락/보관" &&
        rects.every(
          (rect, index) =>
            rect.width <= 80 &&
            Math.abs(rect.top - rects[0].top) < 1 &&
            (!index ||
              (rect.left >= rects[index - 1].right &&
                rect.left - rects[index - 1].right <= 3)),
        ) &&
        buttons.every((button) => !button.querySelector(".filter-count")) &&
        buttons.every((button) => button.scrollWidth <= button.clientWidth)
      );
    });
    expect(filtersAlign).toBe(true);
    expect(await textOf('[data-testid="archived-count-filter"]')).not.toContain(
      "만 보기",
    );
    await browser.saveScreenshot("test-results/management-filters-minimum.png");
    await browser.setWindowSize(2000, 1440);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="draft-count-filter"]')
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        await browser.execute((name) => {
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="management-person"]',
            ),
          ];
          return rows.length === 1 && rows[0]?.textContent?.includes(name);
        }, draftName),
      { timeoutMsg: "정보 보완 필요 신청자 필터가 적용되지 않았습니다." },
    );
  });

  it("previews pasted Google responses, links a duplicate candidate and blocks a repeat", async () => {
    const unique = String(Date.now()).slice(-8);
    const applicant = `가상붙여넣기${unique}`;
    const phone = `010-${unique.slice(0, 4)}-${unique.slice(4)}`;
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-application-import"]',
        )
        ?.click();
    });
    await setInput('[data-testid="application-paste-input"]', "셀1");
    await browser.execute(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="application-paste-input"]',
      );
      if (!textarea) throw new Error("붙여넣은 행 입력란을 찾지 못했습니다.");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelector<HTMLTextAreaElement>(
              '[data-testid="application-paste-input"]',
            )?.value ?? "",
        )) === "셀1\t",
      { timeoutMsg: "붙여넣은 행 입력란에 탭 문자를 넣지 못했습니다." },
    );
    const firstResponse = [
      `2026. 2. 1 오후 7:48:08\t${applicant}\t00\t${phone}\t1-2월호\t2\t네 입금했습니다.`,
      "가상오류\t0\t전화번호\t2월호\t0",
    ].join("\n");
    await setInput('[data-testid="application-paste-input"]', firstResponse);
    await waitForText('[data-testid="application-preview"]', applicant);
    await waitForText('[data-testid="application-preview"]', "또래는");
    const importLayout = await browser.execute(() => {
      const summary = document.querySelector<HTMLElement>(".import-summary");
      const description = document.querySelector<HTMLElement>(
        ".import-description",
      );
      return {
        summaryColumns: summary
          ? getComputedStyle(summary).gridTemplateColumns.split(" ").length
          : 0,
        summaryCardCount: summary?.children.length ?? 0,
        descriptionLines:
          description?.querySelectorAll(":scope > span").length ?? 0,
        paymentNotice:
          document.querySelector(".payment-notice")?.textContent ?? "",
        paymentNoticeStyle: (() => {
          const notice = document.querySelector<HTMLElement>(".payment-notice");
          if (!notice) return null;
          const style = getComputedStyle(notice);
          return {
            marginTop: style.marginTop,
            padding: style.padding,
            borderRadius: style.borderRadius,
          };
        })(),
      };
    });
    expect(importLayout).toEqual({
      summaryColumns: 3,
      summaryCardCount: 3,
      descriptionLines: 2,
      paymentNotice:
        "마지막 안내 확인 응답은 가져오기에서 제외하며 입금 완료로 해석하지 않습니다.",
      paymentNoticeStyle: {
        marginTop: "8px",
        padding: "8px 10px",
        borderRadius: "7px",
      },
    });
    await browser.execute(() => {
      const checkbox = document.querySelector<HTMLInputElement>(
        'input[aria-label="1행 선택"]',
      );
      if (checkbox && !checkbox.checked) checkbox.click();
    });
    await waitForEnabled('[data-testid="import-applications"]');
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="import-applications"]')
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        Boolean((await textOf(".toast")) || (await textOf(".form-error"))),
      { timeoutMsg: "스프레드시트 추가 결과가 표시되지 않았습니다." },
    );
    const importFeedback =
      (await textOf(".toast")) || (await textOf(".form-error"));
    expect(importFeedback).toContain("1건을 추가했습니다");

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-application-import"]',
        )
        ?.click();
    });
    const secondResponse = `2027. 7. 1 오전 9:00:00\t${applicant}\t00\t${phone.replaceAll("-", "")}\t7-8월호\t1`;
    await setInput('[data-testid="application-paste-input"]', secondResponse);
    await waitForText(
      '[data-testid="application-preview"]',
      "기존 신청자 후보",
    );
    await setSelect(
      '[data-testid="candidate-decision-1"]',
      await firstOptionValue('[data-testid="candidate-decision-1"]'),
    );
    await clickButtonByText("선택한 1건 추가");
    await waitForText(".toast", "기존 연결 1명");

    await setInput('[data-testid="management-search"]', applicant);
    await waitForText('[data-testid="person-detail"]', "구독 이력 2건");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-application-import"]',
        )
        ?.click();
    });
    await setInput('[data-testid="application-paste-input"]', secondResponse);
    await waitForText('[data-testid="application-preview"]', "이미 추가한 행");
    await clickButtonByText("", "닫기");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-application-import"]',
        )
        ?.click();
    });
    await setInput(
      '[data-testid="application-paste-input"]',
      "시각\t이름\t또래\t연락처\t시작\t수량\t입금\t추가열",
    );
    await waitForText("#application-import-title", "스프레드시트 붙여넣기");
    await waitForText(
      "#mapping-panel-title",
      "열 순서를 자동으로 찾지 못했습니다.",
    );
    const mappingLayout = await browser.execute(() => {
      const fields = document.querySelector<HTMLElement>(".mapping-fields");
      return {
        columns: fields
          ? getComputedStyle(fields).gridTemplateColumns.split(" ").length
          : 0,
        labels: fields?.querySelectorAll("label").length ?? 0,
      };
    });
    expect(mappingLayout).toEqual({ columns: 3, labels: 6 });
    await clickButtonByText("", "닫기");
    await clickButtonByText("현장 배부");
  });

  it("exports, replaces, restores and rejects a damaged handover workbook", async () => {
    // Use native WebDriver clicks: DOM .click() has detail=0 and missed the
    // global IME handler cancelling radio/checkbox/label activation.
    await browser.execute(() => {
      const probe = document.createElement("div");
      probe.dataset.testid = "native-control-probe";
      probe.innerHTML = `<label data-testid="native-radio-label"><input type="radio" name="native-radio">교체 선택</label>
        <label data-testid="native-checkbox-label"><input type="checkbox">선택</label>
        <button type="button" data-testid="native-button"><span>실행</span></button>
        <button type="button" disabled data-testid="native-disabled">비활성</button>`;
      const button = probe.querySelector<HTMLButtonElement>(
        '[data-testid="native-button"]',
      )!;
      button.dataset.count = "0";
      button.addEventListener("click", () => {
        button.dataset.count = String(Number(button.dataset.count) + 1);
      });
      Object.assign(probe.style, {
        position: "fixed",
        top: "80px",
        left: "150px",
        zIndex: "9999",
        background: "white",
        color: "black",
        padding: "12px",
      });
      document.body.append(probe);
    });
    try {
      await browser.$('[data-testid="native-radio-label"]').click();
      expect(
        await browser
          .$('[data-testid="native-radio-label"] input')
          .isSelected(),
      ).toBe(true);
      await browser.$('[data-testid="native-checkbox-label"]').click();
      expect(
        await browser
          .$('[data-testid="native-checkbox-label"] input')
          .isSelected(),
      ).toBe(true);
      await browser.$('[data-testid="native-checkbox-label"] input').click();
      expect(
        await browser
          .$('[data-testid="native-checkbox-label"] input')
          .isSelected(),
      ).toBe(false);
      await browser.$('[data-testid="native-button"] span').click();
      expect(
        await browser
          .$('[data-testid="native-button"]')
          .getAttribute("data-count"),
      ).toBe("1");
      expect(
        await browser.$('[data-testid="native-disabled"]').isEnabled(),
      ).toBe(false);
    } finally {
      await browser.execute(() =>
        document
          .querySelector('[data-testid="native-control-probe"]')
          ?.remove(),
      );
    }
    await registerE2ePerson(`가상인수기준${Date.now()}`);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-handover"]')
        ?.click();
    });
    await waitForText("#handover-title", "데이터 백업·복원");
    await waitForText(
      '[data-testid="privacy-warning"]',
      "파일은 암호화되지 않습니다",
    );
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="export-state"]') !== null &&
          document.querySelector('[data-testid="choose-state-import"]') !==
            null,
      ),
    ).toBe(true);
    mkdirSync("test-results", { recursive: true });
    await browser.saveScreenshot("test-results/ui-handover.png");
    await clickButtonByText("", "닫기");

    const paths = await invokeTauri<{
      exportPath: string;
      corruptPath: string;
    }>("state_transfer_e2e_paths_command");
    const exported = await invokeTauri<{
      people: number;
      subscriptions: number;
    }>("export_state_command", { path: paths.exportPath });
    expect(exported.people).toBeGreaterThan(0);
    const preview = await invokeTauri<{
      formatVersion: number;
      counts: { people: number };
    }>("preview_state_import_command", { path: paths.exportPath });
    expect(preview.formatVersion).toBe(4);
    expect(preview.counts.people).toBe(exported.people);

    const unique = `가상인수인계${Date.now()}`;
    await invokeTauri<string>("register_person_command", {
      request: {
        name: unique,
        cohort: "00",
        phone: "010-0000-9753",
        personNote: null,
        issueYear: 2026,
        issueMonth: 7,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });
    let management = await invokeTauri<{ people: { name: string }[] }>(
      "load_people_management_command",
      { query: unique, includeArchived: true },
    );
    expect(management.people.some((person) => person.name === unique)).toBe(
      true,
    );

    await invokeTauri("apply_state_import_command", {
      sourcePath: paths.exportPath,
      sourceFileName: "handover.xlsx",
      mode: "replace",
      personResolutions: [],
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-handover"]')
        ?.click();
    });
    await waitForText("#handover-title", "데이터 백업·복원");
    await waitForEnabled('[data-testid="undo-state-import"]');
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="undo-state-import"]')
        ?.click();
    });
    await waitForText('[data-testid="restore-confirm"]', "복원하기 전 확인");
    await waitForText(
      '[data-testid="restore-confirm"]',
      "현재 상태를 가져오기 직전으로 바꾸겠습니까?",
    );
    await clickButtonByText("취소");
    await clickButtonByText("", "닫기");
    management = await invokeTauri("load_people_management_command", {
      query: unique,
      includeArchived: true,
    });
    expect(management.people).toHaveLength(0);

    const restore = await invokeTauri<{
      sourceFileName: string;
      snapshotPath: string;
    }>("latest_restore_point_command");
    expect(restore.sourceFileName).toBe("handover.xlsx");
    expect(dirname(restore.snapshotPath)).toBe(
      join(dirname(dirname(paths.exportPath)), "phase2-e2e", "restore-points"),
    );
    await invokeTauri("undo_state_import_command");
    management = await invokeTauri("load_people_management_command", {
      query: unique,
      includeArchived: true,
    });
    expect(management.people.some((person) => person.name === unique)).toBe(
      true,
    );

    const damagedError = await browser.execute(async (path) => {
      try {
        await (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (
                command: string,
                args?: Record<string, unknown>,
              ) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__.invoke("preview_state_import_command", { path });
        return "";
      } catch (reason) {
        return String(reason);
      }
    }, paths.corruptPath);
    expect(damagedError).toContain("XLSX");
    management = await invokeTauri("load_people_management_command", {
      query: unique,
      includeArchived: true,
    });
    expect(management.people.some((person) => person.name === unique)).toBe(
      true,
    );
  });
  it("uses all six filters by default and accepts checkbox and label activation plus search shortcuts", async () => {
    const current = await selectedIssue();
    await registerE2ePerson("가상원");
    const future = shiftIssue(current, 1);
    await invokeTauri("register_person_command", {
      request: {
        name: "가상예정",
        cohort: "00",
        phone: null,
        personNote: null,
        issueYear: future.year,
        issueMonth: future.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });
    await invokeTauri("record_purchase_for_new_person_command", {
      request: {
        name: "가상단건",
        cohort: null,
        cohortNotApplicable: true,
        phone: null,
        issueYear: current.year,
        issueMonth: current.startMonth,
        quantity: 1,
        note: null,
      },
    });
    await refreshApp("전체 필터 기본값을 확인할 화면이 준비되지 않았습니다.");
    await waitForText(".filter-trigger", "필터 · 6개");
    if (nativeVisualEnabled)
      await captureMacOsCompositor("test-results/native-all-filters.png");
    await waitForText(".person-list", "가상예정");
    await waitForText(".person-list", "가상단건");
    await browser.$(".filter-trigger").click();
    const labels = await browser.$$(".filter-popover > label");
    expect(labels).toHaveLength(6);
    for (const label of labels)
      expect(await label.$("input").isSelected()).toBe(true);
    const scheduled = labels[4];
    await scheduled.$("span").click();
    expect(await scheduled.$("input").isSelected()).toBe(false);
    expect(await browser.$(".filter-popover").isDisplayed()).toBe(true);
    await browser.waitUntil(
      async () => !(await textOf(".person-list")).includes("가상예정"),
    );
    await scheduled.$("input").click();
    expect(await scheduled.$("input").isSelected()).toBe(true);
    // Embedded WebDriver 1.2 dispatches untrusted keyboard events and does
    // not implement the browser's checkbox Space default. Label/input activation
    // is exercised above; native Space belongs to the OS installation checklist.
    await browser.keys("Escape");
    await setPersonFilterPreset("전체");
    await setInput('[data-testid="people-search"]', "가상워");
    await waitForText('[data-testid="person-row"]', "가상원");
    await browser.$('[data-testid="people-search"]').click();
    await browser.keys("Escape");
    expect(await browser.$('[data-testid="people-search"]').getValue()).toBe(
      "",
    );
    await setInput('[data-testid="people-search"]', "가상");
    await browser.$('[data-testid="person-row"]').click();
    await browser.keys("/");
    expect(
      await browser.execute(() => {
        const input = document.querySelector<HTMLInputElement>(
          '[data-testid="people-search"]',
        )!;
        return (
          document.activeElement === input &&
          input.selectionStart === 0 &&
          input.selectionEnd === input.value.length
        );
      }),
    ).toBe(true);
  });

  it("registers and distributes with Enter, exempts a cohort and corrects a subscription without rewriting delivery", async () => {
    const name = `가상신청배부${Date.now()}`;
    await browser.$('[data-testid="open-draft"]').click();
    await setInput('input[name="name"]', name);
    await browser.waitUntil(async () =>
      browser.$(".cohort-exemption input").isExisting(),
    );
    await setInput('input[name="cohort"]', "94");
    await browser.$(".cohort-exemption input").click();
    expect(await browser.$('input[name="cohort"]').getValue()).toBe("");
    expect(await browser.$('input[name="cohort"]').isEnabled()).toBe(false);
    await browser.$(".cohort-exemption input").click();
    expect(await browser.$('input[name="cohort"]').getValue()).toBe("");
    expect(await browser.$('input[name="cohort"]').isEnabled()).toBe(true);
    await browser.$(".cohort-exemption input").click();
    expect(
      await browser.execute(() => {
        const year = document
          .querySelector('[data-testid="annual-start-year"]')!
          .getBoundingClientRect();
        const month = document
          .querySelector('[data-testid="annual-start-month"]')!
          .getBoundingClientRect();
        return (
          Math.abs(year.height - month.height) < 1 &&
          Math.abs(year.top - month.top) < 1
        );
      }),
    ).toBe(true);
    await setInput('input[name="note"]', "보존할 구독 메모");
    const quantity = await browser.$('input[name="quantity"]');
    await quantity.setValue("2");
    await quantity.click();
    expect(
      await browser.execute(() => document.activeElement?.getAttribute("name")),
    ).toBe("quantity");
    await browser.keys("Enter");
    try {
      await waitForText(".toast", "신청과 배부");
    } catch (reason) {
      const state = await browser.execute(() => ({
        focus: document.activeElement?.getAttribute("name"),
        dialog: document.querySelector('[data-testid="draft-form"]')
          ?.textContent,
        toast: document.querySelector(".toast")?.textContent,
        fields: [
          ...document.querySelectorAll<HTMLInputElement>(
            '[data-testid="draft-form"] input',
          ),
        ].map((input) => ({
          name: input.name,
          value: input.value,
          checked: input.checked,
          disabled: input.disabled,
        })),
      }));
      throw new Error(
        `${String(reason)} — 익명 E2E 상태: ${JSON.stringify(state)}`,
      );
    }
    const management = await invokeTauri<{
      people: { id: string; name: string; status: string }[];
    }>("load_people_management_command", {
      query: name,
      includeArchived: true,
    });
    expect(management.people).toHaveLength(1);
    const id = management.people[0].id;
    expect(management.people[0].status).toBe("정식 등록");
    let detail = await invokeTauri<{
      cohortNotApplicable: boolean;
      subscriptions: {
        id: string;
        quantity: number;
        appliedAt: string | null;
        memo: string | null;
      }[];
      distributions: { quantity: number }[];
    }>("load_person_detail_command", { personId: id });
    expect(detail.cohortNotApplicable).toBe(true);
    const originalDate = detail.subscriptions[0].appliedAt;
    expect(detail.subscriptions[0].memo).toBe("보존할 구독 메모");
    expect(detail.subscriptions).toHaveLength(1);
    expect(detail.distributions).toHaveLength(1);
    expect(detail.distributions[0].quantity).toBe(2);
    await clickButtonByText("신청자 관리");
    await selectManagementPerson(name);
    expect(
      await browser.execute(() => {
        const actions = document.querySelector(".subscription-actions")!;
        const state = actions
          .querySelector(".subscription-state")!
          .getBoundingClientRect();
        const pencil = actions
          .querySelector(".edit-pencil")!
          .getBoundingClientRect();
        return pencil.left >= state.right + 4;
      }),
    ).toBe(true);
    await browser.$('button[aria-label="1년 구독 수정"]').click();
    expect(
      await browser
        .$('[data-testid="subscription-correction-form"] input[name="date"]')
        .isExisting(),
    ).toBe(false);
    expect(
      await browser
        .$('[data-testid="subscription-correction-form"] input[name="note"]')
        .isExisting(),
    ).toBe(false);
    await browser
      .$('[data-testid="subscription-correction-form"] input[name="quantity"]')
      .setValue("1");
    await browser
      .$('[data-testid="subscription-correction-form"] button[type="submit"]')
      .click();
    await waitForText('[data-testid="correction-conflicts"]', "실제 2권");
    await browser.$('[data-testid="correction-conflicts"] input').click();
    await browser
      .$('[data-testid="subscription-correction-form"] button[type="submit"]')
      .click();
    await waitForText(".toast", "구독 이력을 정정");
    detail = await invokeTauri("load_person_detail_command", { personId: id });
    expect(detail.subscriptions[0].quantity).toBe(1);
    expect(detail.subscriptions[0].appliedAt).toBe(originalDate);
    expect(detail.subscriptions[0].memo).toBe("보존할 구독 메모");
    expect(detail.distributions).toHaveLength(1);
    expect(detail.distributions[0].quantity).toBe(2);
    await waitForText('[data-testid="person-detail"]', "실제 2권");
    await clickButtonByText("도움말");
    // Embedded WebDriver 1.2 uses offsetParent for visibility, which does not
    // reliably describe content in fixed WebKit panels. Check rendered geometry
    // and ancestor styles, including the panel's entry animation, instead.
    await waitForHelpVisibility('[data-testid="help-brief"]');
    expect(
      await browser.$('[data-testid="brief-distribution"]').isExisting(),
    ).toBe(true);
    expect(await browser.$('[data-testid="brief-transfer"]').isExisting()).toBe(
      true,
    );
    expect(
      await browser.$('[data-testid="brief-shortcuts"]').isExisting(),
    ).toBe(true);
    expect((await helpVisibility('[data-testid="help-search"]')).visible).toBe(
      false,
    );
    await browser.$('[data-testid="help-detailed-toggle"]').click();
    await waitForHelpVisibility('[data-testid="help-search"]');
    expect(
      await browser.execute(() => {
        const title = document
          .querySelector("#help-title")!
          .getBoundingClientRect();
        const mode = document
          .querySelector(".help-mode")!
          .getBoundingClientRect();
        const search = document
          .querySelector('[data-testid="help-search"]')!
          .getBoundingClientRect();
        return (
          title.right <= mode.left &&
          mode.right <= search.left &&
          Math.abs(
            title.top + title.height / 2 - search.top - search.height / 2,
          ) < 1
        );
      }),
    ).toBe(true);
    await browser.keys("Escape");
  });

  it("corrects one-issue purchases through the pencil and preserves original and payment history", async () => {
    const name = `가상단건정정${Date.now()}`;
    const issue = await selectedIssue();
    const personId = await invokeTauri<string>(
      "record_purchase_for_new_person_command",
      {
        request: {
          name,
          cohort: null,
          cohortNotApplicable: true,
          phone: null,
          issueYear: issue.year,
          issueMonth: issue.startMonth,
          quantity: 1,
          note: null,
        },
      },
    );
    await refreshApp("정정할 단건 신청자를 불러오지 못했습니다.");
    await clickButtonByText("신청자 관리");
    await selectManagementPerson(name);
    await browser.$('button[aria-label="1달 구독 수정"]').click();
    await browser
      .$('[data-testid="subscription-correction-form"] input[name="quantity"]')
      .setValue("3");
    await browser
      .$('[data-testid="subscription-correction-form"] button[type="submit"]')
      .click();
    await waitForText(".toast", "구독 이력을 정정");
    const detail = await invokeTauri<{
      purchases: {
        id: string;
        quantity: number;
        cancelled: boolean;
        reversed: boolean;
        correctionOf: string | null;
      }[];
    }>("load_person_detail_command", { personId });
    expect(detail.purchases).toHaveLength(3);
    const active = detail.purchases.filter((p) => !p.cancelled && !p.reversed);
    expect(active).toHaveLength(1);
    expect(active[0].quantity).toBe(3);
    expect(Boolean(active[0].correctionOf)).toBe(true);
    await clickButtonByText("입금 관리");
    await waitForText('[data-testid="payment-row"]', name);
    await waitForText('[data-testid="payment-row"]', "3권");
  });
});

async function configureOperatorIfNeeded() {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const dialogTitle =
          document.querySelector("#dialog-title")?.textContent?.trim() ?? "";
        const operator =
          document.querySelector<HTMLElement>(".rail-operator")?.title ?? "";
        return (
          dialogTitle.includes("현재 담당자 설정") ||
          (operator !== "" && operator !== "담당자 설정")
        );
      }),
    { timeoutMsg: "담당자 상태가 초기화되지 않았습니다." },
  );
  const title = await textOf("#dialog-title");
  if (!title.includes("현재 담당자 설정")) return;
  await setInput("input[name='name']", "가상담당자");
  await clickButtonByText("저장하고 시작");
  await browser.waitUntil(async () => (await textOf("#dialog-title")) === "", {
    timeoutMsg: "담당자 설정 창이 닫히지 않았습니다.",
  });
}

async function registerE2ePerson(name: string) {
  const issue = await selectedIssue();
  const personId = await invokeTauri<string>("register_person_command", {
    request: {
      name,
      cohort: "00",
      phone: null,
      personNote: null,
      issueYear: issue.year,
      issueMonth: issue.startMonth,
      quantity: 1,
      appliedAt: null,
      memo: null,
      confirmDuplicate: true,
    },
  });
  await setInput('[data-testid="people-search"]', name);
  await browser.waitUntil(
    async () => (await textOf('[data-testid="person-row"]')).includes(name),
    { timeoutMsg: `E2E 신청자 등록을 확인하지 못했습니다: ${name}` },
  );
  await setInput('[data-testid="people-search"]', "");
  return personId;
}

async function refreshApp(timeoutMsg: string) {
  const marker = `before-refresh-${Date.now()}`;
  await browser.execute((value) => {
    document.documentElement.dataset.e2eReloadMarker = value;
  }, marker);
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      browser.execute(
        (previousMarker) =>
          document.documentElement.dataset.e2eReloadMarker !== previousMarker &&
          document.documentElement.dataset.theme !== undefined &&
          document.querySelector('[data-testid="people-search"]') !== null,
        marker,
      ),
    { timeoutMsg },
  );
}

async function selectedIssue() {
  const label = await textOf('[data-testid="selected-issue"]');
  const match = label.match(/(\d{4})년\s*(\d{1,2})~/);
  if (!match) throw new Error(`선택 호를 해석하지 못했습니다: ${label}`);
  return { year: Number(match[1]), startMonth: Number(match[2]) };
}

async function issuePickerGeometry() {
  const issue = await selectedIssue();
  return browser.execute((startMonth) => {
    const heading = document
      .querySelector<HTMLElement>(".issue-picker h1")!
      .getBoundingClientRect();
    const buttons = [
      ...document.querySelectorAll<HTMLElement>(".issue-picker button"),
    ].map((button) => button.getBoundingClientRect());
    return {
      startMonth,
      gap: getComputedStyle(
        document.querySelector<HTMLElement>(".issue-picker h1")!,
      ).gap,
      yearSuffixLeft: document
        .querySelector<HTMLElement>(".issue-year-suffix")!
        .getBoundingClientRect().left,
      monthSuffixLeft: document
        .querySelector<HTMLElement>(".issue-month-suffix")!
        .getBoundingClientRect().left,
      headingCenter: heading.left + heading.width / 2,
      arrowsCenter:
        (buttons[0].left +
          buttons[0].width / 2 +
          buttons[1].left +
          buttons[1].width / 2) /
        2,
    };
  }, issue.startMonth);
}

async function panelWidths() {
  return browser.execute(() => ({
    people: document
      .querySelector<HTMLElement>(".distribution-table")!
      .getBoundingClientRect().width,
    notes: document
      .querySelector<HTMLElement>(".notes-panel")!
      .getBoundingClientRect().width,
  }));
}

function shiftIssue(
  issue: { year: number; startMonth: number },
  amount: number,
) {
  const absolute = issue.year * 6 + (issue.startMonth - 1) / 2 + amount;
  const year = Math.floor(absolute / 6);
  const index = ((absolute % 6) + 6) % 6;
  return { year, startMonth: index * 2 + 1 };
}

async function activateMacOsQtManager() {
  const pid = await getMacOsQtManagerPid();
  const { stdout } = await execNativeCommand(
    "/usr/bin/osascript",
    [
      "-e",
      `tell application "System Events"
      set targetProcess to first application process whose unix id is ${pid}
      set frontmost of targetProcess to true
      delay 0.2
      return name of targetProcess
    end tell`,
    ],
    "QT Manager 창 전면화",
  );
  return stdout.trim();
}

async function getMacOsQtManagerPid() {
  const { stdout: rawPid } = await execNativeCommand(
    "/usr/bin/pgrep",
    ["-n", "-x", "qt-manager"],
    "QT Manager process 조회",
  );
  const pid = Number.parseInt(rawPid.trim(), 10);
  if (!Number.isSafeInteger(pid)) {
    throw new Error(`qt-manager PID를 확인하지 못했습니다: ${rawPid}`);
  }
  return pid;
}

async function captureMacOsCompositor(path: string) {
  await activateMacOsQtManager();
  const windowId = await getMacOsQtManagerWindowId();
  await execNativeCommand(
    "/usr/sbin/screencapture",
    ["-x", "-o", "-T", "1", "-l", String(windowId), resolve(path)],
    "QT Manager 단일 창 캡처",
  );
}

async function getMacOsQtManagerWindowId() {
  const pid = await getMacOsQtManagerPid();
  const { stdout } = await execNativeCommand(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      `ObjC.import("CoreGraphics");
      const windowListRef = $.CGWindowListCopyWindowInfo(
        $.kCGWindowListOptionOnScreenOnly,
        $.kCGNullWindowID,
      );
      const windows = ObjC.castRefToObject(windowListRef);
      let windowId = null;
      for (let index = 0; index < windows.count; index += 1) {
        const info = ObjC.deepUnwrap(windows.objectAtIndex(index));
        if (
          info.kCGWindowOwnerPID === ${pid} &&
          info.kCGWindowLayer === 0 &&
          info.kCGWindowSharingState !== 0
        ) {
          windowId = info.kCGWindowNumber;
          break;
        }
      }
      windowId === null ? "" : String(windowId);`,
    ],
    "QT Manager 창 ID 조회",
  );
  const windowId = Number.parseInt(stdout.trim(), 10);
  if (!Number.isSafeInteger(windowId) || windowId <= 0) {
    throw new Error(`QT Manager 창 ID를 확인하지 못했습니다: ${stdout}`);
  }
  return windowId;
}

async function assertNativeVisualPreflight() {
  if (process.platform !== "darwin") {
    throw new Error(
      "QT_MANAGER_NATIVE_VISUAL=1 검수는 macOS에서만 실행할 수 있습니다.",
    );
  }
  const { stdout } = await execNativeCommand(
    "/usr/bin/osascript",
    ["-e", 'tell application "System Events" to return UI elements enabled'],
    "macOS 접근성 권한 사전 확인",
  );
  if (stdout.trim() !== "true") {
    throw new Error(
      "macOS 접근성 권한이 없습니다. System Settings > Privacy & Security > Accessibility에서 현재 터미널을 허용하세요.",
    );
  }
  mkdirSync("test-results", { recursive: true });
  const probePath = resolve("test-results/.native-screen-recording-probe.png");
  try {
    await execNativeCommand(
      "/usr/sbin/screencapture",
      ["-x", "-R", "0,0,1,1", probePath],
      "macOS 화면 기록 권한 사전 확인",
    );
  } finally {
    if (existsSync(probePath)) unlinkSync(probePath);
  }
}

async function execNativeCommand(
  command: string,
  args: string[],
  purpose: string,
) {
  try {
    return await execFileAsync(command, args, {
      timeout: nativeCommandTimeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (reason) {
    const detail =
      reason instanceof Error ? reason.message : String(reason ?? "unknown");
    throw new Error(
      `${purpose}에 실패했습니다. macOS 권한 또는 실행 환경을 확인하세요: ${detail}`,
    );
  }
}

async function selectManagementPerson(name: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedName) => {
        const row = [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[data-testid="management-person"]',
          ),
        ].find((candidate) => candidate.textContent?.includes(expectedName));
        if (!row) return false;
        row.click();
        return true;
      }, name),
    { timeoutMsg: `관리 신청자 행을 찾지 못했습니다: ${name}` },
  );
}

async function setInput(selector: string, value: string) {
  await browser.execute(
    (targetSelector, nextValue) => {
      const element = document.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(targetSelector);
      if (!element)
        throw new Error(`입력 요소를 찾지 못했습니다: ${targetSelector}`);
      const setter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, nextValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function setSelect(selector: string, value: string) {
  await browser.execute(
    (targetSelector, nextValue) => {
      const element = document.querySelector<HTMLSelectElement>(targetSelector);
      if (!element)
        throw new Error(`선택 요소를 찾지 못했습니다: ${targetSelector}`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(element, nextValue);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function setPersonFilterPreset(label: "남은 배부" | "전체") {
  await openPersonFilter();
  await browser.execute((expected) => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(".filter-presets button"),
    ].find((candidate) => candidate.textContent?.trim() === expected);
    if (!button)
      throw new Error(`필터 빠른 선택을 찾지 못했습니다: ${expected}`);
    button.click();
  }, label);
  await closePersonFilter();
}

async function setPersonFilters(labels: string[]) {
  await openPersonFilter();
  for (const label of await browser.$$(".filter-popover > label")) {
    const input = await label.$("input");
    const shouldCheck = labels.includes((await label.getText()).trim());
    if ((await input.isSelected()) !== shouldCheck) {
      await label.click();
      expect(await input.isSelected()).toBe(shouldCheck);
    }
  }
  await closePersonFilter();
}

async function openPersonFilter() {
  await browser.execute(() => {
    const trigger =
      document.querySelector<HTMLButtonElement>(".filter-trigger");
    if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
  });
  await browser.waitUntil(
    async () =>
      browser.execute(() => document.querySelector(".filter-popover") !== null),
    { timeoutMsg: "신청자 필터가 열리지 않았습니다." },
  );
}

async function closePersonFilter() {
  await browser.execute(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await browser.waitUntil(
    async () =>
      browser.execute(() => document.querySelector(".filter-popover") === null),
    { timeoutMsg: "신청자 필터가 닫히지 않았습니다." },
  );
}

async function firstOptionValue(selector: string) {
  return browser.execute((targetSelector) => {
    const select = document.querySelector<HTMLSelectElement>(targetSelector);
    const option = [...(select?.options ?? [])].find(
      (candidate) => candidate.value && candidate.value !== "__new__",
    );
    if (!option) throw new Error("기존 신청자 선택지를 찾지 못했습니다.");
    return option.value;
  }, selector);
}

async function clickButtonByText(text: string, ariaLabel?: string) {
  await browser.execute(
    (expectedText, expectedLabel) => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find(
        (candidate) =>
          (expectedLabel
            ? candidate.getAttribute("aria-label") === expectedLabel
            : candidate.textContent?.trim().includes(expectedText)) &&
          !candidate.disabled,
      );
      if (!button) throw new Error(`버튼을 찾지 못했습니다: ${expectedText}`);
      button.click();
    },
    text,
    ariaLabel,
  );
}

async function dispatchShortcut(key: string, shiftKey = false) {
  await browser.execute(
    (shortcutKey, withShift) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: shortcutKey,
          metaKey: true,
          ctrlKey: true,
          shiftKey: withShift,
          bubbles: true,
        }),
      );
    },
    key,
    shiftKey,
  );
}

async function waitForText(selector: string, expected: string) {
  await browser.waitUntil(
    async () => (await textOf(selector)).includes(expected),
    { timeoutMsg: `${selector}에서 '${expected}'를 확인하지 못했습니다.` },
  );
}

async function waitForEnabled(selector: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((targetSelector) => {
        const element =
          document.querySelector<HTMLButtonElement>(targetSelector);
        return Boolean(element && !element.disabled);
      }, selector),
    { timeoutMsg: `${selector} 버튼이 활성화되지 않았습니다.` },
  );
}

async function textOf(selector: string) {
  return browser.execute(
    (targetSelector) =>
      document.querySelector(targetSelector)?.textContent?.trim() ?? "",
    selector,
  );
}

async function invokeTauri<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) {
  return browser.execute(
    (nextCommand, nextArgs) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<T>;
          };
        }
      ).__TAURI_INTERNALS__.invoke(nextCommand, nextArgs),
    command,
    args,
  );
}

async function helpVisibility(selector: string) {
  return browser.execute((query) => {
    const el = document.querySelector<HTMLElement>(query);
    const panel = el?.closest<HTMLElement>(".help-panel");
    if (!el || !panel)
      return {
        visible: false,
        exists: Boolean(el),
        offsetParent: null,
        rect: null,
        blockedBy: "missing",
      };
    const rect = el.getBoundingClientRect();
    const clip = panel.getBoundingClientRect();
    let blockedBy = "";
    for (
      let ancestor: HTMLElement | null = el;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (
        ancestor.hidden ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        blockedBy = `${ancestor.tagName}.${ancestor.className}`;
        break;
      }
    }
    const visible =
      !blockedBy &&
      rect.width > 0 &&
      rect.height > 0 &&
      Math.min(rect.right, clip.right, innerWidth) >
        Math.max(rect.left, clip.left, 0) &&
      Math.min(rect.bottom, clip.bottom, innerHeight) >
        Math.max(rect.top, clip.top, 0);
    return {
      visible,
      exists: true,
      offsetParent: el.offsetParent?.tagName ?? null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      blockedBy,
      visibility: document.visibilityState,
      documentFocused: document.hasFocus(),
      backdrop: panel.parentElement?.className,
      panelStyle: {
        opacity: getComputedStyle(panel).opacity,
        transform: getComputedStyle(panel).transform,
        animation: getComputedStyle(panel).animationName,
        playState: getComputedStyle(panel).animationPlayState,
      },
      animations: panel.getAnimations().map((animation) => ({
        state: animation.playState,
        time: animation.currentTime,
        rate: animation.playbackRate,
      })),
    };
  }, selector);
}
async function waitForHelpVisibility(selector: string) {
  try {
    await browser.waitUntil(
      async () => (await helpVisibility(selector)).visible,
      {
        timeoutMsg: `${selector} 도움말 내용이 화면 안에 표시되지 않았습니다.`,
      },
    );
    console.info(
      "help-rendered-visibility",
      selector,
      JSON.stringify(await helpVisibility(selector)),
    );
  } catch (reason) {
    throw new Error(
      `${String(reason)} — ${JSON.stringify(await helpVisibility(selector))}`,
    );
  }
}
