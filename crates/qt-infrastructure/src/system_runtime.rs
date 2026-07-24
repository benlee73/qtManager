use qt_application::{Clock, IdGenerator};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use uuid::Uuid;

#[derive(Default)]
pub struct SystemRuntime;

impl Clock for SystemRuntime {
    fn now(&self) -> String {
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("RFC 3339 시스템 시각 포맷은 항상 유효함")
    }

    fn today(&self) -> String {
        let seoul = UtcOffset::from_hms(9, 0, 0).expect("서울 시간대 오프셋은 유효함");
        OffsetDateTime::now_utc()
            .to_offset(seoul)
            .date()
            .to_string()
    }
}

impl IdGenerator for SystemRuntime {
    fn next_id(&self) -> String {
        Uuid::new_v4().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_produces_rfc3339_time_date_and_unique_ids() {
        let runtime = SystemRuntime;
        let timestamp = runtime.now();

        assert!(OffsetDateTime::parse(&timestamp, &Rfc3339).is_ok());
        assert_eq!(runtime.today().len(), 10);
        assert_ne!(runtime.next_id(), runtime.next_id());
    }
}
