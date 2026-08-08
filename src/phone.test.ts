import { describe, expect, it } from "vitest";

import { formatPhoneInput, normalizePhone } from "./phone";

describe("phone formatting", () => {
  it("inserts separators while the operator types digits", () => {
    expect(formatPhoneInput("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneInput("010-1234-5678")).toBe("010-1234-5678");
  });

  it("ignores pasted punctuation and limits the field to eleven digits", () => {
    expect(formatPhoneInput("010 1234 5678 ext")).toBe("010-1234-5678");
  });

  it("accepts only canonical 010 numbers when saving", () => {
    expect(normalizePhone("01012345678")).toBe("010-1234-5678");
    expect(normalizePhone("010-1234-5678")).toBe("010-1234-5678");
    expect(normalizePhone("011-1234-5678")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
