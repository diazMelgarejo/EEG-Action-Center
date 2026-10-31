"""Refuses to pass a folder that holds private data. Run it on the exact files before every push.

    python3 -B check_public_safe.py <folder> --blocklist <file>

The blocklist lives outside every repository and holds SHA-256 hashes only, so it contains no readable private value
(make a line with --hash VALUE). With no blocklist the check fails. It reads text files, the inside of zip and xlsx files, and raw image bytes.
Generic rules catch what a blocklist cannot know: addresses outside reserved example domains, home paths, tokens, Google file links and private file types.
"""
import argparse
import hashlib
import io
import re
import sys
import zipfile
from pathlib import Path

ALLOWED_MAIL = re.compile(r"@(?:[a-z0-9-]+\.)*(?:example\.(?:org|com|net)|[a-z0-9-]+\.example)$", re.I)
MAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
GENERIC = {
    "home path": re.compile(r"/(?:Users|home)/[a-z][a-z0-9_-]+"),
    "token": re.compile(r"\b(?:sk-[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]{20,})"),
    "google file link": re.compile(r"(?:docs|drive)\.google\.com/[a-z]+/(?:u/\d+/)?d/[A-Za-z0-9_-]{20,}"),
    "lab count": re.compile(r"(?i)\b\w*lab(?:s|_?count|_?tiles?)?\s*(?:\(|=|:)\s*\d{2,}\b"),  # a real count is too short for any hash list; fixtures use one digit
    "hosted app link": re.compile(r"\b[a-z0-9-]+\.run\.app\b|ai\.studio/apps/[0-9a-f-]{20,}"),
}
FORBIDDEN_FILES = re.compile(r"(?:^|/)(?:parity\.json|\.env[^/]*)$|\.(?:csv|tsv|sqlite|db|jsonl)$", re.I)
WHOLE_TOKEN_MAX = 5  # short values such as serial numbers match whole tokens only


def hash_value(value: str) -> str:
    text = value.strip().lower()
    return f"{len(text)}:{hashlib.sha256(text.encode()).hexdigest()}"


def load_blocklist(path: Path) -> dict[int, set[str]]:
    by_length: dict[int, set[str]] = {}
    for line in path.read_text().split():
        length, digest = line.split(":")
        by_length.setdefault(int(length), set()).add(digest)
    if not by_length:
        raise ValueError("The blocklist is empty.")
    return by_length


def blocked(text: str, by_length: dict[int, set[str]]) -> int:
    count = 0
    for token in set(re.findall(r"[a-z0-9]+(?:[._@-][a-z0-9]+)*", text.lower())):
        pieces = {token} | set(re.split(r"[._@-]", token))
        for piece in pieces:
            for length, digests in by_length.items():
                if length <= WHOLE_TOKEN_MAX:
                    count += len(piece) == length and hashlib.sha256(piece.encode()).hexdigest() in digests
                elif len(piece) >= length:
                    count += any(hashlib.sha256(piece[i:i + length].encode()).hexdigest() in digests for i in range(len(piece) - length + 1))
    return count


def scan_text(name: str, text: str, by_length: dict[int, set[str]]) -> list[str]:
    found = [f"{name}: {label}" for label, pattern in GENERIC.items() if pattern.search(text)]
    found += [f"{name}: address outside the example domains" for m in MAIL.findall(text) if not ALLOWED_MAIL.search(m)][:1]
    hits = blocked(text, by_length)
    return found + ([f"{name}: {hits} blocked value(s)"] if hits else [])


def scan_bytes(name: str, data: bytes, by_length: dict[int, set[str]]) -> list[str]:
    if FORBIDDEN_FILES.search(name):
        return [f"{name}: file type that may hold private data"]
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return [f for member in archive.namelist() if not member.endswith("/") for f in scan_bytes(f"{name}!{member}", archive.read(member), by_length)]
    return scan_text(name, data.decode("latin-1"), by_length)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", nargs="?")
    parser.add_argument("--blocklist")
    parser.add_argument("--hash")
    args = parser.parse_args()
    if args.hash:
        print(hash_value(args.hash))
        return 0
    if not args.folder or not args.blocklist or not Path(args.blocklist).is_file():
        print("FAIL: a folder and a blocklist are required; refusing to pass without one.")
        return 2
    by_length = load_blocklist(Path(args.blocklist))
    root = Path(args.folder)
    files = [p for p in sorted(root.rglob("*")) if p.is_file() and ".git/" not in p.as_posix()]
    findings = [f for p in files for f in scan_bytes(p.relative_to(root).as_posix(), p.read_bytes(), by_length)]
    for finding in findings:
        print("FAIL ", finding)
    print(f"{len(files)} files scanned; {len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
