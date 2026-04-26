#!/usr/bin/env python3
"""Generate a stable Chrome extension key + ID for Felix TM.

Why: when an unpacked extension has no `key` field in manifest.json,
Chrome derives the extension ID from the load path — which differs
per installation, breaking the OAuth client's "Application ID" pin.
A static `key` (the public half of an RSA pair) makes the extension
ID deterministic across all loads / installs, so the OAuth client
in Cloud Console only needs one ID to authorize.

This script:
  1. Generates a new RSA 2048 key pair
  2. Saves the private key to .secrets/extension-key.pem (gitignored;
     keep this file safe — losing it means a new ID, which forces
     a Cloud Console update)
  3. Computes the extension ID Chrome will derive from the public key
  4. Patches plugins/chrome-extension/manifest.json with the public
     key (base64 of DER-encoded SubjectPublicKeyInfo)

Run once. Re-running generates a NEW key pair / new extension ID,
so don't run unless you want to invalidate the existing OAuth
registration. (.secrets/extension-key.pem will be overwritten.)
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
except ImportError:
    print("Need `cryptography`: .venv/bin/pip install cryptography", file=sys.stderr)
    sys.exit(2)

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "plugins" / "chrome-extension" / "manifest.json"
SECRETS_DIR = REPO / ".secrets"
PRIVATE_KEY_PATH = SECRETS_DIR / "extension-key.pem"


def chrome_extension_id_from_public_key_der(der_bytes: bytes) -> str:
    """Reproduce Chrome's extension-ID derivation:
    SHA-256 the public key DER, take the first 16 bytes, map each
    nibble (0–15) to letters a–p.
    """
    digest = hashlib.sha256(der_bytes).digest()[:16]
    return "".join(chr(((b >> 4) & 0xF) + ord("a")) + chr((b & 0xF) + ord("a"))
                   for b in digest)


def main() -> int:
    if PRIVATE_KEY_PATH.exists():
        print(f"!! {PRIVATE_KEY_PATH} already exists.")
        print("   Re-running generates a NEW key, invalidating the existing")
        print("   extension ID and OAuth client registration.")
        ans = input("   Overwrite? [yes/N] ").strip().lower()
        if ans != "yes":
            print("Aborted.")
            return 1

    SECRETS_DIR.mkdir(exist_ok=True)

    print("Generating RSA 2048 key pair…")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_private = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    PRIVATE_KEY_PATH.write_bytes(pem_private)
    PRIVATE_KEY_PATH.chmod(0o600)
    print(f"  → wrote {PRIVATE_KEY_PATH} (0600)")

    public_key = private_key.public_key()
    der_public = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    public_b64 = base64.b64encode(der_public).decode("ascii")
    extension_id = chrome_extension_id_from_public_key_der(der_public)

    # Patch manifest.json
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["key"] = public_b64
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"  → patched {MANIFEST.relative_to(REPO)} with key field")

    print()
    print("=" * 64)
    print(f"Extension ID: {extension_id}")
    print("=" * 64)
    print()
    print("Next steps in Cloud Console (project felix-tm):")
    print(f"  1. APIs & Services → Credentials → OAuth 2.0 Client ID")
    print(f"     (Chrome Application type) → set Application ID:")
    print(f"     {extension_id}")
    print(f"  2. Credentials → API Keys → 'Felix TM Picker' → restrict to")
    print(f"     HTTP referrer: chrome-extension://{extension_id}/*")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
