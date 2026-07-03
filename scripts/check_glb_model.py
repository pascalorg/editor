#!/usr/bin/env python3
"""Inspect GLB assets for Pascal catalog readiness using only the Python stdlib."""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
TRIANGLES_MODE = 4


class GlbError(ValueError):
    pass


@dataclass
class Bounds:
    minimum: list[float]
    maximum: list[float]

    @classmethod
    def empty(cls) -> "Bounds":
        return cls([math.inf] * 3, [-math.inf] * 3)

    def include(self, point: list[float]) -> None:
        for axis in range(3):
            self.minimum[axis] = min(self.minimum[axis], point[axis])
            self.maximum[axis] = max(self.maximum[axis], point[axis])

    @property
    def valid(self) -> bool:
        return all(math.isfinite(value) for value in self.minimum + self.maximum)

    @property
    def size(self) -> list[float]:
        return [self.maximum[i] - self.minimum[i] for i in range(3)]

    @property
    def center(self) -> list[float]:
        return [(self.maximum[i] + self.minimum[i]) / 2 for i in range(3)]


def round_values(values: Iterable[float], digits: int = 4) -> list[float]:
    return [round(value, digits) for value in values]


def matrix_identity() -> list[float]:
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def matrix_multiply(left: list[float], right: list[float]) -> list[float]:
    result = [0.0] * 16
    for column in range(4):
        for row in range(4):
            result[column * 4 + row] = sum(
                left[k * 4 + row] * right[column * 4 + k] for k in range(4)
            )
    return result


def node_matrix(node: dict[str, Any]) -> list[float]:
    if isinstance(node.get("matrix"), list) and len(node["matrix"]) == 16:
        return [float(value) for value in node["matrix"]]

    tx, ty, tz = node.get("translation", [0, 0, 0])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return [
        (1 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0,
        (xy - wz) * sy,
        (1 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1 - (xx + yy)) * sz,
        0,
        tx,
        ty,
        tz,
        1,
    ]


def transform_point(matrix: list[float], point: list[float]) -> list[float]:
    x, y, z = point
    return [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    ]


def read_glb(path: Path) -> tuple[dict[str, Any], int]:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != GLB_MAGIC:
        raise GlbError("not a GLB file (missing glTF header)")
    version, declared_length = struct.unpack_from("<II", data, 4)
    if version != 2:
        raise GlbError(f"unsupported GLB version {version}; expected 2")
    if declared_length != len(data):
        raise GlbError(
            f"header length {declared_length} does not match file size {len(data)}"
        )

    offset = 12
    document: dict[str, Any] | None = None
    binary_size = 0
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == JSON_CHUNK:
            document = json.loads(chunk.rstrip(b"\x00 \t\r\n").decode("utf-8"))
        else:
            binary_size += chunk_length
    if document is None:
        raise GlbError("GLB contains no JSON chunk")
    return document, binary_size


def scene_bounds(document: dict[str, Any]) -> tuple[Bounds, int]:
    nodes = document.get("nodes", [])
    meshes = document.get("meshes", [])
    accessors = document.get("accessors", [])
    scenes = document.get("scenes", [])
    scene_index = document.get("scene", 0)
    bounds = Bounds.empty()
    missing_bounds = 0

    def walk(node_index: int, parent_matrix: list[float]) -> None:
        nonlocal missing_bounds
        node = nodes[node_index]
        world = matrix_multiply(parent_matrix, node_matrix(node))
        mesh_index = node.get("mesh")
        if isinstance(mesh_index, int) and 0 <= mesh_index < len(meshes):
            for primitive in meshes[mesh_index].get("primitives", []):
                accessor_index = primitive.get("attributes", {}).get("POSITION")
                if not isinstance(accessor_index, int) or accessor_index >= len(accessors):
                    missing_bounds += 1
                    continue
                accessor = accessors[accessor_index]
                minimum, maximum = accessor.get("min"), accessor.get("max")
                if not (
                    isinstance(minimum, list)
                    and isinstance(maximum, list)
                    and len(minimum) == 3
                    and len(maximum) == 3
                ):
                    missing_bounds += 1
                    continue
                for x in (minimum[0], maximum[0]):
                    for y in (minimum[1], maximum[1]):
                        for z in (minimum[2], maximum[2]):
                            bounds.include(transform_point(world, [x, y, z]))
        for child in node.get("children", []):
            walk(child, world)

    if scenes and 0 <= scene_index < len(scenes):
        for root in scenes[scene_index].get("nodes", []):
            walk(root, matrix_identity())
    return bounds, missing_bounds


def parse_txt_dimensions(path: Path) -> list[float] | None:
    companion = path.with_suffix(".txt")
    if not companion.exists():
        return None
    text = companion.read_text(encoding="utf-8", errors="replace")
    match = re.search(
        r"(?:尺寸|尺⼨|dimensions?)\s*[：:]\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)",
        text,
        re.IGNORECASE,
    )
    return [float(match.group(i)) for i in range(1, 4)] if match else None


def inspect(path: Path, expected: list[float] | None, tolerance: float) -> dict[str, Any]:
    document, binary_size = read_glb(path)
    bounds, missing_bounds = scene_bounds(document)
    if not bounds.valid:
        raise GlbError("could not derive bounds; POSITION accessors need min/max")

    size, center = bounds.size, bounds.center
    suggested_offset = [-center[0], -bounds.minimum[1], -center[2]]
    accessors = document.get("accessors", [])
    meshes = document.get("meshes", [])
    materials = document.get("materials", [])
    images = document.get("images", [])
    buffer_views = document.get("bufferViews", [])

    vertex_count = 0
    triangle_count = 0
    primitive_count = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            primitive_count += 1
            position_index = primitive.get("attributes", {}).get("POSITION")
            if isinstance(position_index, int) and position_index < len(accessors):
                vertex_count += int(accessors[position_index].get("count", 0))
            if primitive.get("mode", TRIANGLES_MODE) == TRIANGLES_MODE:
                index = primitive.get("indices")
                count = (
                    accessors[index].get("count", 0)
                    if isinstance(index, int) and index < len(accessors)
                    else accessors[position_index].get("count", 0)
                    if isinstance(position_index, int) and position_index < len(accessors)
                    else 0
                )
                triangle_count += int(count) // 3

    embedded_image_bytes = 0
    external_images = 0
    image_mime_types: dict[str, int] = {}
    for image in images:
        mime = image.get("mimeType", "external/unknown")
        image_mime_types[mime] = image_mime_types.get(mime, 0) + 1
        view_index = image.get("bufferView")
        if isinstance(view_index, int) and view_index < len(buffer_views):
            embedded_image_bytes += int(buffer_views[view_index].get("byteLength", 0))
        elif image.get("uri"):
            external_images += 1

    warnings: list[str] = []
    file_size = path.stat().st_size
    if file_size > 8 * 1024 * 1024:
        warnings.append("file is larger than 8 MiB; compress textures/mesh for catalog use")
    if embedded_image_bytes > 5 * 1024 * 1024:
        warnings.append("embedded textures exceed 5 MiB; WebP/KTX2 compression is recommended")
    if missing_bounds:
        warnings.append(f"{missing_bounds} primitive(s) had no POSITION min/max and were skipped")
    if abs(bounds.minimum[1]) > 0.02:
        warnings.append("model bottom is not at Y=0")
    if abs(center[0]) > 0.05 or abs(center[2]) > 0.05:
        warnings.append("model is not centered on X/Z; use the suggested offset or re-export")
    extensions = document.get("extensionsUsed", [])
    if "KHR_materials_pbrSpecularGlossiness" in extensions:
        warnings.append("uses legacy KHR_materials_pbrSpecularGlossiness; metallic-roughness PBR is preferred")
    if any(
        node.get("matrix")
        or node.get("scale", [1, 1, 1]) != [1, 1, 1]
        or node.get("rotation", [0, 0, 0, 1]) != [0, 0, 0, 1]
        for node in document.get("nodes", [])
    ):
        warnings.append("contains non-identity node transforms; acceptable, but baked transforms are easier to maintain")

    expected = expected or parse_txt_dimensions(path)
    dimension_check = None
    if expected:
        relative_errors = [
            abs(size[i] - expected[i]) / max(abs(expected[i]), 1e-9) for i in range(3)
        ]
        dimension_check = {
            "expected": round_values(expected),
            "relativeError": round_values(relative_errors),
            "withinTolerance": all(error <= tolerance for error in relative_errors),
        }
        if not dimension_check["withinTolerance"]:
            warnings.append(
                f"measured dimensions differ from expected by more than {tolerance:.0%}"
            )

    return {
        "path": str(path),
        "ok": not any("could not" in warning for warning in warnings),
        "fileSizeBytes": file_size,
        "generator": document.get("asset", {}).get("generator"),
        "bounds": {
            "min": round_values(bounds.minimum),
            "max": round_values(bounds.maximum),
            "size": round_values(size),
            "center": round_values(center),
        },
        "suggestedCatalog": {
            "dimensions": round_values(size),
            "offset": round_values(suggested_offset),
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1],
        },
        "geometry": {
            "meshes": len(meshes),
            "primitives": primitive_count,
            "vertices": vertex_count,
            "triangles": triangle_count,
        },
        "textures": {
            "count": len(images),
            "embeddedBytes": embedded_image_bytes,
            "externalCount": external_images,
            "mimeTypes": image_mime_types,
        },
        "materials": len(materials),
        "binaryChunkBytes": binary_size,
        "extensionsUsed": extensions,
        "dimensionCheck": dimension_check,
        "warnings": warnings,
    }


def find_glbs(paths: list[str]) -> list[Path]:
    result: list[Path] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            result.extend(sorted(path.rglob("*.glb")))
        elif path.suffix.lower() == ".glb":
            result.append(path)
        else:
            print(f"warning: skipped non-GLB path: {path}", file=sys.stderr)
    return result


def print_human(report: dict[str, Any]) -> None:
    size = report["bounds"]["size"]
    suggested = report["suggestedCatalog"]
    geometry, textures = report["geometry"], report["textures"]
    print(f"\n{report['path']}")
    print(f"  size W×H×D : {size[0]} × {size[1]} × {size[2]} m")
    print(f"  dimensions : {suggested['dimensions']}")
    print(f"  offset     : {suggested['offset']}")
    print(
        f"  geometry   : {geometry['meshes']} meshes, {geometry['vertices']} vertices, "
        f"{geometry['triangles']} triangles"
    )
    print(
        f"  textures   : {textures['count']} image(s), "
        f"{textures['embeddedBytes'] / 1024 / 1024:.2f} MiB embedded"
    )
    if report["dimensionCheck"]:
        state = "PASS" if report["dimensionCheck"]["withinTolerance"] else "FAIL"
        print(f"  expected   : {state} {report['dimensionCheck']['expected']}")
    if report["warnings"]:
        for warning in report["warnings"]:
            print(f"  WARN       : {warning}")
    else:
        print("  OK         : no catalog-readiness warnings")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="GLB file(s) or directories")
    parser.add_argument(
        "--expected",
        nargs=3,
        type=float,
        metavar=("WIDTH", "HEIGHT", "DEPTH"),
        help="expected W H D dimensions in meters; otherwise reads a companion .txt",
    )
    parser.add_argument(
        "--tolerance", type=float, default=0.05, help="dimension relative tolerance (default: 0.05)"
    )
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args()

    paths = find_glbs(args.paths)
    if not paths:
        print("no GLB files found", file=sys.stderr)
        return 2

    reports: list[dict[str, Any]] = []
    failed = False
    for path in paths:
        try:
            reports.append(inspect(path, args.expected, args.tolerance))
        except (OSError, GlbError, json.JSONDecodeError) as error:
            failed = True
            reports.append({"path": str(path), "ok": False, "error": str(error)})

    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
    else:
        for report in reports:
            if "error" in report:
                print(f"\n{report['path']}\n  ERROR      : {report['error']}")
            else:
                print_human(report)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
