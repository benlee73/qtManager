const INITIAL: &str = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const VOWEL: &str = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const FINAL: &str = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
fn component(c: char) -> String {
    match c {
        'ㅘ' => "ㅗㅏ",
        'ㅙ' => "ㅗㅐ",
        'ㅚ' => "ㅗㅣ",
        'ㅝ' => "ㅜㅓ",
        'ㅞ' => "ㅜㅔ",
        'ㅟ' => "ㅜㅣ",
        'ㅢ' => "ㅡㅣ",
        'ㄳ' => "ㄱㅅ",
        'ㄵ' => "ㄴㅈ",
        'ㄶ' => "ㄴㅎ",
        'ㄺ' => "ㄹㄱ",
        'ㄻ' => "ㄹㅁ",
        'ㄼ' => "ㄹㅂ",
        'ㄽ' => "ㄹㅅ",
        'ㄾ' => "ㄹㅌ",
        'ㄿ' => "ㄹㅍ",
        'ㅀ' => "ㄹㅎ",
        'ㅄ' => "ㅂㅅ",
        _ => return c.to_string(),
    }
    .into()
}
fn keys(value: &str) -> String {
    let mut result = String::new();
    for c in value
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
    {
        let n = c as u32;
        if (0xac00..0xac00 + 11172).contains(&n) {
            let offset = (n - 0xac00) as usize;
            result.push(INITIAL.chars().nth(offset / 588).unwrap());
            result.push_str(&component(VOWEL.chars().nth(offset / 28 % 21).unwrap()));
            if !offset.is_multiple_of(28) {
                result.push_str(&component(FINAL.chars().nth(offset % 28).unwrap()));
            }
        } else {
            result.push_str(&component(c));
        }
    }
    result
}
pub fn matches_korean(value: &str, query: &str) -> bool {
    let needle = crate::normalize_search_text(query);
    if needle.is_empty() || keys(value).contains(&keys(&needle)) {
        return true;
    }
    if !needle.chars().all(|c| INITIAL.contains(c)) {
        return false;
    }
    let initials: String = value
        .chars()
        .map(|c| {
            let n = c as u32;
            if (0xac00..0xac00 + 11172).contains(&n) {
                INITIAL.chars().nth((n - 0xac00) as usize / 588).unwrap()
            } else {
                c
            }
        })
        .collect();
    initials.contains(&needle)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_incomplete_hangul_without_treating_unrelated_vowels_as_typos() {
        for query in [
            "가ㅅ",
            "가사",
            "가상ㅇ",
            "가상우",
            "가상워",
            "ㄱㅅㅇ",
            "가상원",
        ] {
            assert!(matches_korean("가상원", query), "{query}");
        }
        assert!(!matches_korean("가상원", "가상와"));
        assert!(matches_korean("00 가상원", "00가상우"));
    }
}
