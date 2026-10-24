"""Runs one Blender (bpy) geometry script and exports what it built as a GLB.

    python runner.py <dir>                     # the `bpy` wheel
    blender -b --factory-startup --python-exit-code 1 --python runner.py -- <dir>

Reads `<dir>/request.json` ({"code": str, "params": {id: value}}) and writes
`<dir>/result.json` plus, on success, `<dir>/model.glb`. The module declares
`PARAMS` (same shape as a three.js script's `params`), an optional `MOUNT` and
`build(params)`, which adds objects to the empty scene it is given. Everything in
the scene is exported; `@pascal-app/geometry-script/blender` reads the GLB into
the same manifest as a three.js build.

This file is the protocol, not the sandbox: the host runs it with no network, no
secrets and a deadline. Parameter resolution mirrors `resolveParams` in
compile.ts; the reader re-resolves and refuses a mismatch.
"""

import contextlib
import io
import json
import math
import sys
import traceback
from pathlib import Path

MOUNTS = ("floor", "wall", "wall-side", "ceiling")
LOG_LIMIT = 8_000


def param_specs(raw):
    if raw is None:
        return []
    if not isinstance(raw, dict):
        raise ValueError(
            "PARAMS must be a dict of { id: default | { default, min, max, step } }"
        )
    specs = []
    for key, spec in raw.items():
        described = isinstance(spec, dict)
        value = spec.get("default", spec.get("value")) if described else spec
        if isinstance(value, bool):
            kind = "boolean"
        elif isinstance(value, (int, float)):
            if not math.isfinite(value):
                raise ValueError(f'Param "{key}" default is not finite')
            kind = "number"
        elif isinstance(value, str):
            kind = "string"
        else:
            raise ValueError(f'Param "{key}" needs a number, boolean or string default')
        entry = {"id": str(key), "kind": kind, "default": value}
        if described:
            for field in ("label", "min", "max", "step", "unit", "options"):
                if spec.get(field) is not None:
                    entry[field] = spec[field]
        specs.append(entry)
    return specs


def same_kind(value, kind):
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, str)


def resolve_params(specs, overrides):
    values = {}
    for spec in specs:
        override = overrides.get(spec["id"])
        value = override if same_kind(override, spec["kind"]) else spec["default"]
        options = spec.get("options")
        if isinstance(value, str) and options and value not in options:
            value = spec["default"]
        if spec["kind"] == "number":
            if spec.get("min") is not None:
                value = max(spec["min"], value)
            if spec.get("max") is not None:
                value = min(spec["max"], value)
        values[spec["id"]] = value
    return values


def carry_viewport_colors(bpy):
    # `diffuse_color` is only Blender's viewport colour; the exporter reads the
    # Principled BSDF. A script that set just the former still means it.
    for material in bpy.data.materials:
        tree = material.node_tree
        nodes = tree.nodes if tree else ()
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        base = bsdf.inputs["Base Color"]
        untouched = all(abs(c - 0.8) < 1e-6 for c in base.default_value[:3])
        viewport = tuple(material.diffuse_color)
        if not base.is_linked and untouched and viewport[:3] != (0.8, 0.8, 0.8):
            base.default_value = viewport


def export_glb(bpy, path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        use_visible=False,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_lights=True,
        export_cameras=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_draco_mesh_compression_enable=False,
    )


def run(directory):
    import bpy

    request = json.loads((directory / "request.json").read_text("utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    module = {"__name__": "pascal_script"}
    log = io.StringIO()
    with contextlib.redirect_stdout(log):
        exec(compile(request["code"], "script.py", "exec"), module)
        build = module.get("build")
        if not callable(build):
            raise ValueError("The script must define build(params)")
        mount = module.get("MOUNT", "floor")
        if mount not in MOUNTS:
            raise ValueError(f"MOUNT must be one of {', '.join(MOUNTS)}")
        raw_params = module.get("PARAMS")
        resolved = resolve_params(param_specs(raw_params), request.get("params") or {})
        build(resolved)
    if not bpy.context.scene.objects:
        raise ValueError("build(params) added nothing to the scene")
    carry_viewport_colors(bpy)
    export_glb(bpy, directory / "model.glb")
    return {
        "ok": True,
        "mount": mount,
        "params": raw_params or {},
        "resolved": resolved,
        "blender": bpy.app.version_string,
        "log": log.getvalue()[-LOG_LIMIT:],
    }


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    directory = Path(args[0])
    try:
        result = run(directory)
    except Exception as error:
        frames = traceback.extract_tb(error.__traceback__)
        line = next((f.lineno for f in reversed(frames) if f.filename == "script.py"), None)
        result = {
            "ok": False,
            "error": f"{type(error).__name__}: {error}",
            "line": line,
        }
    (directory / "result.json").write_text(json.dumps(result), "utf-8")


if __name__ == "__main__":
    main()
