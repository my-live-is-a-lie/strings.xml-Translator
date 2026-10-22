#!/usr/bin/env python3
"""Restore binary Android assets stored as base64 text (*.b64) in this repo.

The GitHub push path used for this branch cannot transfer binary files, so
binaries (launcher icons, splash screens, gradle-wrapper.jar) are committed
as base64 text under android/binary-assets/, mirroring their real location
under android/ (the .b64 sources must stay OUT of app/src/main/res/ because
Android's resource merger rejects any file there not ending in .xml/.png).

Run once after cloning:

    python3 scripts/restore-android-binaries.py
"""
import base64
import os
import stat
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID_DIR = os.path.join(REPO_ROOT, "android")
BIN_DIR = os.path.join(ANDROID_DIR, "binary-assets")
SUFFIX = ".b64"


def main() -> int:
    if not os.path.isdir(BIN_DIR):
        print(f"Nothing to restore: {BIN_DIR} not found.")
        return 1

    count = 0
    for dirpath, _, filenames in os.walk(BIN_DIR):
        for fn in filenames:
            if not fn.endswith(SUFFIX):
                continue
            src = os.path.join(dirpath, fn)
            rel = os.path.relpath(src, BIN_DIR)  # e.g. app/src/main/res/drawable/splash.png.b64
            dst = os.path.join(ANDROID_DIR, rel[: -len(SUFFIX)])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(src, "r", encoding="ascii") as fh:
                data = base64.b64decode(fh.read())
            with open(dst, "wb") as fh:
                fh.write(data)
            count += 1

    gradlew = os.path.join(ANDROID_DIR, "gradlew")
    if os.path.exists(gradlew):
        st = os.stat(gradlew)
        os.chmod(gradlew, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print(f"Restored {count} binary files; gradlew is executable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
