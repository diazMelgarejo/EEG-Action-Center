"""Tests for the public-safety check. Private-looking values are assembled at run time so this file stays clean under its own scan."""
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOL = Path(__file__).with_name("check_public_safe.py")
sys.path.insert(0, str(TOOL.parent))
import check_public_safe as cps  # noqa: E402

WORD = "acme" + "widgets"
SERIAL = "90" + "17"


def run(*args):
    return subprocess.run([sys.executable, "-B", str(TOOL), *args], capture_output=True, text=True)


class Check(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.folder, self.blocklist = base / "pub", base / "blocklist"
        self.folder.mkdir()
        self.blocklist.write_text(f"{cps.hash_value(WORD)}\n{cps.hash_value(SERIAL)}\n")
        (self.folder / "ok.md").write_text("Lab 3 and a.person@example.org are fine, as is 1234.\n")

    def check(self):
        return run(str(self.folder), "--blocklist", str(self.blocklist))

    def add(self, name, data):
        (self.folder / name).write_bytes(data if isinstance(data, bytes) else data.encode())

    def test_a_clean_folder_passes(self):
        self.assertEqual(self.check().returncode, 0)

    def test_it_fails_closed_without_a_blocklist(self):
        self.assertEqual(run(str(self.folder)).returncode, 2)
        self.assertEqual(run(str(self.folder), "--blocklist", "/no/such/file").returncode, 2)

    def test_the_blocklist_holds_no_readable_value(self):
        self.assertNotIn(WORD, self.blocklist.read_text())

    def test_blocked_values_are_found_in_any_form(self):
        for text in (f"see {WORD.upper()} here", f"class {WORD.title()}DeploymentModal", f"name@{WORD}.example", f"serial {SERIAL}."):
            self.add("leak.md", text)
            self.assertEqual(self.check().returncode, 1, text)

    def test_a_short_value_does_not_match_inside_a_longer_number(self):
        self.add("n.md", f"id 4{SERIAL}4")
        self.assertEqual(self.check().returncode, 0)

    def test_generic_rules_need_no_blocklist_entry(self):
        for text in ("mail: lab" + "@real-company.co", "/Us" + "ers/somebody/x", "docs.google.com/spreadsheets/d/" + "a1B2" * 8, "sk-" + "a1" * 10, "x.run" + ".app"):
            self.add("leak.md", text)
            self.assertEqual(self.check().returncode, 1, text)

    def test_private_file_types_are_refused(self):
        for name in ("seed.csv", "parity.json", "log.jsonl"):
            self.add(name, "x")
            self.assertEqual(self.check().returncode, 1, name)
            (self.folder / name).unlink()

    def test_it_looks_inside_zip_and_xlsx_files_at_any_depth(self):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as z:
            z.writestr("xl/sharedStrings.xml", f"<t>{WORD}</t>")
        outer = io.BytesIO()
        with zipfile.ZipFile(outer, "w") as z:
            z.writestr("deep/book.xlsx", inner.getvalue())
        self.add("bundle.zip", outer.getvalue())
        self.assertEqual(self.check().returncode, 1)


if __name__ == "__main__":
    unittest.main()
