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
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="draft-form"]')
        ?.requestSubmit();
    });
    await waitForText('[data-testid="draft-form-error"]', "이름을 입력하세요.");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            document.querySelector('[data-testid="draft-form-error"]') === null,
        )) === true,
      {
        timeout: 8_000,
        interval: 250,
        timeoutMsg: "간이 등록 입력 오류가 자동으로 사라지지 않았습니다.",
      },
    );
    await setInput("input[name='name']", applicant);
    await setInput("input[name='cohort']", "00");
    await setInput("input[name='quantity']", "2");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="draft-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "현장 신청자를 추가했습니다");

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

  it("explicitly links a one-time purchase or creates a purchase-only applicant", async () => {
    const existing = `가상구매연결${Date.now()}`;
    await registerE2ePerson(existing);

    await clickButtonByText("", "기타 기능");
    await clickButtonByText("현장 개별 구매");
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
    await waitForText('[data-testid="person-detail"]', "개별 구매 이력 1건");
    await waitForText('[data-testid="purchase-history"]', "구매·전달 1권");

    const newPerson = `가상구매신규${Date.now()}`;
    await clickButtonByText("현장 배부");
    await clickButtonByText("", "기타 기능");
    await clickButtonByText("현장 개별 구매");
    await setInput("input[name='buyerName']", newPerson);
    await waitForText(
      '[data-testid="purchase-new-person-toggle"]',
      "신규 인원으로 추가",
    );
    await clickButtonByText("신규 인원으로 추가");
    await setInput("input[name='purchaseCohort']", "01");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await clickButtonByText("", "마지막 동작 되돌리기");
    await waitForText(".toast", "현장 개별 구매: 되돌렸습니다.");
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText(".toast", "현장 개별 구매: 다시 실행했습니다.");

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
    await waitForText('[data-testid="person-detail"]', "개별 구매 이력 3건");
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
    ).toEqual({ disabled: false, label: "구독 갱신" });

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
    await clickButtonByText("구독 갱신");
    await waitForText(
      "#management-dialog-title",
      `${expiredName} · 구독 추가·갱신`,
    );
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

  it("keeps help layouts and shortcut wording readable", async () => {
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-help"]')
        ?.click();
    });
    await waitForText("#help-title", "QT Manager 도움말");
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return {
          widthRatio: rect.width / window.innerWidth,
          heightRatio: rect.height / window.innerHeight,
          flexDirection: getComputedStyle(panel).flexDirection,
        };
      }),
    ).toMatchObject({
      widthRatio: expect.any(Number),
      heightRatio: expect.any(Number),
      flexDirection: "column",
    });
    expect(
      await browser.execute(() => {
        const panel = document.querySelector<HTMLElement>(
          '[data-testid="help-panel"]',
        );
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        return (
          rect.width / window.innerWidth >= 0.6 &&
          rect.width / window.innerWidth <= 0.8 &&
          rect.height / window.innerHeight >= 0.6 &&
          rect.height / window.innerHeight <= 0.8
        );
      }),
    ).toBe(true);
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
    await browser.execute(() => {
      document
        .querySelector<HTMLAnchorElement>('[data-testid="help-nav-shortcuts"]')
        ?.click();
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
    await waitForText('[data-testid="support-info"]', "0.1.0");
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
  });

  // 이전 기록 타입의 UI 회귀 시나리오는 새 메모 화면으로 대체했다. 구버전
  // check_items/pinned_notes 어댑터는 Rust 통합 테스트에서 계속 검증한다.
  it.skip("creates linked and general check items, transitions all states, and keeps pinned notes periodless", async () => {
    await registerE2ePerson(`가상확인대상${Date.now()}`);
    await setPersonFilterPreset("전체");
    const unique = String(Date.now());
    const generalItem = `가상 일반 확인 ${unique}`;
    const linkedItem = `가상 신청자 연결 확인 ${unique}`;
    const pinnedTitle = `가상 보관 위치 ${unique}`;
    await setInput("#quick-item", generalItem);
    await waitForEnabled('[data-testid="add-general-check-item"]');
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="add-general-check-item"]',
        )
        ?.click();
    });
    await waitForText(".toast", "일반 확인할 일을 추가했습니다");
    await waitForText(".check-item-list", generalItem);
    await waitForText(".check-item-list", "일반");
    await clickButtonByText("", "마지막 동작 되돌리기");
    await browser.waitUntil(
      async () => !(await textOf(".check-item-list")).includes(generalItem),
      { timeoutMsg: "확인할 일 추가 되돌리기가 반영되지 않았습니다." },
    );
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText(".check-item-list", generalItem);

    const linkedPersonName = await browser.execute(
      () =>
        document
          .querySelector('[data-testid="person-row"] .person-name b')
          ?.textContent?.trim() ?? "",
    );
    await browser.execute(() => {
      document
        .querySelector('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await waitForText(".menu-popover", "메모 추가");
    await clickButtonByText("확인할 일 추가");
    await waitForText("#dialog-title", "확인할 일 추가");
    await setInput("textarea[name='content']", linkedItem);
    await clickButtonByText("확인할 일 저장");
    await waitForText(".check-item-list", linkedItem);
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(".check-item"),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="open-check-item-detail"]',
        )
        ?.click();
    }, linkedItem);
    await waitForText(".check-item-detail", linkedItem);
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector(".check-item-detail"),
        )) === null,
      { timeoutMsg: "확인할 일 전문 창이 Escape로 닫히지 않았습니다." },
    );
    expect(
      await browser.execute((content) => {
        const item = [
          ...document.querySelectorAll<HTMLElement>(".check-item"),
        ].find((candidate) => candidate.textContent?.includes(content));
        return item?.querySelector("small b")?.textContent?.trim() ?? "";
      }, linkedItem),
    ).toBe(linkedPersonName);
    expect(
      await browser.execute(
        () =>
          document.querySelector(".person-check-indicator") !== null &&
          document.querySelector(".person-name small") === null,
      ),
    ).toBe(true);

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await waitForText(".linked-check-items", linkedItem);
    await waitForText(".linked-check-items", "확인 필요");
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          ".linked-check-items .linked-check-item",
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="연결된 확인할 일 수정"]',
        )
        ?.click();
    }, linkedItem);
    await setInput('[data-testid="edit-linked-check-item"]', linkedItem);
    await clickButtonByText("저장");
    await waitForText(".toast", "연결된 확인할 일을 수정했습니다");
    await browser.execute(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelector(".linked-check-items") === null,
        ),
      { timeoutMsg: "연결 확인 정보를 본 수정창이 닫히지 않았습니다." },
    );
    const mouseFocus = await browser.execute(() => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="person-row"]',
      );
      const style = row ? getComputedStyle(row) : null;
      return {
        focusVisible: row?.matches(":focus-visible") ?? false,
        thickFocusLine:
          style?.outlineStyle !== "none" &&
          parseFloat(style?.outlineWidth ?? "0") > 1,
      };
    });
    expect(mouseFocus).toEqual({ focusVisible: false, thickFocusLine: false });

    if (nativeVisualEnabled) {
      expect(await activateMacOsQtManager()).toBe("qt-manager");
      expect(await focusPreviousElementBeforePersonRow()).toBe(true);
      await sendMacOsOptionTab();
      await browser.waitUntil(
        async () => (await personRowFocusContract()).active,
        { timeoutMsg: "macOS Option+Tab이 신청자 행으로 이동하지 않았습니다." },
      );
      const keyboardFocus = await personRowFocusContract();
      expect(keyboardFocus).toEqual({
        active: true,
        focusVisible: true,
        width: "1px",
        offset: "-1px",
        style: "solid",
        colorMatchesAccent: true,
      });
    } else {
      expect(await personRowFocusRule()).toEqual({
        outline: "1px solid var(--accent)",
        offset: "-1px",
      });
    }

    const linkedCheckbox = `input[aria-label="${linkedItem} 확인 완료"]`;
    await browser.execute((selector) => {
      document.querySelector<HTMLInputElement>(selector)?.click();
    }, linkedCheckbox);
    await browser.waitUntil(
      async () =>
        browser.execute(
          (selector) =>
            document.querySelector<HTMLInputElement>(selector)?.checked ===
            true,
          linkedCheckbox,
        ),
      { timeoutMsg: "확인할 일 체크 완료가 반영되지 않았습니다." },
    );
    await browser.execute((selector) => {
      document.querySelector<HTMLInputElement>(selector)?.click();
    }, linkedCheckbox);
    await waitForText(".toast", "다시 확인하도록");
    expect(
      await browser.execute(
        () => document.querySelector(".toast span")?.textContent ?? "",
      ),
    ).toContain("다시 확인하도록");
    await browser.pause(4_200);
    expect(await textOf(".toast")).not.toContain("다시 확인하도록");
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(".check-item"),
      ].find((candidate) => candidate.textContent?.includes(content));
      [...(item?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent?.trim() === "보관")
        ?.click();
    }, linkedItem);
    await clickButtonByText("보관함");
    await waitForText(".archive-dialog", linkedItem);
    await clickButtonByText("복원");
    await clickButtonByText("", "닫기");
    await waitForText(".check-item-list", linkedItem);
    const deletedCheckItemId = await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(".check-item"),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="확인할 일 삭제"]',
        )
        ?.click();
      return item?.dataset.itemId ?? "";
    }, linkedItem);
    expect(deletedCheckItemId).not.toBe("");
    await waitForText(".delete-confirm-dialog", "영구 삭제");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".delete-confirm-dialog .danger-button",
        )
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        !(await browser.execute(
          (id) =>
            [...document.querySelectorAll<HTMLElement>(".check-item")].some(
              (item) => item.dataset.itemId === id,
            ),
          deletedCheckItemId,
        )),
      { timeoutMsg: "확인할 일 삭제가 반영되지 않았습니다." },
    );

    await clickButtonByText("", "고정 메모 추가");
    await setInput("input[name='title']", pinnedTitle);
    await setInput("textarea[name='content']", "가상 예배당 뒤편");
    expect(
      await browser.execute(
        () => document.querySelector("input[name='activeUntil']") === null,
      ),
    ).toBe(true);
    await clickButtonByText("고정 메모 저장");
    await waitForText(".pinned-list", pinnedTitle);
    const deletedPinnedNoteId = await browser.execute((title) => {
      const note = [
        ...document.querySelectorAll<HTMLElement>(".pinned-note"),
      ].find((candidate) => candidate.textContent?.includes(title));
      return note?.dataset.noteId ?? "";
    }, pinnedTitle);
    expect(deletedPinnedNoteId).not.toBe("");
    await clickPinnedNoteMenu(deletedPinnedNoteId);
    await clickButtonByText("고정 해제");
    expect(await textOf(".pinned-list")).not.toContain("고정 해제됨");
    await clickPinnedNoteMenu(deletedPinnedNoteId);
    await browser.execute(() => {
      [...document.querySelectorAll<HTMLButtonElement>(".menu-popover button")]
        .find((button) => button.textContent?.trim() === "삭제")
        ?.click();
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".delete-confirm-dialog .danger-button",
        )
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        !(await browser.execute(
          (id) =>
            [...document.querySelectorAll<HTMLElement>(".pinned-note")].some(
              (note) => note.dataset.noteId === id,
            ),
          deletedPinnedNoteId,
        )),
      { timeoutMsg: "고정 메모 삭제가 반영되지 않았습니다." },
    );

    await clickButtonByText("", "기타 기능");
    await clickButtonByText("현장 개별 구매");
    await setInput("input[name='buyerName']", "가상 구매자");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await clickButtonByText("", "기타 기능");
    await clickButtonByText("최근 구매 취소");
    await waitForText(".toast", "최근 개별 구매를 취소했습니다");
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
        (await browser.execute(() =>
          document.querySelector(".memo-archive-dialog"),
        )) === null,
      { timeoutMsg: "보관함 메모 삭제 후 보관함이 닫히지 않았습니다." },
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
    await waitForText("#dialog-title", "현장 간이 등록");
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
    await clickButtonByText("", "기타 기능");
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
    await waitForText("#management-dialog-title", "QT 신청자 정보 수정");
    await clickButtonByText("", "닫기");
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
      fixture.style.height = "900px";
      fixture.setAttribute("aria-hidden", "true");
      list.append(fixture);
      list.scrollTop = 32;
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
      fixture.style.height = "900px";
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
      width: 76,
      height: layout.rail.viewportHeight,
      viewportHeight: layout.rail.viewportHeight,
      activeCount: 1,
    });
    expect(layout.deskLeft).toBe(76);
    expect(layout.stickyInputHeight).toBeLessThanOrEqual(94);
    expect(layout.fontMedium).toBe("15px");
    expect(layout.fontSmall).toBe("14px");
    expect(layout.fontMeta).toBe("13px");
    expect(layout.tableHeadFontSize).toBe("14px");
    expect(layout.summaryLabelFontSize).toBe("14px");
    expect(layout.summaryCellPadding).toBe("9px 20px 10px");
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

  // 새 메모 화면으로 대체된 이전 신청자 관리 기록 시나리오다.
  it.skip("registers, edits, renews and archives a person from management", async () => {
    const unique = String(Date.now()).slice(-8);
    const applicant = `가상관리${unique}`;
    const edited = `${applicant}수정`;
    const registrationPhone = `010-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const editedPhone = `011-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const renewalIssue = shiftIssue(await selectedIssue(), 6);
    const currentIssue = currentCalendarIssue();
    const pastIssue = shiftIssue(currentIssue, -6);
    const detailPrefix = `가상상세${unique}`;
    const detailApplicant = `${detailPrefix}현재`;
    const comparisonApplicant = `${detailPrefix}비교`;
    const detailPhone = `012-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const comparisonPhone = `013-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const personNote = `가상 신청자 메모 ${unique}`;
    const linkedCheck = `가상 연결 확인 ${unique}`;

    const detailPersonId = await invokeTauri<string>(
      "register_person_command",
      {
        request: {
          name: detailApplicant,
          cohort: "00",
          phone: detailPhone,
          personNote,
          issueYear: currentIssue.year,
          issueMonth: currentIssue.startMonth,
          quantity: 1,
          appliedAt: null,
          memo: "현재 구독 fixture",
          confirmDuplicate: true,
        },
      },
    );
    await invokeTauri("renew_subscription_command", {
      request: {
        personId: detailPersonId,
        issueYear: pastIssue.year,
        issueMonth: pastIssue.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: "지난 구독 fixture",
        confirmOverlap: false,
      },
    });
    const detailFixture = await invokeTauri<{
      subscriptions: { id: string; periodState: string }[];
    }>("load_person_detail_command", { personId: detailPersonId });
    const currentSubscriptionId = detailFixture.subscriptions.find(
      (subscription) => subscription.periodState === "current",
    )?.id;
    if (!currentSubscriptionId) {
      throw new Error("관리 상세 배부 fixture의 현재 구독을 찾지 못했습니다.");
    }
    await invokeTauri("record_distribution_command", {
      request: {
        issueYear: currentIssue.year,
        issueMonth: currentIssue.startMonth,
        subscriptionId: currentSubscriptionId,
        quantity: 1,
        note: null,
      },
    });
    await invokeTauri("create_check_item_command", {
      request: { personId: detailPersonId, content: linkedCheck },
    });
    for (let index = 1; index <= 5; index += 1) {
      await invokeTauri("create_check_item_command", {
        request: {
          personId: detailPersonId,
          content: `${detailPrefix} 상세 확인 ${index}`,
        },
      });
    }
    await invokeTauri<string>("register_person_command", {
      request: {
        name: comparisonApplicant,
        cohort: "01",
        phone: comparisonPhone,
        personNote: null,
        issueYear: currentIssue.year,
        issueMonth: currentIssue.startMonth,
        quantity: 1,
        appliedAt: null,
        memo: null,
        confirmDuplicate: true,
      },
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    expect(
      await browser.execute(
        () =>
          document
            .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
            ?.getAttribute("aria-current") ?? null,
      ),
    ).toBe("page");
    await waitForText("h2", "신청자 관리");
    await setInput('[data-testid="management-search"]', detailPrefix);
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll('[data-testid="management-person"]')
              .length === 2,
        ),
      { timeoutMsg: "관리 상세 검증용 신청자 2명을 찾지 못했습니다." },
    );
    await browser.execute((name) => {
      const row = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="management-person"]',
        ),
      ].find((candidate) => candidate.textContent?.includes(name));
      if (!row) throw new Error(`관리 상세 검증 행을 찾지 못했습니다: ${name}`);
      row.click();
    }, detailApplicant);
    await waitForText('[data-testid="person-detail"]', detailPhone);

    await browser.execute(() => {
      const tip = document.querySelector<HTMLElement>(
        '[data-testid="management-heading-help"] [role="tooltip"]',
      );
      if (!tip) throw new Error("신청자 관리 안내 툴팁을 찾지 못했습니다.");
      // WebKit embedded driver does not expose CSS :hover/:focus state after
      // a programmatic pointer move. Open it explicitly to verify the real
      // rendered bounds and clipping policy.
      tip.style.display = "block";
    });
    const headingTooltip = await browser.execute(() => {
      const tip = document.querySelector<HTMLElement>(
        '[data-testid="management-heading-help"] [role="tooltip"]',
      );
      const rect = tip?.getBoundingClientRect();
      return {
        display: tip ? getComputedStyle(tip).display : "missing",
        left: rect?.left ?? -1,
        right: rect?.right ?? -1,
        top: rect?.top ?? -1,
        width: rect?.width ?? 0,
        windowWidth: window.innerWidth,
      };
    });
    expect(headingTooltip.display).toBe("block");
    expect(headingTooltip.left).toBeGreaterThanOrEqual(0);
    expect(headingTooltip.right).toBeLessThanOrEqual(
      headingTooltip.windowWidth,
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="management-heading-help"] [role="tooltip"]',
        )
        ?.style.removeProperty("display");
    });

    const inlinePersonNote = `${detailPrefix} 즉시 메모`;
    const inlineCheck = `${detailPrefix} 즉시 확인할 일`;
    await setInput('[data-testid="person-check-item-input"]', inlineCheck);
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>(
          '[data-testid="person-check-item-form"]',
        )
        ?.requestSubmit();
    });
    await waitForText(".toast", "신청자 확인할 일을 저장했습니다.");
    await waitForText('[data-testid="person-detail"]', inlineCheck);
    await clickButtonByText("현장 배부");
    await waitForText('[data-testid="selected-issue"]', "월호");
    await clickButtonByText("", "마지막 동작 되돌리기");
    await browser.waitUntil(
      async () => !(await textOf(".check-item-list")).includes(inlineCheck),
      { timeoutMsg: "신청자 연결 확인할 일 되돌리기가 반영되지 않았습니다." },
    );
    await clickButtonByText("", "되돌린 동작 다시 실행");
    await waitForText(".check-item-list", inlineCheck);
    await clickButtonByText("신청자 관리");
    await waitForText("h2", "신청자 관리");
    const managementFixture = await invokeTauri<{
      people: { name: string }[];
    }>("load_people_management_command", {
      query: detailPrefix,
      includeArchived: false,
    });
    expect(
      managementFixture.people.some(
        (person) => person.name === detailApplicant,
      ),
    ).toBe(true);
    await selectManagementPerson(detailApplicant);
    await waitForText('[data-testid="person-detail"]', inlineCheck);
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-check-items"] .linked-check-item',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="연결된 확인할 일 수정"]',
        )
        ?.click();
    }, inlineCheck);
    await setInput('[data-testid="edit-linked-check-item"]', inlineCheck);
    await clickButtonByText("저장");
    await waitForText(".toast", "신청자 연결 확인할 일을 수정했습니다");
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-check-items"] .linked-check-item',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item?.querySelector<HTMLInputElement>("input[type='checkbox']")?.click();
    }, inlineCheck);
    await waitForText(".toast", "신청자 연결 확인할 일을 완료했습니다");
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-check-items"] .linked-check-item',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="연결된 확인할 일 보관"]',
        )
        ?.click();
    }, inlineCheck);
    await waitForText(".toast", "신청자 연결 확인할 일을 보관했습니다");
    const deletedManagementCheck = `${detailPrefix} 상세 확인 1`;
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-check-items"] .linked-check-item',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="연결된 확인할 일 삭제"]',
        )
        ?.click();
    }, deletedManagementCheck);
    await waitForText('[data-testid="linked-check-items"]', "삭제할까요?");
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="linked-check-items"] .linked-check-item',
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          ".linked-check-item-delete-confirm .danger-button",
        )
        ?.click();
    }, deletedManagementCheck);
    await waitForText(".toast", "신청자 연결 확인할 일을 삭제했습니다");
    await browser.waitUntil(
      async () =>
        !(await textOf('[data-testid="person-detail"]')).includes(
          deletedManagementCheck,
        ),
      { timeoutMsg: "신청자 상세 확인할 일 삭제가 반영되지 않았습니다." },
    );
    await setInput('[data-testid="person-note-input"]', inlinePersonNote);
    await clickButtonByText("메모 저장");
    await waitForText(".toast", "신청자 메모를 저장했습니다.");
    await waitForText('[data-testid="person-detail"]', inlinePersonNote);

    const detailBeforeArchiveToggle = await textOf(
      '[data-testid="person-detail"]',
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLInputElement>(".archived-toggle input")
        ?.click();
    });
    expect(await textOf('[data-testid="person-detail"]')).toContain(
      detailPhone,
    );
    expect(detailBeforeArchiveToggle).toContain(detailPhone);
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelector<HTMLInputElement>(".archived-toggle input")
              ?.checked === true,
        ),
      { timeoutMsg: "보관된 신청자 보기 전환이 반영되지 않았습니다." },
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLInputElement>(".archived-toggle input")
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelector<HTMLInputElement>(".archived-toggle input")
              ?.checked === false,
        ),
      { timeoutMsg: "보관된 신청자 보기 해제가 반영되지 않았습니다." },
    );

    await clickButtonByText("정보 수정");
    const editDialogCheck = `${detailPrefix} 상세 확인 2`;
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          ".management-edit-dialog .linked-check-item",
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      item
        ?.querySelector<HTMLButtonElement>(
          '[aria-label="연결된 확인할 일 수정"]',
        )
        ?.click();
    }, editDialogCheck);
    await setInput('[data-testid="edit-linked-check-item"]', editDialogCheck);
    await browser.execute((content) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>(
          ".management-edit-dialog .linked-check-item",
        ),
      ].find((candidate) => candidate.textContent?.includes(content));
      const button = item?.querySelector<HTMLButtonElement>(
        ".linked-check-item-actions button",
      );
      if (!button) throw new Error("관리 편집 저장 버튼을 찾지 못했습니다.");
      button.click();
    }, editDialogCheck);
    await waitForText(".toast", "신청자 연결 확인할 일을 수정했습니다");
    expect(
      await browser.execute(
        () => document.querySelector(".management-edit-dialog") !== null,
      ),
    ).toBe(true);
    const editDialogContract = await browser.execute(() => {
      const dialog = document.querySelector<HTMLElement>(
        ".management-edit-dialog",
      );
      const name =
        dialog?.querySelector<HTMLInputElement>("input[name='name']");
      const cohort = dialog?.querySelector<HTMLInputElement>(
        "input[name='cohort']",
      );
      return {
        width: dialog?.getBoundingClientRect().width ?? 0,
        nameWidth: name?.getBoundingClientRect().width ?? 0,
        cohortWidth: cohort?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(editDialogContract.width).toBeGreaterThan(400);
    expect(editDialogContract.width).toBeLessThanOrEqual(560);
    expect(editDialogContract.nameWidth).toBeLessThanOrEqual(470);
    expect(editDialogContract.cohortWidth).toBeLessThanOrEqual(300);
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-testid="edit-person-form"]'),
        )) === null,
      { timeoutMsg: "신청자 정보 수정창이 Escape로 닫히지 않았습니다." },
    );

    // Retina 물리 픽셀 1800×1280은 지원 최소 논리 크기 900×640에 해당한다.
    await browser.setWindowSize(1800, 1280);
    const managementContract = await browser.execute(
      (fixturePhones) => {
        const list = document.querySelector<HTMLElement>(
          ".management-person-list",
        )!;
        const detail = document.querySelector<HTMLElement>(
          '[data-testid="person-detail"]',
        )!;
        const rows = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="management-person"]',
          ),
        ];
        const listRect = list.getBoundingClientRect();
        const rowRects = rows.map((row) => row.getBoundingClientRect());
        const maxRowHeight = Math.max(...rowRects.map((row) => row.height));
        const lastRowBottom = Math.max(...rowRects.map((row) => row.bottom));
        const actionContracts = [
          ["open-handover", "secondary-button"],
          ["open-application-import", "secondary-button"],
          ["open-register-person", "primary-button"],
        ].map(([testId, expectedClass]) => {
          const button = document.querySelector<HTMLButtonElement>(
            `[data-testid="${testId}"]`,
          )!;
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            testId,
            expectedClass,
            hasExpectedClass: button.classList.contains(expectedClass),
            hasOppositeClass: button.classList.contains(
              expectedClass === "primary-button"
                ? "secondary-button"
                : "primary-button",
            ),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= 0 &&
              rect.right <= window.innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight &&
              style.display !== "none" &&
              style.visibility !== "hidden",
            fontWeight: style.fontWeight,
          };
        });
        const panelLine = getComputedStyle(
          document.querySelector<HTMLElement>(".management-grid")!,
        ).borderTopColor;
        const distributionRows = [
          ...detail.querySelectorAll<HTMLElement>(".distribution-history-row"),
        ];
        const firstSubscription =
          detail.querySelector<HTMLElement>(".subscription-card");
        const quantity = firstSubscription?.querySelector<HTMLElement>(
          ".subscription-quantity",
        );
        const state = firstSubscription?.querySelector<HTMLElement>(
          ".subscription-state",
        );
        const quantityRect = quantity?.getBoundingClientRect();
        const stateRect = state?.getBoundingClientRect();
        return {
          rowCount: rows.length,
          rowHeights: rowRects.map((row) => Math.round(row.height)),
          maxRowHeight,
          unusedListHeight: listRect.bottom - lastRowBottom,
          listHasVisibleMetadata: rows.some((row) =>
            row.querySelector(
              '[data-testid="management-person-meta"], [data-testid="management-person-period"]',
            ),
          ),
          listRowsHaveAccessibleContext: rows.every((row) =>
            row.getAttribute("aria-label")?.includes("구독"),
          ),
          listHasFixturePhone: fixturePhones.some((phone) =>
            list.textContent?.includes(phone),
          ),
          detailText: detail.textContent ?? "",
          currentStateCount: detail.querySelectorAll(
            '[data-testid="subscription-current"]',
          ).length,
          pastStateCount: detail.querySelectorAll(
            '[data-testid="subscription-past"]',
          ).length,
          distributionHeaders: [
            ...detail.querySelectorAll<HTMLElement>(
              '[data-testid="distribution-history-header"] strong',
            ),
          ].map((header) => header.textContent?.trim() ?? ""),
          distributionRowCount: distributionRows.length,
          distributionRowLineMatchesPanel: distributionRows.every(
            (row) => getComputedStyle(row).borderBottomColor === panelLine,
          ),
          distributionLineMatchesPanel: [
            ...detail.querySelectorAll<HTMLElement>(
              ".distribution-history-header, .distribution-history-row",
            ),
          ].every(
            (row) => getComputedStyle(row).borderBottomColor === panelLine,
          ),
          historyVerticalCenterDelta:
            quantityRect && stateRect
              ? Math.abs(
                  quantityRect.top +
                    quantityRect.height / 2 -
                    (stateRect.top + stateRect.height / 2),
                )
              : null,
          actionContracts,
          listOverflow: getComputedStyle(list).overflowY,
          detailOverflow: getComputedStyle(detail).overflowY,
          listActuallyOverflows: list.scrollHeight > list.clientHeight,
          detailActuallyOverflows: detail.scrollHeight > detail.clientHeight,
          horizontalPageScroll:
            document.documentElement.scrollWidth > window.innerWidth ||
            document.body.scrollWidth > window.innerWidth,
        };
      },
      [detailPhone, comparisonPhone],
    );
    expect(managementContract.rowCount).toBe(2);
    expect(managementContract.rowHeights).toHaveLength(2);
    expect(managementContract.maxRowHeight).toBeLessThanOrEqual(72);
    expect(managementContract.unusedListHeight).toBeGreaterThan(
      managementContract.maxRowHeight,
    );
    expect(managementContract.listHasVisibleMetadata).toBe(false);
    expect(managementContract.listRowsHaveAccessibleContext).toBe(true);
    expect(managementContract.listHasFixturePhone).toBe(false);
    expect(managementContract.detailText).toContain(detailPhone);
    expect(managementContract.detailText).toContain(inlinePersonNote);
    expect(managementContract.detailText).toContain(linkedCheck);
    expect(managementContract.detailText).toContain("시작");
    expect(managementContract.detailText).toContain("끝");
    expect(managementContract.detailText).not.toContain("→");
    expect(managementContract.detailText).not.toContain("기존 XLSX");
    expect(managementContract.currentStateCount).toBe(1);
    expect(managementContract.pastStateCount).toBe(1);
    expect(managementContract.distributionHeaders).toEqual([
      "배부 호",
      "처리",
      "처리 시각",
    ]);
    expect(managementContract.distributionRowCount).toBe(1);
    expect(managementContract.distributionRowLineMatchesPanel).toBe(true);
    expect(managementContract.distributionLineMatchesPanel).toBe(true);
    expect(managementContract.historyVerticalCenterDelta).not.toBeNull();
    expect(managementContract.historyVerticalCenterDelta).toBeLessThanOrEqual(
      1,
    );
    expect(managementContract.actionContracts).toEqual([
      {
        testId: "open-handover",
        expectedClass: "secondary-button",
        hasExpectedClass: true,
        hasOppositeClass: false,
        visible: true,
        fontWeight: "400",
      },
      {
        testId: "open-application-import",
        expectedClass: "secondary-button",
        hasExpectedClass: true,
        hasOppositeClass: false,
        visible: true,
        fontWeight: "400",
      },
      {
        testId: "open-register-person",
        expectedClass: "primary-button",
        hasExpectedClass: true,
        hasOppositeClass: false,
        visible: true,
        fontWeight: "400",
      },
    ]);
    expect(managementContract.listOverflow).toBe("auto");
    expect(managementContract.detailOverflow).toBe("auto");
    expect(managementContract.listActuallyOverflows).toBe(false);
    expect(managementContract.detailActuallyOverflows).toBe(true);
    expect(managementContract.horizontalPageScroll).toBe(false);

    await selectManagementPerson(detailApplicant);
    await waitForText('[data-testid="person-detail"]', detailPhone);
    expect(await managementScrollContract()).toEqual({
      anonymousFixtureCount: 2,
      listActuallyOverflows: true,
      detailActuallyOverflows: true,
      listMoved: true,
      detailStayedWhileListMoved: true,
      detailMoved: true,
      listStayedWhileDetailMoved: true,
      documentStayedStill: true,
      documentFits: true,
      panelOverflow: ["auto", "auto"],
      listPanelMinHeight: "0px",
      detailPanelMinHeight: "0px",
      listScrollbarGutter: "stable",
      detailScrollbarGutter: "stable",
    });

    await browser.setWindowSize(2200, 1440);
    expect(await managementScrollContract()).toEqual({
      anonymousFixtureCount: 2,
      listActuallyOverflows: true,
      detailActuallyOverflows: true,
      listMoved: true,
      detailStayedWhileListMoved: true,
      detailMoved: true,
      listStayedWhileDetailMoved: true,
      documentStayedStill: true,
      documentFits: true,
      panelOverflow: ["auto", "auto"],
      listPanelMinHeight: "0px",
      detailPanelMinHeight: "0px",
      listScrollbarGutter: "stable",
      detailScrollbarGutter: "stable",
    });

    expect(
      await browser.execute(() => {
        const cohort = document.querySelector<HTMLElement>(
          '[data-testid="person-cohort"]',
        )!;
        const name = document.querySelector<HTMLElement>(
          '[data-testid="person-name"]',
        )!;
        const cohortRect = cohort.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        return {
          nameIsBesideCohort: nameRect.left > cohortRect.right,
          identityLineDelta: Math.abs(nameRect.top - cohortRect.top),
        };
      }),
    ).toEqual({ nameIsBesideCohort: true, identityLineDelta: 0 });

    const expectedCaptureContract = {
      fontsStatus: "loaded",
      headingActionContracts: [
        {
          text: "데이터 백업·복원",
          expectedClass: "secondary-button",
          hasExpectedClass: true,
          hasOppositeClass: false,
          height: 32,
          insideViewport: true,
        },
        {
          text: "스프레드시트 붙여넣기",
          expectedClass: "secondary-button",
          hasExpectedClass: true,
          hasOppositeClass: false,
          height: 32,
          insideViewport: true,
        },
        {
          text: "+ 신청자 등록",
          expectedClass: "primary-button",
          hasExpectedClass: true,
          hasOppositeClass: false,
          height: 32,
          insideViewport: true,
        },
      ],
      detailActionContracts: [
        {
          text: "정보 수정",
          expectedClass: "secondary-button",
          hasExpectedClass: true,
          hasOppositeClass: false,
          height: 38,
          insideViewport: true,
        },
        {
          text: "구독 추가·갱신",
          expectedClass: "primary-button",
          hasExpectedClass: true,
          hasOppositeClass: false,
          height: 38,
          insideViewport: true,
        },
      ],
      currentStateCount: 1,
      pastStateCount: 1,
      selectedRowCount: 1,
      selectedApplicant: true,
      personNoteVisible: true,
      linkedCheckVisible: true,
      distributionHeaders: ["배부 호", "처리", "처리 시각"],
      distributionRowCount: 1,
      distributionRowLineMatchesPanel: true,
      listHasFixturePhone: false,
      detailHasFixturePhone: true,
      distributionLineMatchesPanel: true,
      documentFits: true,
    };
    expect(
      await prepareManagementCapture(
        "light",
        detailPrefix,
        detailApplicant,
        detailPhone,
        comparisonPhone,
        inlinePersonNote,
        linkedCheck,
      ),
    ).toEqual({ theme: "light", ...expectedCaptureContract });
    mkdirSync("test-results", { recursive: true });
    await browser.saveScreenshot("test-results/ui-management-light.png");
    if (nativeVisualEnabled) {
      await captureMacOsCompositor(
        "test-results/ui-management-light-compositor.png",
      );
    }
    expect(
      await prepareManagementCapture(
        "dark",
        detailPrefix,
        detailApplicant,
        detailPhone,
        comparisonPhone,
        inlinePersonNote,
        linkedCheck,
      ),
    ).toEqual({ theme: "dark", ...expectedCaptureContract });
    await browser.saveScreenshot("test-results/ui-management-dark.png");
    if (nativeVisualEnabled) {
      await captureMacOsCompositor(
        "test-results/ui-management-dark-compositor.png",
      );
    }

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-register-person"]',
        )
        ?.click();
    });
    await setInput("input[name='name']", applicant);
    await setInput("input[name='cohort']", "00");
    await setInput("input[name='phone']", registrationPhone);
    await setInput("textarea[name='personNote']", "가상 신청자 메모");
    await setInput("input[name='quantity']", "2");
    const registrationForm = await browser.execute(() => {
      const form = document.querySelector<HTMLFormElement>(
        '[data-testid="register-person-form"]',
      );
      return {
        exists: Boolean(form),
        valid: form?.checkValidity() ?? false,
        name:
          form?.querySelector<HTMLInputElement>("input[name='name']")?.value ??
          "",
      };
    });
    expect(registrationForm).toEqual({
      exists: true,
      valid: true,
      name: applicant,
    });
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="register-person-form"]')!
        .requestSubmit();
    });
    await browser.waitUntil(async () => (await textOf(".toast")).length > 0, {
      timeoutMsg: "신청자 등록 결과 알림이 나타나지 않았습니다.",
    });
    expect(await textOf(".toast")).toContain("연간 구독을 등록했습니다");

    await setInput('[data-testid="management-search"]', applicant);
    await waitForText('[data-testid="management-person"]', applicant);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="management-person"]')
        ?.click();
    });
    await waitForText('[data-testid="person-detail"]', "가상 신청자 메모");
    await waitForText('[data-testid="person-detail"]', "구독 이력 1건");

    await clickButtonByText("정보 수정");
    await setInput("input[name='name']", edited);
    await setInput("input[name='phone']", editedPhone);
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="edit-person-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "신청자 정보를 수정했습니다");
    await waitForText('[data-testid="person-detail"]', edited);

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-renew"]')
        ?.click();
    });
    await setInput("input[name='issueYear']", String(renewalIssue.year));
    await setSelect(
      "select[name='issueMonth']",
      String(renewalIssue.startMonth),
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="renew-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "새 연간 구독을 추가했습니다");
    await waitForText('[data-testid="person-detail"]', "구독 이력 2건");

    await clickButtonByText("신청자 보관");
    await waitForText(".toast", "신청자를 보관했습니다");

    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          Boolean(document.querySelector("#help-title")),
        )) === false,
      { timeoutMsg: "제거된 도움말 단축키가 도움말을 다시 열었습니다." },
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-help"]')
        ?.click();
    });
    await waitForText("#help-title", "QT Manager 도움말");
    await waitForText(
      '[data-testid="help-people"]',
      "과거 구독을 수정하지 않고",
    );
    await browser.saveScreenshot("test-results/ui-help-management-dark.png");
    await browser.execute(() => {
      document.documentElement.dataset.theme = "light";
    });
    await browser.saveScreenshot("test-results/ui-help-management-light.png");
    await browser.execute(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document
              .querySelector<HTMLElement>('[data-testid="help-nav-people"]')
              ?.getAttribute("aria-current") === "location" &&
            (document.querySelector<HTMLElement>('[data-testid="help-content"]')
              ?.scrollTop ?? 0) > 0,
        ),
      { timeoutMsg: "신청자 관리 도움말이 해당 섹션으로 이동하지 않았습니다." },
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLAnchorElement>(
          '[data-testid="help-nav-quick-start"]',
        )
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document
            .querySelector<HTMLElement>('[data-testid="help-nav-quick-start"]')
            ?.getAttribute("aria-current"),
        )) === "location",
      {
        timeoutMsg: "도움말 목차의 빠른 시작 선택 상태가 갱신되지 않았습니다.",
      },
    );
    await browser.saveScreenshot("test-results/ui-help-quick-start-dark.png");
    expect(
      await browser.execute(() => {
        const copies = [
          ...document.querySelectorAll<HTMLElement>(
            ".help-step-list .help-step-copy",
          ),
        ];
        return {
          stepCount: document.querySelectorAll(".help-step-list > li").length,
          copyCount: copies.length,
          minCopyWidth: Math.min(
            ...copies.map((copy) => copy.getBoundingClientRect().width),
          ),
        };
      }),
    ).toEqual({
      stepCount: 5,
      copyCount: 5,
      minCopyWidth: expect.any(Number),
    });
    expect(
      await browser.execute(() => {
        const widths = [
          ...document.querySelectorAll<HTMLElement>(
            ".help-step-list .help-step-copy",
          ),
        ].map((copy) => copy.getBoundingClientRect().width);
        return widths.every((width) => width > 160);
      }),
    ).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLAnchorElement>('[data-testid="help-nav-handover"]')
        ?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document
              .querySelector<HTMLElement>('[data-testid="help-nav-handover"]')
              ?.getAttribute("aria-current") === "location",
        ),
      {
        timeoutMsg: "도움말 목차의 백업·복원 선택 상태가 갱신되지 않았습니다.",
      },
    );
    await browser.execute(() => {
      const content = document.querySelector<HTMLElement>(
        '[data-testid="help-content"]',
      );
      const notes = document.querySelector<HTMLElement>(
        '[data-testid="help-notes"]',
      );
      if (!content || !notes) return;
      content.style.scrollBehavior = "auto";
      content.scrollTop =
        notes.getBoundingClientRect().top -
        content.getBoundingClientRect().top +
        content.scrollTop;
      content.dispatchEvent(new Event("scroll"));
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document
              .querySelector<HTMLElement>('[data-testid="help-nav-notes"]')
              ?.getAttribute("aria-current") === "location",
        ),
      {
        timeoutMsg:
          "도움말 스크롤 위치와 목차 선택 상태가 동기화되지 않았습니다.",
      },
    );
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
      { timeoutMsg: "도움말 목차의 앱 정보 선택 상태가 갱신되지 않았습니다." },
    );
    await waitForText('[data-testid="support-info"]', "0.1.0");
    await waitForText(
      '[data-testid="help-app-info"]',
      "운영 로그에는 이름·전화번호·메모를 기록하지 않습니다",
    );
    await waitForText(
      '[data-testid="help-distribution"]',
      "현장 배부 표는 구독과 배부 상태를 넓게 보여주기 위해",
    );
    expect(
      await browser.execute(() => {
        const dataPath = document.querySelector<HTMLElement>(
          '[data-testid="support-path-data"]',
        );
        const logPath = document.querySelector<HTMLElement>(
          '[data-testid="support-path-log"]',
        );
        return {
          dataTitle: dataPath?.title ?? "",
          logTitle: logPath?.title ?? "",
          dataWhiteSpace: dataPath ? getComputedStyle(dataPath).whiteSpace : "",
          logWhiteSpace: logPath ? getComputedStyle(logPath).whiteSpace : "",
        };
      }),
    ).toMatchObject({
      dataTitle: expect.any(String),
      logTitle: expect.any(String),
      dataWhiteSpace: "normal",
      logWhiteSpace: "normal",
    });
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          Boolean(document.querySelector("#help-title")),
        )) === false,
      { timeoutMsg: "Escape로 도움말이 닫히지 않았습니다." },
    );
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          Boolean(document.querySelector("#help-title")),
        )) === false,
      { timeoutMsg: "제거된 도움말 단축키가 도움말을 다시 열었습니다." },
    );
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-help"]')
        ?.click();
    });
    await waitForText("#help-title", "QT Manager 도움말");
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="help-backdrop"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelector("#help-title"))) ===
        null,
      { timeoutMsg: "도움말 바깥 영역 클릭으로 닫히지 않았습니다." },
    );
    await clickButtonByText("현장 배부");
    await waitForText('[data-testid="selected-issue"]', "월호");
    expect(
      await browser.execute(
        () =>
          document
            .querySelector<HTMLButtonElement>(
              ".app-navigation [aria-current='page']",
            )
            ?.textContent?.trim() ?? "",
      ),
    ).toContain("현장 배부");
  });

  it("filters and names applicants that need profile completion", async () => {
    const draftName = `가상보완대상${Date.now()}`;
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-draft"]')
        ?.click();
    });
    await setInput("input[name='name']", draftName);
    await setInput("input[name='cohort']", "00");
    await setInput("input[name='quantity']", "1");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="draft-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "현장 신청자를 추가했습니다");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 관리");
    await setInput('[data-testid="management-search"]', draftName);
    await waitForText('[data-testid="management-person"]', draftName);
    await waitForText('[data-testid="draft-count-filter"]', "정보 보완 필요");
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
      paymentNotice: "입금 여부 열은 확인하지 않고 가져오기에서 제외합니다.",
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
    expect(preview.formatVersion).toBe(2);
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

function currentCalendarIssue() {
  // 앱 런타임과 같은 Asia/Seoul 달력 날짜를 사용해 자정 경계에서도 상태가 맞는다.
  const seoulNow = new Date(Date.now() + 9 * 60 * 60 * 1_000);
  const year = seoulNow.getUTCFullYear();
  const month = seoulNow.getUTCMonth() + 1;
  return { year, startMonth: month % 2 === 0 ? month - 1 : month };
}

async function sendMacOsOptionTab() {
  await execNativeCommand(
    "/usr/bin/osascript",
    ["-e", 'tell application "System Events" to key code 48 using option down'],
    "macOS Option+Tab 입력",
  );
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

async function focusPreviousElementBeforePersonRow() {
  return browser.execute(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-testid="person-row"]',
    );
    const tabbable = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden",
    );
    const rowIndex = row ? tabbable.indexOf(row) : -1;
    const previous = rowIndex > 0 ? tabbable[rowIndex - 1] : null;
    previous?.focus();
    return previous !== null && document.activeElement === previous;
  });
}

async function personRowFocusContract() {
  return browser.execute(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-testid="person-row"]',
    );
    const style = row ? getComputedStyle(row) : null;
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--accent)";
    document.body.append(accentProbe);
    const accent = getComputedStyle(accentProbe).color;
    accentProbe.remove();
    return {
      active: document.activeElement === row,
      focusVisible: row?.matches(":focus-visible") ?? false,
      width: style?.outlineWidth ?? "",
      offset: style?.outlineOffset ?? "",
      style: style?.outlineStyle ?? "",
      colorMatchesAccent: style?.outlineColor === accent,
    };
  });
}

async function personRowFocusRule() {
  return browser.execute(() => {
    const rules = [...document.styleSheets].flatMap((sheet) => [
      ...sheet.cssRules,
    ]);
    const rule = rules.find(
      (candidate): candidate is CSSStyleRule =>
        candidate instanceof CSSStyleRule &&
        candidate.selectorText === ".person-row:focus-visible",
    );
    return {
      outline: rule?.style.outline ?? "",
      offset: rule?.style.outlineOffset ?? "",
    };
  });
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

async function managementScrollContract() {
  return browser.execute(() => {
    const list = document.querySelector<HTMLElement>(
      ".management-person-list",
    )!;
    const detail = document.querySelector<HTMLElement>(
      '[data-testid="person-detail"]',
    )!;
    const root = document.querySelector<HTMLElement>("#root")!;
    document
      .querySelectorAll('[data-management-scroll-fixture="true"]')
      .forEach((fixture) => fixture.remove());
    for (const panel of [list, detail]) {
      panel.style.removeProperty("height");
      panel.style.removeProperty("min-height");
      panel.style.removeProperty("max-height");
    }
    const panelHeights = [list.clientHeight, detail.clientHeight];
    for (const [index, panel] of [list, detail].entries()) {
      const height = panelHeights[index];
      panel.style.height = `${height}px`;
      panel.style.minHeight = "0";
      panel.style.maxHeight = `${height}px`;
      const fixture = document.createElement("div");
      fixture.dataset.managementScrollFixture = "true";
      fixture.setAttribute("aria-hidden", "true");
      fixture.style.height = `${height + 160}px`;
      fixture.style.minHeight = `${height + 160}px`;
      fixture.style.width = "1px";
      fixture.style.pointerEvents = "none";
      panel.append(fixture);
    }
    const documentNodes = [document.documentElement, document.body, root];
    for (const node of documentNodes) node.scrollTop = 0;
    window.scrollTo(0, 0);
    list.scrollTop = 0;
    detail.scrollTop = 0;

    const documentScrolls = () => [
      window.scrollX,
      window.scrollY,
      ...documentNodes.map((node) => node.scrollTop),
    ];
    const initialDocumentScrolls = documentScrolls();

    list.scrollTop = Math.min(64, list.scrollHeight - list.clientHeight);
    const listAfterListMove = list.scrollTop;
    const detailAfterListMove = detail.scrollTop;
    const documentAfterListMove = documentScrolls();

    detail.scrollTop = Math.min(64, detail.scrollHeight - detail.clientHeight);
    const detailAfterDetailMove = detail.scrollTop;
    const listAfterDetailMove = list.scrollTop;
    const documentAfterDetailMove = documentScrolls();

    return {
      anonymousFixtureCount: document.querySelectorAll(
        '[data-management-scroll-fixture="true"][aria-hidden="true"]',
      ).length,
      listActuallyOverflows: list.scrollHeight > list.clientHeight,
      detailActuallyOverflows: detail.scrollHeight > detail.clientHeight,
      listMoved: listAfterListMove > 0,
      detailStayedWhileListMoved: detailAfterListMove === 0,
      detailMoved: detailAfterDetailMove > 0,
      listStayedWhileDetailMoved: listAfterDetailMove === listAfterListMove,
      documentStayedStill:
        documentAfterListMove.every(
          (value, index) => value === initialDocumentScrolls[index],
        ) &&
        documentAfterDetailMove.every(
          (value, index) => value === initialDocumentScrolls[index],
        ),
      documentFits: documentNodes.every(
        (node) =>
          node.scrollWidth === node.clientWidth &&
          node.scrollHeight === node.clientHeight,
      ),
      panelOverflow: [
        getComputedStyle(list).overflowY,
        getComputedStyle(detail).overflowY,
      ],
      listPanelMinHeight: getComputedStyle(
        list.closest<HTMLElement>(".management-list-panel")!,
      ).minHeight,
      detailPanelMinHeight: getComputedStyle(detail).minHeight,
      listScrollbarGutter: getComputedStyle(list).scrollbarGutter,
      detailScrollbarGutter: getComputedStyle(detail).scrollbarGutter,
    };
  });
}

async function prepareManagementCapture(
  theme: "light" | "dark",
  query: string,
  applicant: string,
  phone: string,
  comparisonPhone: string,
  personNote: string,
  linkedCheck: string,
) {
  await browser.execute((targetTheme) => {
    localStorage.setItem("qt-manager-theme", targetTheme);
  }, theme);
  await refreshApp(`${theme} 테마 캡처를 위한 새로고침에 실패했습니다.`);
  await browser.setWindowSize(2000, 1440);
  await browser.execute(() => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
      ?.click();
  });
  await waitForText("h2", "신청자 관리");
  await setInput('[data-testid="management-search"]', query);
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.querySelectorAll('[data-testid="management-person"]')
            .length === 2,
      ),
    { timeoutMsg: `${theme} 테마에서 관리 신청자 2명을 찾지 못했습니다.` },
  );
  await selectManagementPerson(applicant);
  await waitForText('[data-testid="person-detail"]', phone);
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          [
            ...document.querySelectorAll<HTMLButtonElement>(
              ".detail-actions button",
            ),
          ]
            .map((button) => button.textContent?.trim() ?? "")
            .join("|") === "정보 수정|구독 추가·갱신",
      ),
    { timeoutMsg: `${theme} 테마에서 상세 버튼 전문이 준비되지 않았습니다.` },
  );
  await browser.execute(() => {
    delete document.documentElement.dataset.managementCaptureReady;
    let scheduled = false;
    const afterFonts = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          document.documentElement.dataset.managementCaptureReady = "true";
        }),
      );
    };
    void document.fonts.ready.then(afterFonts, afterFonts);
    if (document.fonts.status === "loaded") afterFonts();
    // WebKit can report loaded fonts without resolving `document.fonts.ready`
    // promptly after a Tauri navigation. Keep the capture contract deterministic
    // while still waiting for two animation frames when the promise is healthy.
    window.setTimeout(afterFonts, 500);
    window.setTimeout(() => {
      if (!document.documentElement.dataset.managementCaptureReady) {
        document.documentElement.dataset.managementCaptureReady = "true";
      }
    }, 1_000);
  });
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.documentElement.dataset.managementCaptureReady === "true",
      ),
    {
      timeoutMsg: `${theme} 테마의 폰트와 연속 프레임이 안정화되지 않았습니다.`,
    },
  );
  return browser.execute(
    (fixture) => {
      const detail = document.querySelector<HTMLElement>(
        '[data-testid="person-detail"]',
      )!;
      const list = document.querySelector<HTMLElement>(
        ".management-person-list",
      )!;
      const actionContract = (
        button: HTMLButtonElement,
        expectedClass: string,
      ) => {
        const rect = button.getBoundingClientRect();
        return {
          text: button.textContent?.trim() ?? "",
          expectedClass,
          hasExpectedClass: button.classList.contains(expectedClass),
          hasOppositeClass: button.classList.contains(
            expectedClass === "primary-button"
              ? "secondary-button"
              : "primary-button",
          ),
          height: Math.round(rect.height),
          insideViewport:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight,
        };
      };
      const headingButtons = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".heading-actions button",
        ),
      ];
      const detailButtons = [
        ...detail.querySelectorAll<HTMLButtonElement>(".detail-actions button"),
      ];
      const selectedRows = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="management-person"][aria-pressed="true"]',
        ),
      ];
      const panelLine = getComputedStyle(
        document.querySelector<HTMLElement>(".management-grid")!,
      ).borderTopColor;
      const distributionLines = [
        ...detail.querySelectorAll<HTMLElement>(
          ".distribution-history-header, .distribution-history-row",
        ),
      ];
      const distributionRows = [
        ...detail.querySelectorAll<HTMLElement>(".distribution-history-row"),
      ];
      const documentNodes = [
        document.documentElement,
        document.body,
        document.querySelector<HTMLElement>("#root")!,
      ];
      return {
        theme: document.documentElement.dataset.theme,
        fontsStatus: document.fonts.status,
        headingActionContracts: headingButtons.map((button, index) =>
          actionContract(
            button,
            index === headingButtons.length - 1
              ? "primary-button"
              : "secondary-button",
          ),
        ),
        detailActionContracts: detailButtons.map((button, index) =>
          actionContract(
            button,
            index === 0 ? "secondary-button" : "primary-button",
          ),
        ),
        currentStateCount: detail.querySelectorAll(
          '[data-testid="subscription-current"]',
        ).length,
        pastStateCount: detail.querySelectorAll(
          '[data-testid="subscription-past"]',
        ).length,
        selectedRowCount: selectedRows.length,
        selectedApplicant:
          selectedRows.length === 1 &&
          Boolean(selectedRows[0].textContent?.includes(fixture.applicant)),
        personNoteVisible:
          detail
            .querySelector('[data-testid="person-note"]')
            ?.textContent?.includes(fixture.personNote) ?? false,
        linkedCheckVisible:
          detail
            .querySelector('[data-testid="linked-check-items"]')
            ?.textContent?.includes(fixture.linkedCheck) ?? false,
        distributionHeaders: [
          ...detail.querySelectorAll<HTMLElement>(
            '[data-testid="distribution-history-header"] strong',
          ),
        ].map((header) => header.textContent?.trim() ?? ""),
        distributionRowCount: distributionRows.length,
        distributionRowLineMatchesPanel:
          distributionRows.length > 0 &&
          distributionRows.every(
            (row) => getComputedStyle(row).borderBottomColor === panelLine,
          ),
        listHasFixturePhone: [fixture.phone, fixture.comparisonPhone].some(
          (fixturePhone) => list.textContent?.includes(fixturePhone),
        ),
        detailHasFixturePhone: detail.textContent?.includes(fixture.phone),
        distributionLineMatchesPanel:
          distributionLines.length > 0 &&
          distributionLines.every(
            (row) => getComputedStyle(row).borderBottomColor === panelLine,
          ),
        documentFits: documentNodes.every(
          (node) =>
            node.scrollWidth === node.clientWidth &&
            node.scrollHeight === node.clientHeight,
        ),
      };
    },
    { applicant, phone, comparisonPhone, personNote, linkedCheck },
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
  await browser.execute((selectedLabels) => {
    for (const label of document.querySelectorAll<HTMLLabelElement>(
      ".filter-popover > label",
    )) {
      const input = label.querySelector<HTMLInputElement>("input");
      const shouldCheck = selectedLabels.includes(
        label.textContent?.trim() ?? "",
      );
      if (input && input.checked !== shouldCheck) input.click();
    }
  }, labels);
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

async function clickPinnedNoteMenu(noteId: string) {
  await browser.execute((id) => {
    const note = [
      ...document.querySelectorAll<HTMLElement>(".pinned-note"),
    ].find((candidate) => candidate.dataset.noteId === id);
    note
      ?.querySelector<HTMLButtonElement>('button[aria-label="고정 메모 메뉴"]')
      ?.click();
  }, noteId);
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
