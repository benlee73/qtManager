import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, readDraft, writeDraft } from "./drafts";

describe("draft storage", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("stores a non-empty draft and clears it when submitted", () => {
    writeDraft("quick-check", "가상 확인 내용");
    expect(readDraft("quick-check")).toBe("가상 확인 내용");

    clearDraft("quick-check");
    expect(readDraft("quick-check")).toBe("");
  });

  it("does not persist whitespace-only input", () => {
    writeDraft("quick-check", "   ");
    expect(readDraft("quick-check")).toBe("");
  });
});
