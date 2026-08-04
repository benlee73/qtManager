import { describe, expect, it } from "vitest";

import { createDistributionLoader } from "./distributionLoader";

describe("distribution loader", () => {
  it("ignores a slower response from an older search request", async () => {
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    const load = (query: string) =>
      new Promise<string>((resolve) => {
        if (query === "old") resolveOld = resolve;
        else resolveNew = resolve;
      });
    const loader = createDistributionLoader(load);

    const oldResult = loader.load("old");
    const newResult = loader.load("new");
    resolveNew("new-result");
    resolveOld("old-result");

    await expect(newResult).resolves.toBe("new-result");
    await expect(oldResult).resolves.toBeNull();
  });
});
