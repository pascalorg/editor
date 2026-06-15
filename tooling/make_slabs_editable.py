#!/usr/bin/env python3
"""Make Pascal layout slab nodes manually editable.

This is intentionally text-based instead of json.loads/json.dumps so it can
preserve large layout files and survive files that the editor can import but
strict Python JSON parsing may reject due legacy text encoding quirks.
"""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


TYPE_SLAB_RE = re.compile(r'"type"\s*:\s*"slab"')
AUTO_FROM_WALLS_RE = re.compile(r'("autoFromWalls"\s*:\s*)true\b')
AUTO_FROM_WALLS_ANY_RE = re.compile(r'"autoFromWalls"\s*:\s*(?:true|false)\b')


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def collect_slab_object_ranges(text: str) -> list[tuple[int, int]]:
    object_stack: list[int] = []
    slab_starts: set[int] = set()
    ranges: list[tuple[int, int]] = []
    in_string = False
    escaped = False

    pos = 0
    while pos < len(text):
        ch = text[pos]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            pos += 1
            continue

        if object_stack:
            match = TYPE_SLAB_RE.match(text, pos)
            if match:
                slab_starts.add(object_stack[-1])
                pos = match.end()
                continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            object_stack.append(pos)
        elif ch == "}":
            if object_stack:
                start = object_stack.pop()
                if start in slab_starts:
                    ranges.append((start, pos + 1))
                    slab_starts.remove(start)

        pos += 1

    return sorted(ranges)


def make_slab_object_editable(obj: str) -> tuple[str, bool]:
    replaced, count = AUTO_FROM_WALLS_RE.subn(r"\1false", obj)
    if count > 0:
        return replaced, True

    if AUTO_FROM_WALLS_ANY_RE.search(obj):
        return obj, False

    insert_at = obj.rfind("}")
    if insert_at < 0:
        return obj, False

    newline_match = re.search(r"\n([ \t]*)}", obj[insert_at - 80 : insert_at + 1])
    indent = newline_match.group(1) if newline_match else "  "
    field = f',\n{indent}"autoFromWalls": false'
    return obj[:insert_at] + field + obj[insert_at:], True


def make_slabs_editable(text: str) -> tuple[str, int, int]:
    ranges = collect_slab_object_ranges(text)
    parts: list[str] = []
    cursor = 0
    changed = 0

    for start, end in ranges:
        if start < cursor:
            continue
        obj = text[start:end]
        updated, did_change = make_slab_object_editable(obj)
        parts.append(text[cursor:start])
        parts.append(updated)
        cursor = end
        if did_change:
            changed += 1

    parts.append(text[cursor:])
    return "".join(parts), len(ranges), changed


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.editable{input_path.suffix}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Set every Pascal layout node with "type": "slab" to "autoFromWalls": false.',
    )
    parser.add_argument("input", type=Path, help="Layout JSON file to update.")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Output JSON path. Defaults to <name>.editable.json unless --in-place is used.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the input file after writing a .bak backup.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not create a .bak file when using --in-place.",
    )
    args = parser.parse_args()

    input_path = args.input.resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    if args.in_place and args.output:
        raise SystemExit("Do not pass an output path together with --in-place.")

    text = read_text(input_path)
    updated, found, changed = make_slabs_editable(text)

    output_path = input_path if args.in_place else (args.output.resolve() if args.output else default_output_path(input_path))

    if args.in_place and not args.no_backup:
        backup_path = input_path.with_suffix(input_path.suffix + ".bak")
        shutil.copy2(input_path, backup_path)
        print(f"Backup written: {backup_path}")

    output_path.write_text(updated, encoding="utf-8", newline="")
    print(f"Slab nodes found: {found}")
    print(f"Slab nodes changed: {changed}")
    print(f"Output written: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
