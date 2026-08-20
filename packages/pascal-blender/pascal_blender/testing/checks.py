"""Headless test checks driven by tests/run_headless.py.

The losslessness core: after import, reassemble {nodes, rootNodeIds} purely
from the .blend (pascal_json props + scene props) and deep-compare with the
source file. Runs again after a save/reload round-trip.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict

import bpy

from ..build import importer


def proto_export() -> Dict[str, Any]:
    """Rebuild the scene JSON from datablock custom properties alone."""
    nodes: Dict[str, Any] = {}
    for store in (bpy.data.objects, bpy.data.collections):
        for datablock in store:
            if datablock.get("pascal_synthetic"):
                continue  # migration-created; not part of the source file
            raw = datablock.get("pascal_json")
            nid = datablock.get("pascal_id")
            if raw and nid and nid not in nodes:
                nodes[nid] = json.loads(raw)
    scene = bpy.context.scene
    result: Dict[str, Any] = {
        "nodes": nodes,
        "rootNodeIds": list(scene.get("pascal_root_node_ids", [])),
    }
    extra = scene.get("pascal_extra_toplevel_json")
    if extra:
        result.update(json.loads(extra))
    return result


def run_all(fixture_path: Path, check) -> None:
    source = json.loads(fixture_path.read_text())
    source_nodes = source.get("nodes", {})

    ctx_holder = {}

    def do_import():
        ctx_holder["ctx"] = importer.import_scene(
            str(fixture_path), {"network": False}
        )

    check("import runs without exception", do_import)
    if "ctx" not in ctx_holder:
        return
    ctx = ctx_holder["ctx"]

    def anchor_coverage():
        anchored = set()
        for store in (bpy.data.objects, bpy.data.collections):
            for db in store:
                if db.get("pascal_id"):
                    anchored.add(db["pascal_id"])
        missing = set(source_nodes) - anchored
        assert not missing, f"nodes without anchors: {sorted(missing)[:5]} (+{max(0, len(missing) - 5)} more)"

    check("every source node has an anchor datablock", anchor_coverage)

    def text_hash():
        text = bpy.data.texts.get("pascal_source.json")
        assert text is not None, "pascal_source.json Text block missing"
        assert bpy.context.scene["pascal_source_hash"] == hashlib.sha256(
            fixture_path.read_bytes()
        ).hexdigest()
        assert json.loads(text.as_string()) == source, "Text block JSON != source"

    check("Text block + hash match source", text_hash)

    def losslessness():
        rebuilt = proto_export()
        assert rebuilt["rootNodeIds"] == source.get("rootNodeIds", []), "rootNodeIds differ"
        assert rebuilt["nodes"] == source_nodes, _diff_hint(source_nodes, rebuilt["nodes"])
        for key, value in source.items():
            if key not in ("nodes", "rootNodeIds"):
                assert rebuilt.get(key) == value, f"extra top-level key {key!r} not preserved"

    check("proto-export deep-equals source (LOSSLESSNESS)", losslessness)

    def save_reload():
        blend = os.path.join(tempfile.gettempdir(), f"pascal_test_{fixture_path.stem}.blend")
        bpy.ops.wm.save_as_mainfile(filepath=blend)
        bpy.ops.wm.open_mainfile(filepath=blend)
        rebuilt = proto_export()
        assert rebuilt["nodes"] == source_nodes, "losslessness broken after save/reload"
        assert list(bpy.context.scene.get("pascal_root_node_ids", [])) == source.get("rootNodeIds", [])
        text = bpy.data.texts.get("pascal_source.json")
        assert text is not None and json.loads(text.as_string()) == source

    check("save + reload keeps everything", save_reload)


def _diff_hint(expected: Dict[str, Any], actual: Dict[str, Any]) -> str:
    for nid, node in expected.items():
        if nid not in actual:
            return f"node {nid} missing from rebuild"
        if actual[nid] != node:
            for key, value in node.items():
                if actual[nid].get(key) != value:
                    return f"node {nid} field {key!r}: {value!r} != {actual[nid].get(key)!r}"
            extra_keys = set(actual[nid]) - set(node)
            if extra_keys:
                return f"node {nid} gained keys {sorted(extra_keys)}"
    extra = set(actual) - set(expected)
    return f"rebuild has extra nodes {sorted(extra)[:5]}" if extra else "unknown diff"
