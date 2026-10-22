#!/usr/bin/env python3
"""Restore binary Android assets stored as base64 text (*.b64) in this repo.

The GitHub push path used for this branch cannot transfer binary files, so
binaries (launcher icons, splash screens, gradle-wrapper.jar) are committed
as base64 text. Run this once after cloning:

    python3 scripts/restore-android-binaries.py
"""
import base64
import os
import stat
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    count = 0
    for dirpath, _, filenames in os.walk(os.path.join(REPO_ROOT, "android")):
        for fn in filenames:
            if not fn.endswith(".b64"):
                continue
            src = os.path.join(dirpath, fn)
            dst = src[: -len(".b64")]
            with open(src, "r", encoding="ascii") as fh:
                data = base64.b64decode(fh.read())
            with open(dst, "wb") as fh:
                fh.write(data)
            count += 1

    gradlew = os.path.join(REPO_ROOT, "android", "gradlew")
    if os.path.exists(gradlew):
        st = os.stat(gradlew)
        os.chmod(gradlew, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print(f"Restored {count} binary files; gradlew is executable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
