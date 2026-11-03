import unittest

from check_project import verify_e2e_workbook_version


class WorkbookVersionContractTest(unittest.TestCase):
    def test_accepts_matching_domain_and_e2e_format_versions(self):
        verify_e2e_workbook_version(
            "pub const STATE_XLSX_FORMAT_VERSION: u16 = 5;",
            "expect(preview.formatVersion).toBe(5);",
        )

    def test_rejects_a_stale_e2e_expectation_before_native_execution(self):
        with self.assertRaisesRegex(AssertionError, "XLSX.*불일치"):
            verify_e2e_workbook_version(
                "pub const STATE_XLSX_FORMAT_VERSION: u16 = 5;",
                "expect(preview.formatVersion).toBe(4);",
            )

    def test_rejects_a_missing_format_assertion(self):
        with self.assertRaises(AssertionError):
            verify_e2e_workbook_version(
                "pub const STATE_XLSX_FORMAT_VERSION: u16 = 5;", ""
            )
