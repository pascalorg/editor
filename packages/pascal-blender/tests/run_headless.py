"""Headless test harness. Run inside Blender:

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python tests/run_headless.py -- [fixture.json ...]

Installs the repo's pascal_blender package on sys.path, imports each fixture
into a fresh scene, runs the registered checks, and exits nonzero on failure.
"""
import json
import sys
import traceback
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
fixtures = [Path(a) for a in argv] or sorted((REPO / "tests" / "fixtures").glob("*.json"))

failures = []


def check(name, fn):
    try:
        fn()
        print(f"  PASS {name}")
    except Exception:
        failures.append(name)
        print(f"  FAIL {name}")
        traceback.print_exc()


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def run_fixture(path: Path):
    print(f"\n=== {path.name} ===")
    fresh_scene()
    from pascal_blender.testing import checks  # noqa: deferred so addon code is importable

    checks.run_all(path, check)


for fx in fixtures:
    run_fixture(fx)

print(f"\n{'OK' if not failures else 'FAILED'}: {len(failures)} failing check(s)")
if failures:
    for f in failures:
        print(" -", f)
    sys.exit(1)
