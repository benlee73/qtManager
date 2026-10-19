"""Reject console-subsystem applications in the Windows release smoke test."""
from pathlib import Path
import struct
import sys


def windows_subsystem(data: bytes) -> int:
    if len(data) < 64 or data[:2] != b"MZ":
        raise ValueError("Windows PE 실행 파일이 아닙니다.")
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    optional = offset + 24
    if optional + 70 > len(data) or data[offset:offset + 4] != b"PE\0\0":
        raise ValueError("Windows PE 헤더가 손상됐습니다.")
    magic = struct.unpack_from("<H", data, optional)[0]
    if magic not in (0x10B, 0x20B):
        raise ValueError("지원하지 않는 PE 선택 헤더입니다.")
    return struct.unpack_from("<H", data, optional + 68)[0]


def verify(path: Path) -> None:
    if windows_subsystem(path.read_bytes()) != 2:
        raise ValueError("배포 앱에 콘솔 창이 설정되어 있습니다. GUI subsystem이 필요합니다.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
    print("Verified Windows GUI subsystem.")
