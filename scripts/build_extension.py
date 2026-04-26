#!/usr/bin/env python3
"""Build a distributable Chrome extension zip from plugins/chrome-extension/.

Strips the dev-only DEV_RELOAD bridge (background.js + content.js) so a
beta tester's installed extension can't be force-reloaded by any page on
docs.google.com. Also drops dev-only files (tests/, package.json) that
beta testers don't need.

Output:
  dist/felix-tm-v<VERSION>/        — unpacked tree (load via "Load unpacked")
  dist/felix-tm-v<VERSION>.zip     — zipped version

Usage: python3 scripts/build_extension.py
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "plugins" / "chrome-extension"
SAMPLES = REPO / "samples"
DIST = REPO / "dist"

# Files / dirs to skip when copying — dev-only or build-only.
EXCLUDE_NAMES = {
    "tests",
    "node_modules",
    "package.json",
    "package-lock.json",
    ".DS_Store",
}


def read_version() -> str:
    return json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))["version"]


def copy_tree(src: Path, dst: Path) -> None:
    """Mirror src → dst with EXCLUDE_NAMES filtering."""
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for entry in src.iterdir():
        if entry.name in EXCLUDE_NAMES:
            continue
        target = dst / entry.name
        if entry.is_dir():
            copy_tree(entry, target)
        else:
            shutil.copy2(entry, target)


# Strip the DEV_RELOAD handler block from background.js. The block is
# fenced with a "Dev-only:" comment; we match start of the comment
# through the closing brace of the if-statement, inclusive.
_BG_PATTERN = re.compile(
    r"\n\s*// Dev-only: reload the whole extension\..*?if \(msg\.type === 'DEV_RELOAD'\) \{.*?\n\s*\}\n",
    re.DOTALL,
)

# Strip the FELIX_TM_DEV_RELOAD postMessage listener from content.js.
# Same fence pattern — section header comment through the listener's
# closing `});`.
_CT_PATTERN = re.compile(
    r"\n\s*// === Dev bridge:.*?window\.addEventListener\('message', \(e\) => \{.*?\n\s*\}, \{ signal \}\);\n",
    re.DOTALL,
)


def strip_dev_bridge(dst: Path) -> None:
    bg = dst / "background.js"
    ct = dst / "content.js"
    bg_src = bg.read_text(encoding="utf-8")
    ct_src = ct.read_text(encoding="utf-8")

    new_bg, n_bg = _BG_PATTERN.subn(
        "\n\n  // (DEV_RELOAD bridge stripped from this build)\n\n", bg_src
    )
    new_ct, n_ct = _CT_PATTERN.subn(
        "\n\n  // (FELIX_TM_DEV_RELOAD bridge stripped from this build)\n\n", ct_src
    )
    if n_bg != 1:
        print(f"!! background.js: expected 1 DEV_RELOAD block, found {n_bg}", file=sys.stderr)
        sys.exit(1)
    if n_ct != 1:
        print(f"!! content.js: expected 1 FELIX_TM_DEV_RELOAD block, found {n_ct}", file=sys.stderr)
        sys.exit(1)
    bg.write_text(new_bg, encoding="utf-8")
    ct.write_text(new_ct, encoding="utf-8")


def make_zip(unpacked: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(unpacked.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(unpacked.parent))


def make_bundle_zip(version: str, ext_unpacked: Path, samples_dir: Path,
                    bundle_zip: Path) -> None:
    """Tester-facing bundle: extension + samples + README, all in one zip."""
    if bundle_zip.exists():
        bundle_zip.unlink()
    with zipfile.ZipFile(bundle_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        # Extension tree under felix-tm-v<ver>/
        for path in sorted(ext_unpacked.rglob("*")):
            if path.is_file():
                zf.write(path, Path(f"felix-tm-v{version}-bundle") / path.relative_to(ext_unpacked.parent))
        # Samples flat at the bundle root.
        for path in sorted(samples_dir.iterdir()):
            if path.is_file():
                zf.write(path, Path(f"felix-tm-v{version}-bundle") / path.name)


def main() -> int:
    version = read_version()
    print(f"Felix TM extension v{version}")

    DIST.mkdir(exist_ok=True)
    unpacked = DIST / f"felix-tm-v{version}"
    zip_path = DIST / f"felix-tm-v{version}.zip"
    bundle_zip = DIST / f"felix-tm-v{version}-bundle.zip"

    print(f"  copy  {SRC} → {unpacked}")
    copy_tree(SRC, unpacked)

    print("  strip DEV_RELOAD bridge")
    strip_dev_bridge(unpacked)

    print(f"  zip   → {zip_path}")
    make_zip(unpacked, zip_path)

    print(f"  bundle (extension + samples) → {bundle_zip}")
    make_bundle_zip(version, unpacked, SAMPLES, bundle_zip)

    files = sum(1 for _ in unpacked.rglob("*") if _.is_file())
    sample_files = sum(1 for _ in SAMPLES.iterdir() if _.is_file())
    print(f"\nDone. Extension: {files} files, {zip_path.stat().st_size / 1024:.1f} KB zipped.")
    print(f"      Bundle:    extension + {sample_files} sample files, {bundle_zip.stat().st_size / 1024:.1f} KB zipped.")
    print(f"Unpacked: {unpacked}")
    print(f"Zip:      {zip_path}")
    print(f"Bundle:   {bundle_zip}  ← share this with testers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
