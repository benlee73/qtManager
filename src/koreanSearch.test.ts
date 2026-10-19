import { expect, it } from "vitest";
import { matchesKorean } from "./koreanSearch";
it("matches intermediate Hangul keystrokes, compound vowels and final consonants", () => {
  for (const query of [
    "가ㅅ",
    "가사",
    "가상ㅇ",
    "가상우",
    "가상워",
    "ㄱㅅㅇ",
    "가상원",
  ])
    expect(matchesKorean("가상원", query)).toBe(true);
  expect(matchesKorean("가상원", "가상와")).toBe(false);
  expect(matchesKorean("00 가상원", "00가상우")).toBe(true);
});
