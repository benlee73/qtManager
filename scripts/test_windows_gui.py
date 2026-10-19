import struct
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from check_windows_gui import verify, windows_subsystem


def pe(subsystem: int, magic: int) -> bytes:
    data = bytearray(256)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 64)
    data[64:68] = b"PE\0\0"
    struct.pack_into("<H", data, 88, magic)
    struct.pack_into("<H", data, 156, subsystem)
    return bytes(data)


class WindowsReleaseTests(unittest.TestCase):
    def test_distinguishes_gui_and_console_for_both_pe_variants(self):
        for magic in (0x10B, 0x20B):
            with self.subTest(magic=magic):
                self.assertEqual(windows_subsystem(pe(2, magic)), 2)
                with TemporaryDirectory() as directory:
                    path = Path(directory) / "app.exe"
                    path.write_bytes(pe(3, magic))
                    with self.assertRaisesRegex(ValueError, "콘솔"):
                        verify(path)
                    path.write_bytes(pe(2, magic))
                    verify(path)

    def test_rejects_truncated_or_invalid_headers(self):
        for data in (b"", b"MZ", b"MZ" + bytes(62), pe(2, 0), pe(2, 0x20B)[:100]):
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                windows_subsystem(data)


if __name__ == "__main__":
    unittest.main()
