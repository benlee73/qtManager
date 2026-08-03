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

    await clickButtonByText("", `${applicant} 메뉴`);
    await clickButtonByText("일부만 배부");
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

  it("searches by cohort and phone, blocks an expired subscription, renews it, and marks a last issue", async () => {
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
      await browser.execute(
        () =>
          document.querySelector<HTMLButtonElement>(
            '[data-testid="distribute"]',
          )?.disabled,
      ),
    ).toBe(true);

    await setInput(
      '[data-testid="people-search"]',
      expiredPhone.replaceAll("-", ""),
    );
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
    await waitForText('[data-testid="person-row"]', "까지");
  });

  it("creates linked and general check items, transitions all states, and keeps pinned notes periodless", async () => {
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

    await browser.execute(() => {
      document
        .querySelector('[data-testid="person-row"]')
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await waitForText(".menu-popover", "확인할 일 추가");
    await clickButtonByText("확인할 일 추가");
    await waitForText("#dialog-title", "확인할 일 추가");
    await setInput("textarea[name='content']", linkedItem);
    await clickButtonByText("확인할 일 저장");
    await waitForText(".check-item-list", linkedItem);
    await waitForText(".check-item-list", "연결");
    expect(
      await browser.execute(
        () =>
          document.querySelector(".person-check-indicator") !== null &&
          document.querySelector(".person-name small") === null,
      ),
    ).toBe(true);

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

  it("keeps one action menu open, closes it outside, toggles selection and filters the list", async () => {
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
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(".table-title")
        ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(
      await browser.execute(
        () => document.querySelectorAll(".menu-popover").length,
      ),
    ).toBe(0);

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.click();
    });
    expect(
      await browser.execute(() =>
        document
          .querySelector('[data-testid="person-row"]')
          ?.getAttribute("aria-selected"),
      ),
    ).toBe("true");
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('[data-testid="person-row"]')
        ?.click();
    });
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
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(".table-title")
        ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

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
    expect(await textOf(".filter-trigger")).toBe("남은 배부 · 2");
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

  it("persists theme and keeps the resizable scroll-safe four-stat layout", async () => {
    // macOS가 이전 개발 실행의 창 크기를 복원할 수 있으므로 기준 크기로 맞춘다.
    await browser.setWindowSize(2000, 1440);
    await browser.execute(() => {
      localStorage.removeItem("qt-manager-theme");
    });
    await refreshApp("새로고침 뒤 기본 테마가 적용되지 않았습니다.");
    await configureOperatorIfNeeded();
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
        infoAfterOperator: Boolean(
          operator.compareDocumentPosition(info) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        logoClip: getComputedStyle(
          document.querySelector<HTMLElement>(".book-logo")!,
        ).clipPath,
      };
    });
    expect(brand.wordmark).toBe("QTManager");
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
    expect(issueAfter.gap).toBe("0px");
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
    expect(lightScrollbarStyle).not.toBe(darkScrollbarStyle);
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
      const checkStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".check-item-list")!,
      );
      const pinnedStyle = getComputedStyle(
        document.querySelector<HTMLElement>(".pinned-list")!,
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
      };
    });
    expect(layout.labels).toEqual(["대상", "완료", "남음", "배부"]);
    expect(new Set(layout.sizes.map(String)).size).toBe(1);
    expect(layout.rootOverflow).toBe("hidden/hidden");
    expect(layout.bodyOverflow).toBe("hidden/hidden");
    expect(layout.bodyFits).toBe(true);
    expect(layout.internal).toEqual(["auto", "auto", "auto"]);
    expect(layout.numericStyle).toContain("tabular-nums");
    expect(layout.rail).toEqual({
      left: 0,
      width: 76,
      height: layout.rail.viewportHeight,
      viewportHeight: layout.rail.viewportHeight,
      activeCount: 1,
    });
    expect(layout.deskLeft).toBe(76);
    expect(layout.stickyInputHeight).toBeLessThanOrEqual(104);

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
      resizable: true,
    });
    // WebDriver 크기는 Retina 물리 픽셀 기준이고 Tauri 계약은 논리 픽셀 기준이다.
    await browser.setWindowSize(2200, 1560);
    const resized = await invokeTauri<{
      width: number;
      height: number;
      resizable: boolean;
    }>("main_window_contract_command");
    expect(resized.resizable).toBe(true);
    expect(resized.width).toBeGreaterThanOrEqual(1090);
    expect(resized.height).toBeGreaterThanOrEqual(770);
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

  it("registers, edits, renews and archives a person from management", async () => {
    const unique = String(Date.now()).slice(-8);
    const applicant = `가상관리${unique}`;
    const edited = `${applicant}수정`;
    const registrationPhone = `010-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const editedPhone = `011-${unique.slice(0, 4)}-${unique.slice(4)}`;
    const renewalIssue = shiftIssue(await selectedIssue(), 6);

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
    await waitForText("h2", "신청자 정보와 전체 이력");
    mkdirSync("test-results", { recursive: true });
    await browser.saveScreenshot("test-results/ui-management-light.png");
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
    await waitForText('[data-testid="person-detail"]', "연속 6개 호");

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
    await waitForText('[data-testid="support-info"]', "0.1.0");
    await waitForText(
      '[data-testid="help-app-info"]',
      "이름·전화번호·메모는 기록하지 않습니다",
    );
    await waitForText(
      '[data-testid="help-distribution"]',
      "현장 배부 표는 구독과 배부 상태를 넓게 보여주기 위해",
    );
    await clickButtonByText("", "도움말 닫기");
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
