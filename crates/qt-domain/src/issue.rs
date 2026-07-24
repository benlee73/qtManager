use serde::{Deserialize, Serialize};

use crate::DomainError;

const START_MONTHS: [u8; 6] = [1, 3, 5, 7, 9, 11];

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub year: i32,
    pub start_month: u8,
}

impl Issue {
    pub fn new(year: i32, start_month: u8) -> Result<Self, DomainError> {
        if year < 1 {
            return Err(DomainError::InvalidIssueYear(year));
        }
        if !START_MONTHS.contains(&start_month) {
            return Err(DomainError::InvalidIssueMonth(start_month));
        }
        Ok(Self { year, start_month })
    }

    pub fn advance(self, count: u16) -> Self {
        let zero_based =
            i64::from(self.year - 1) * 6 + i64::from((self.start_month - 1) / 2) + i64::from(count);
        Self {
            year: i32::try_from(zero_based / 6 + 1).expect("QT 호 연도가 i32 범위를 벗어남"),
            start_month: START_MONTHS[(zero_based % 6) as usize],
        }
    }

    pub fn display_name(self) -> String {
        format!(
            "{}년 {}~{}월호",
            self.year,
            self.start_month,
            self.start_month + 1
        )
    }

    pub fn end_date(self) -> String {
        let end_month = self.start_month + 1;
        let day = match end_month {
            2 if is_leap_year(self.year) => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        format!("{}-{end_month:02}-{day:02}", self.year)
    }
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advances_across_year_boundary() {
        let november = Issue::new(2026, 11).unwrap();

        assert_eq!(november.advance(1), Issue::new(2027, 1).unwrap());
        assert_eq!(november.advance(6), Issue::new(2027, 11).unwrap());
    }

    #[test]
    fn shows_last_day_of_issue_including_leap_year() {
        assert_eq!(Issue::new(2028, 1).unwrap().end_date(), "2028-02-29");
        assert_eq!(Issue::new(2027, 11).unwrap().end_date(), "2027-12-31");
    }

    #[test]
    fn rejects_even_start_month() {
        assert_eq!(Issue::new(2026, 2), Err(DomainError::InvalidIssueMonth(2)));
    }
}
