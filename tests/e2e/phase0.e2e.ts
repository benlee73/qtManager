describe("Phase 0 desktop vertical slice", () => {
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
});
