describe("QT Manager Phase 2 desktop flow", () => {
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

    await clickButtonByText("일부만");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("일부 배부 기록");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1/2권"),
      { timeoutMsg: "1권 일부 배부가 화면에 반영되지 않았습니다." },
    );

    await dispatchShortcut("Enter");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("배부 완료") &&
        (await textOf('[data-testid="person-row"]')).includes("2/2권"),
      { timeoutMsg: "남은 1권 기본 배부가 완료되지 않았습니다." },
    );

    await dispatchShortcut("z");
    await browser.waitUntil(
      async () =>
        (await textOf('[data-testid="person-row"]')).includes("일부 배부") &&
        (await textOf('[data-testid="person-row"]')).includes("1/2권"),
      { timeoutMsg: "최근 배부 되돌리기가 반영되지 않았습니다." },
    );
  });

  it("persists quick notes, operational notes and one-time purchase separately", async () => {
    await clickButtonByText("+", "현장 기록 추가");
    await setInput("textarea[name='content']", "가상 신청 확인 필요");
    await clickButtonByText("현장 기록 저장");
    await waitForText(".quick-notes", "가상 신청 확인 필요");

    await clickButtonByText("📌 장기 운영 메모 추가");
    await setInput("input[name='title']", "가상 보관 위치");
    await setInput("textarea[name='content']", "가상 예배당 뒤편");
    await clickButtonByText("운영 메모 저장");
    await waitForText(".operation-banner", "가상 보관 위치");

    await clickButtonByText("더보기 · 개별 구매");
    await setInput("input[name='buyerName']", "가상 구매자");
    await setInput("input[name='quantity']", "1");
    await clickButtonByText("구매·전달 기록");
    await waitForText(".purchase-summary", "1건 · 1권");

    await clickButtonByText("최근 건 취소");
    await waitForText(".purchase-summary", "0건 · 0권");
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
    await waitForText("#dialog-title", "현장 기록 추가");
    await clickButtonByText("", "닫기");
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

async function textOf(selector: string) {
  return browser.execute(
    (targetSelector) =>
      document.querySelector(targetSelector)?.textContent?.trim() ?? "",
    selector,
  );
}
