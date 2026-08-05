from __future__ import annotations

import re
import json
import struct
import zlib
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
    verify_icon_transparency()
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
    windows = tauri.get("app", {}).get("windows", [])
    main_window = next(
        (window for window in windows if window.get("label") == "main"), None
    )
    expected_window = {
        "width": 1000,
        "height": 720,
        "minWidth": 900,
        "minHeight": 640,
        "resizable": True,
    }
    if main_window is None or any(
        main_window.get(key) != value for key, value in expected_window.items()
    ):
        raise AssertionError(
            "메인 창 계약이 1000x720(최소 900x640, 크기 조절 가능)과 다릅니다."
        )
    if tauri["bundle"].get("active") is not True:
        raise AssertionError("Tauri 설치 패키지 생성이 비활성화되어 있습니다.")
    icons = tauri["bundle"].get("icon", [])
    if not {"icons/icon.icns", "icons/icon.ico"}.issubset(icons):
        raise AssertionError("macOS와 Windows 앱 아이콘이 패키지에 설정되지 않았습니다.")


def verify_icon_transparency() -> None:
    width, height, pixels = read_rgba_png(ROOT / "src-tauri/icons/icon.png")
    corners = [pixels[0], pixels[width - 1], pixels[-width], pixels[-1]]
    if any(alpha != 0 for *_, alpha in corners):
        raise AssertionError("앱 아이콘 모서리는 완전히 투명해야 합니다.")

    visible = [
        (index % width, index // width, pixel)
        for index, pixel in enumerate(pixels)
        if pixel[3] > 32
    ]
    xs = [x for x, _, _ in visible]
    ys = [y for _, y, _ in visible]
    width_ratio = (max(xs) - min(xs) + 1) / width
    height_ratio = (max(ys) - min(ys) + 1) / height
    if min(width_ratio, height_ratio) < 0.88:
        raise AssertionError("앱 아이콘 본체가 캔버스에 비해 너무 작습니다.")

    edge_limit = round(min(width, height) * 0.05)
    outside_white = [
        pixel
        for x, y, pixel in visible
        if (x < edge_limit or x >= width - edge_limit or y < edge_limit or y >= height - edge_limit)
        and min(pixel[:3]) >= 235
    ]
    if outside_white:
        raise AssertionError("앱 아이콘 외곽에 밝은 테두리나 후광이 남아 있습니다.")


def read_rgba_png(path: Path) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"PNG 형식이 아닙니다: {path.relative_to(ROOT)}")

    position = 8
    compressed = bytearray()
    width = height = 0
    while position < len(data):
        length = struct.unpack(">I", data[position : position + 4])[0]
        chunk_type = data[position + 4 : position + 8]
        payload = data[position + 8 : position + 8 + length]
        position += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", payload[:10])
            if (bit_depth, color_type) != (8, 6):
                raise AssertionError("검증할 앱 아이콘은 8비트 RGBA PNG여야 합니다.")
        elif chunk_type == b"IDAT":
            compressed.extend(payload)
        elif chunk_type == b"IEND":
            break

    row_bytes = width * 4
    raw = zlib.decompress(bytes(compressed))
    rows: list[bytearray] = []
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        current = bytearray(raw[offset + 1 : offset + 1 + row_bytes])
        previous = rows[-1] if rows else bytearray(row_bytes)
        for index in range(row_bytes):
            left = current[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                current[index] = (current[index] + left) & 0xFF
            elif filter_type == 2:
                current[index] = (current[index] + above) & 0xFF
            elif filter_type == 3:
                current[index] = (current[index] + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + above - upper_left
                nearest = min(
                    (left, above, upper_left),
                    key=lambda value: abs(estimate - value),
                )
                current[index] = (current[index] + nearest) & 0xFF
            elif filter_type != 0:
                raise AssertionError(f"지원하지 않는 PNG 필터입니다: {filter_type}")
        rows.append(current)
        offset += row_bytes + 1

    pixels = [
        tuple(row[index : index + 4])
        for row in rows
        for index in range(0, row_bytes, 4)
    ]
    return width, height, pixels


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
