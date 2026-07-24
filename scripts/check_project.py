from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    agents = read_required("AGENTS.md")
    spec = read_required("PROJECT_SPEC.md")

    if "PROJECT_SPEC.md" not in agents:
        raise AssertionError("AGENTS.md가 PROJECT_SPEC.md를 참조해야 합니다.")

    requirement_ids = re.findall(r"\*\*(FR-[A-Z]+-\d+)\*\*", spec)
    duplicates = sorted(
        requirement_id
        for requirement_id in set(requirement_ids)
        if requirement_ids.count(requirement_id) > 1
    )
    if duplicates:
        raise AssertionError(f"중복 요구사항 ID: {duplicates}")

    required_sections = [
        "## 7. 기능 요구사항",
        "## 12. 테스트 요구사항",
        "## 20. 미결정 사항",
        "## 21. 결정 기록",
    ]
    missing = [section for section in required_sections if section not in spec]
    if missing:
        raise AssertionError(f"필수 문서 절 누락: {missing}")

    secret_pattern = re.compile(r"ghp_[A-Za-z0-9]+")
    excluded_parts = {".git", ".idea", "node_modules", "target", "dist"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or excluded_parts.intersection(path.parts):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if secret_pattern.search(content):
            raise AssertionError(f"GitHub 토큰 형태 문자열 발견: {path.relative_to(ROOT)}")

    print(f"Verified {len(requirement_ids)} unique requirement IDs.")


def read_required(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file() or path.stat().st_size == 0:
        raise AssertionError(f"필수 파일이 없거나 비어 있습니다: {relative_path}")
    return path.read_text(encoding="utf-8")


if __name__ == "__main__":
    main()
