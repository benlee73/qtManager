use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use qt_application::AppLogger;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const MAX_LOG_BYTES: u64 = 1_048_576;
const RETAINED_FILES: usize = 5;

/// 운영 로그에는 고정 이벤트 이름만 기록한다. 사용자 입력이나 오류 전문을 받지
/// 않는 인터페이스 자체가 이름·전화번호·메모의 우발적 기록을 막는 경계다.
#[derive(Clone, Debug)]
pub struct RotatingFileEventLogger {
    path: PathBuf,
}

impl RotatingFileEventLogger {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn write(&self, level: &str, event: &'static str) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = self.rotate_if_needed();
        let timestamp = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown-time".into());
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = writeln!(file, "{timestamp} {level} event={event}");
        }
    }

    fn rotate_if_needed(&self) -> std::io::Result<()> {
        let Ok(metadata) = fs::metadata(&self.path) else {
            return Ok(());
        };
        if metadata.len() < MAX_LOG_BYTES {
            return Ok(());
        }

        let oldest = rotated_path(&self.path, RETAINED_FILES);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..RETAINED_FILES).rev() {
            let source = rotated_path(&self.path, index);
            if source.exists() {
                fs::rename(source, rotated_path(&self.path, index + 1))?;
            }
        }
        fs::rename(&self.path, rotated_path(&self.path, 1))
    }
}

impl AppLogger for RotatingFileEventLogger {
    fn info(&self, event: &'static str) {
        self.write("INFO", event);
    }

    fn error(&self, event: &'static str) {
        self.write("ERROR", event);
    }
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_only_timestamp_level_and_fixed_event() {
        let directory = tempfile::tempdir().unwrap();
        let logger = RotatingFileEventLogger::new(directory.path().join("qt-manager.log"));

        logger.info("person_update_completed");
        logger.error("state_import_failed");

        let content = fs::read_to_string(logger.path()).unwrap();
        assert!(content.contains("INFO event=person_update_completed"));
        assert!(content.contains("ERROR event=state_import_failed"));
        assert_eq!(content.lines().count(), 2);
    }

    #[test]
    fn rotates_large_logs_and_keeps_a_bounded_history() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("qt-manager.log");
        let logger = RotatingFileEventLogger::new(&path);

        for index in 0..=RETAINED_FILES {
            fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
            logger.info("rotation_probe");
            assert!(rotated_path(&path, 1).exists(), "rotation {index}");
        }

        assert!(rotated_path(&path, RETAINED_FILES).exists());
        assert!(!rotated_path(&path, RETAINED_FILES + 1).exists());
    }
}
