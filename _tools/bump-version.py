"""Bump Locust's version and put this release's CHANGELOG entry on top.

    python _tools/bump-version.py 0.562.0 entry.md

`entry.md` is the release's whole entry, starting with its heading line,
`## 0.562.0 - 2026-10-04`, then `### Added` / `### Changed` / `### Fixed`
sections in the CHANGELOG's own voice (what the person sees; no testers'
names). The entry goes above the newest release; apps/desktop/package.json's
version moves to the new one. Both files are written byte for byte as they
were otherwise: newline='' keeps their line endings (CRLF once broke the
mutation anchors).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    version, entry_path = sys.argv[1], Path(sys.argv[2])
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit(f"not a version: {version}")
    entry = entry_path.read_text(encoding="utf-8")
    if not entry.startswith(f"## {version} - "):
        sys.exit(f"the entry must start with '## {version} - <date>'")
    entry = entry.rstrip("\n") + "\n\n"

    pkg = ROOT / "apps" / "desktop" / "package.json"
    text = pkg.open(encoding="utf-8", newline="").read()
    found = re.findall(r'"version": "(\d+\.\d+\.\d+)"', text)
    if len(found) != 1:
        sys.exit("package.json has no single version line")
    old = found[0]
    if tuple(map(int, old.split("."))) >= tuple(map(int, version.split("."))):
        sys.exit(f"{version} is not after {old}")
    pkg.open("w", encoding="utf-8", newline="").write(text.replace(f'"version": "{old}"', f'"version": "{version}"'))

    log = ROOT / "CHANGELOG.md"
    text = log.open(encoding="utf-8", newline="").read()
    if f"## {version} - " in text:
        sys.exit(f"CHANGELOG already has {version}")
    newest = re.search(r"^## \d+\.\d+\.\d+ - ", text, re.M)
    if newest is None:
        sys.exit("CHANGELOG has no release heading to go above")
    # The entry takes the file's own line ending, so one file never mixes two.
    if "\r\n" in text:
        entry = entry.replace("\r\n", "\n").replace("\n", "\r\n")
    log.open("w", encoding="utf-8", newline="").write(text[: newest.start()] + entry + text[newest.start():])
    print(f"{old} -> {version}")


if __name__ == "__main__":
    main()
