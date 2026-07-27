from __future__ import annotations

import re
import json
from pathlib import Path
import tomllib


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

    verify_release_metadata()
    verify_offline_runtime()
    verify_log_privacy_boundary()

    print(f"Verified {len(requirement_ids)} unique requirement IDs.")


def read_required(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file() or path.stat().st_size == 0:
        raise AssertionError(f"필수 파일이 없거나 비어 있습니다: {relative_path}")
    return path.read_text(encoding="utf-8")


def verify_release_metadata() -> None:
    package = json.loads(read_required("package.json"))
    tauri = json.loads(read_required("src-tauri/tauri.conf.json"))
    cargo = tomllib.loads(read_required("Cargo.toml"))
    versions = {
        str(package["version"]),
        str(tauri["version"]),
        str(cargo["workspace"]["package"]["version"]),
    }
    if len(versions) != 1:
        raise AssertionError(f"릴리스 버전 불일치: {sorted(versions)}")
    if tauri["identifier"] != "kr.or.malgunsaem.qtmanager":
        raise AssertionError("배포 식별자가 예고 없이 바뀌었습니다.")
    if tauri["bundle"].get("active") is not True:
        raise AssertionError("Tauri 설치 패키지 생성이 비활성화되어 있습니다.")


def verify_offline_runtime() -> None:
    remote_pattern = re.compile(r"""(?:src|href)=["']https?://""")
    for relative in ["index.html", "src"]:
        path = ROOT / relative
        candidates = [path] if path.is_file() else path.rglob("*")
        for candidate in candidates:
            if not candidate.is_file() or candidate.suffix not in {".html", ".ts", ".tsx", ".css"}:
                continue
            content = candidate.read_text(encoding="utf-8")
            if remote_pattern.search(content):
                raise AssertionError(
                    f"런타임 원격 리소스 참조 발견: {candidate.relative_to(ROOT)}"
                )


def verify_log_privacy_boundary() -> None:
    rust_sources = [
        *sorted((ROOT / "crates").rglob("*.rs")),
        *sorted((ROOT / "src-tauri" / "src").rglob("*.rs")),
    ]
    unsafe_call = re.compile(r"\.(?:info|error)\(\s*(?!(?:\"[a-z0-9_]+\"|concat!\())")
    for path in rust_sources:
        content = path.read_text(encoding="utf-8")
        if unsafe_call.search(content):
            raise AssertionError(
                f"운영 로그에는 고정 이벤트명만 사용할 수 있습니다: {path.relative_to(ROOT)}"
            )


if __name__ == "__main__":
    main()
