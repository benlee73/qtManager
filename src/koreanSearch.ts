const INITIAL = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const VOWEL = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const FINAL = [..." ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];
const COMPOUND: Record<string, string> = {
  ㅘ: "ㅗㅏ",
  ㅙ: "ㅗㅐ",
  ㅚ: "ㅗㅣ",
  ㅝ: "ㅜㅓ",
  ㅞ: "ㅜㅔ",
  ㅟ: "ㅜㅣ",
  ㅢ: "ㅡㅣ",
  ㄳ: "ㄱㅅ",
  ㄵ: "ㄴㅈ",
  ㄶ: "ㄴㅎ",
  ㄺ: "ㄹㄱ",
  ㄻ: "ㄹㅁ",
  ㄼ: "ㄹㅂ",
  ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ",
  ㄿ: "ㄹㅍ",
  ㅀ: "ㄹㅎ",
  ㅄ: "ㅂㅅ",
};
export function normalizedSearch(value: string) {
  return value.normalize("NFC").replace(/\s/g, "").toLowerCase();
}
function keys(value: string) {
  return [...normalizedSearch(value)]
    .map((char) => {
      const offset = char.codePointAt(0)! - 0xac00;
      if (offset < 0 || offset >= 11172) return COMPOUND[char] ?? char;
      const vowel = VOWEL[Math.floor(offset / 28) % 21];
      const final = offset % 28 ? FINAL[offset % 28] : "";
      return (
        INITIAL[Math.floor(offset / 588)] +
        (COMPOUND[vowel] ?? vowel) +
        (COMPOUND[final] ?? final)
      );
    })
    .join("");
}
export function matchesKorean(value: string, query: string): boolean {
  const needle = normalizedSearch(query);
  if (!needle) return true;
  const text = normalizedSearch(value);
  if (text.includes(needle) || keys(text).includes(keys(needle))) return true;
  if (![...needle].every((c) => INITIAL.includes(c))) return false;
  const initials = [...text]
    .map((c) => {
      const offset = c.codePointAt(0)! - 0xac00;
      return offset >= 0 && offset < 11172
        ? INITIAL[Math.floor(offset / 588)]
        : c;
    })
    .join("");
  return initials.includes(needle);
}
