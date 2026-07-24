describe("QT Manager desktop vertical slices", () => {
  it("runs SQLite and XLSX through the packaged Tauri command", async () => {
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.title)) === "QT Manager",
      { timeoutMsg: "QT Manager 화면이 준비되지 않았습니다." },
    );

    await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>("button");
      if (!button) {
        throw new Error("기술 검증 버튼을 찾지 못했습니다.");
      }
      button.click();
    });

    await browser.waitUntil(
      async () => {
        const text = await browser.execute(
          () => document.querySelector(".result")?.textContent ?? "",
        );
        return text.includes("기술 검증 통과") && text.includes("형식 v1");
      },
      { timeoutMsg: "SQLite·XLSX 수직 기술 검증이 완료되지 않았습니다." },
    );
  });

  it("persists phase 1 subscription, distribution and change history", async () => {
    await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="phase1-probe"]',
      );
      if (!button) {
        throw new Error("Phase 1 핵심 검증 버튼을 찾지 못했습니다.");
      }
      button.click();
    });

    await browser.waitUntil(
      async () => {
        const text = await browser.execute(
          () => document.querySelector(".phase1-result")?.textContent ?? "",
        );
        return (
          text.includes("Phase 1 핵심 검증 통과") &&
          text.includes("DB v2") &&
          text.includes("2/2권 배부 완료") &&
          text.includes("변경 이력 2건")
        );
      },
      { timeoutMsg: "Phase 1 SQLite 핵심 흐름 검증이 완료되지 않았습니다." },
    );
  });
});
