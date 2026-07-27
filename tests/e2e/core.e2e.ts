import { mkdirSync } from "node:fs";

describe("QT Manager desktop flow", () => {
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

    await configureOperatorIfNeeded();
    const applicant = `가상현장${Date.now()}`;

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-draft"]')
        ?.click();
    });
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

    await clickButtonByText("일부만 배부");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("일부 배부 기록");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1 / 2권"),
      { timeoutMsg: "1권 일부 배부가 화면에 반영되지 않았습니다." },
    );

    await dispatchShortcut("Enter");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("배부 완료") &&
        (await textOf('[data-testid="person-row"]')).includes("2 / 2권"),
      { timeoutMsg: "남은 1권 기본 배부가 완료되지 않았습니다." },
    );

    await dispatchShortcut("z");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1 / 2권"),
      { timeoutMsg: "최근 배부 되돌리기가 반영되지 않았습니다." },
    );
  });

  it("creates linked and general check items, transitions all states, and keeps pinned notes periodless", async () => {
    await setInput("#quick-item", "가상 일반 확인 필요");
    await waitForEnabled('[data-testid="add-general-check-item"]');
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="add-general-check-item"]',
        )
        ?.click();
    });
    await waitForText(".toast", "일반 확인할 일을 추가했습니다");
    await waitForText(".check-item-list", "가상 일반 확인 필요");
    await waitForText(".check-item-list", "일반");

    await browser.execute(() => {
      document
        .querySelector('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await waitForText("#dialog-title", "확인할 일 추가");
    await setInput("textarea[name='content']", "가상 신청자 연결 확인");
    await clickButtonByText("확인할 일 저장");
    await waitForText(".check-item-list", "가상 신청자 연결 확인");
    await waitForText(".check-item-list", "연결");

    await clickButtonByText("확인 완료");
    await waitForText(".check-item-list", "확인 완료");
    await clickButtonByText("다시 확인");
    await waitForText(".check-item-list", "확인 필요");
    await clickButtonByText("보관");

    await clickButtonByText("", "고정 메모 추가");
    await setInput("input[name='title']", "가상 보관 위치");
    await setInput("textarea[name='content']", "가상 예배당 뒤편");
    expect(
      await browser.execute(
        () => document.querySelector("input[name='activeUntil']") === null,
      ),
    ).toBe(true);
    await clickButtonByText("고정 메모 저장");
    await waitForText(".pinned-list", "가상 보관 위치");
    await clickButtonByText("고정 해제");
    await waitForText(".pinned-list", "고정 해제됨");

    await clickButtonByText("현장 개별 구매");
    await setInput("input[name='buyerName']", "가상 구매자");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".toast", "개별 구매와 전달을 기록했습니다");
    await clickButtonByText("최근 구매 취소");
    await waitForText(".toast", "최근 개별 구매를 취소했습니다");
  });

  it("focuses search with slash without stealing text entry", async () => {
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

  it("persists theme and enforces the fixed scroll-safe four-stat layout", async () => {
    await browser.execute(() => {
      localStorage.removeItem("qt-manager-theme");
    });
    await browser.refresh();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.documentElement.dataset.theme ?? null,
        )) !== null,
      { timeoutMsg: "새로고침 뒤 기본 테마가 적용되지 않았습니다." },
    );
    await configureOperatorIfNeeded();
    expect(
      await browser.execute(() => document.documentElement.dataset.theme),
    ).toBe("dark");
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
    await setInput('[data-testid="people-search"]', "일치하지않는가상검색");
    await waitForText(
      '[data-testid="empty-list"]',
      "일치하는 신청자가 없습니다",
    );
    await browser.saveScreenshot("test-results/ui-light-short-list.png");
    await setInput('[data-testid="people-search"]', "");
    await browser.saveScreenshot("test-results/ui-light.png");
    await browser.refresh();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.documentElement.dataset.theme ?? null,
        )) !== null,
      { timeoutMsg: "새로고침 뒤 저장한 테마가 적용되지 않았습니다." },
    );
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
      const checkStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".check-item-list")!,
      );
      const pinnedStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".pinned-list")!,
      );
      return {
        labels: stats.map((item) => item.querySelector("span")?.textContent),
        sizes,
        rootOverflow: `${rootStyle.overflowX}/${rootStyle.overflowY}`,
        bodyOverflow: `${bodyStyle.overflowX}/${bodyStyle.overflowY}`,
        bodyFits:
          document.body.scrollWidth === document.body.clientWidth &&
          document.body.scrollHeight === document.body.clientHeight,
        internal: [
          peopleStyle.overflowY,
          checkStyle.overflowY,
          pinnedStyle.overflowY,
        ],
        numericStyle: getComputedStyle(
          document.querySelector<HTMLElement>(".summary-grid")!,
        ).fontVariantNumeric,
      };
    });
    expect(layout.labels).toEqual(["대상", "완료", "남음", "배부"]);
    expect(new Set(layout.sizes.map(String)).size).toBe(1);
    expect(layout.rootOverflow).toBe("hidden/hidden");
    expect(layout.bodyOverflow).toBe("hidden/hidden");
    expect(layout.bodyFits).toBe(true);
    expect(layout.internal).toEqual(["auto", "auto", "auto"]);
    expect(layout.numericStyle).toContain("tabular-nums");

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
    expect(windowContract).toEqual({
      width: 1000,
      height: 720,
      resizable: false,
    });
  });

  it("registers, edits, renews and archives a person from management", async () => {
    const applicant = `가상관리${Date.now()}`;
    const edited = `${applicant}수정`;

    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 정보와 전체 이력");
    const headingFits = await browser.execute(() => {
      const heading = document
        .querySelector<HTMLElement>(".management-heading")!
        .getBoundingClientRect();
      return [
        ...document.querySelectorAll<HTMLElement>(".heading-actions button"),
      ].every((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.top >= heading.top &&
          rect.bottom <= heading.bottom &&
          rect.right <= heading.right
        );
      });
    });
    expect(headingFits).toBe(true);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-register-person"]',
        )
        ?.click();
    });
    await setInput("input[name='name']", applicant);
    await setInput("input[name='cohort']", "00");
    await setInput("input[name='phone']", "010-0000-2468");
    await setInput("textarea[name='personNote']", "가상 신청자 메모");
    await setInput("input[name='quantity']", "2");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="register-person-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "연간 구독을 등록했습니다");

    await setInput('[data-testid="management-search"]', applicant);
    await waitForText('[data-testid="management-person"]', applicant);
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="management-person"]')
        ?.click();
    });
    await waitForText('[data-testid="person-detail"]', "가상 신청자 메모");
    await waitForText('[data-testid="person-detail"]', "연속 6개 호");

    await clickButtonByText("정보 수정");
    await setInput("input[name='name']", edited);
    await setInput("input[name='phone']", "010-0000-8642");
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
    await setInput("input[name='issueYear']", "2027");
    await setSelect("select[name='issueMonth']", "7");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('[data-testid="renew-form"]')
        ?.requestSubmit();
    });
    await waitForText(".toast", "새 연간 구독을 추가했습니다");
    await waitForText('[data-testid="person-detail"]', "구독 이력 2건");

    await clickButtonByText("이 신청자 보관");
    await waitForText(".toast", "신청자를 보관했습니다");

    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    await waitForText("#help-title", "QT Manager 도움말");
    await waitForText(
      '[data-testid="help-people"]',
      "과거 구독을 수정하지 않고",
    );
    await clickButtonByText("", "도움말 닫기");
    await clickButtonByText("현장 배부");
    await waitForText(".issue-picker", "현장 배부");
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
    await waitForText("h2", "신청자 정보와 전체 이력");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="open-application-import"]',
        )
        ?.click();
    });
    const firstResponse = [
      `2026. 2. 1 오후 7:48:08\t${applicant}\t00\t${phone}\t1-2월호\t2\t네 입금했습니다.`,
      "가상오류\t0\t전화번호\t2월호\t0",
    ].join("\n");
    await setInput('[data-testid="application-paste-input"]', firstResponse);
    await waitForText('[data-testid="application-preview"]', applicant);
    await waitForText('[data-testid="application-preview"]', "또래는");
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
      { timeoutMsg: "Google 응답 추가 결과가 표시되지 않았습니다." },
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
    await waitForText(
      '[data-testid="application-preview"]',
      "이미 추가한 응답",
    );
    await clickButtonByText("", "닫기");
    await clickButtonByText("현장 배부");
  });

  it("exports, replaces, restores and rejects a damaged handover workbook", async () => {
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-management"]')
        ?.click();
    });
    await waitForText("h2", "신청자 정보와 전체 이력");
    await browser.execute(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="open-handover"]')
        ?.click();
    });
    await waitForText("#handover-title", "데이터 인수인계");
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
    expect(preview.formatVersion).toBe(1);
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
    management = await invokeTauri("load_people_management_command", {
      query: unique,
      includeArchived: true,
    });
    expect(management.people).toHaveLength(0);

    const restore = await invokeTauri<{ sourceFileName: string }>(
      "latest_restore_point_command",
    );
    expect(restore.sourceFileName).toBe("handover.xlsx");
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
  const title = await textOf("#dialog-title");
  if (!title.includes("현재 담당자 설정")) return;
  await setInput("input[name='name']", "가상담당자");
  await clickButtonByText("저장하고 시작");
  await browser.waitUntil(async () => (await textOf("#dialog-title")) === "", {
    timeoutMsg: "담당자 설정 창이 닫히지 않았습니다.",
  });
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
