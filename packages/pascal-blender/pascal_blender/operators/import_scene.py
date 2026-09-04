"""File > Import > Pascal Scene (.json) operator + drag-drop FileHandler."""
from __future__ import annotations

import traceback

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, StringProperty
from bpy_extras.io_utils import ImportHelper

from ..build import importer


class PASCAL_OT_import(bpy.types.Operator, ImportHelper):
    bl_idname = "pascal.import_scene"
    bl_label = "Import Pascal Scene"
    bl_description = "Import a Pascal editor scene JSON as a lossless Blender project"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    bake_openings: BoolProperty(
        name="Bake openings",
        description="Apply wall boolean cutouts instead of keeping live modifiers",
        default=False,
    )
    item_materials: EnumProperty(
        name="Item materials",
        items=(
            ("editor", "Editor look", "Replace GLB materials like the editor does"),
            ("original", "Original GLB", "Keep the materials shipped in each GLB"),
        ),
        default="editor",
    )
    physical_glass: BoolProperty(
        name="Physical glass",
        description="Add Transmission for real refraction in Cycles",
        default=False,
    )
    apply_texture_field: BoolProperty(
        name="Apply texture field",
        description="Honor material.texture (unused by the editor) as an image texture",
        default=True,
    )
    make_instances_real: BoolProperty(
        name="Make instances real",
        description="Expand repeated assets into editable unique copies",
        default=False,
    )
    network: BoolProperty(
        name="Download assets",
        description="Fetch furniture GLBs from the network (cached). Off = placeholders",
        default=True,
    )
    cdn_base: StringProperty(name="Asset CDN", default="https://editor.pascal.app")
    light_watts: FloatProperty(name="Watts per light unit", default=60.0, min=0.0)

    def invoke(self, context, event):
        # Seed per-import options from the add-on preferences.
        from ..preferences import get_prefs

        prefs = get_prefs(context)
        if prefs is not None:
            self.cdn_base = prefs.cdn_base
            self.network = prefs.network
            self.light_watts = prefs.light_watts
        return super().invoke(context, event)

    def execute(self, context):
        options = {
            "bake_openings": self.bake_openings,
            "item_materials": self.item_materials,
            "physical_glass": self.physical_glass,
            "apply_texture_field": self.apply_texture_field,
            "make_instances_real": self.make_instances_real,
            "network": self.network,
            "cdn_base": self.cdn_base,
            "light_watts": self.light_watts,
        }
        try:
            ctx = importer.import_scene(self.filepath, options)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self.report({"ERROR"}, f"Pascal import failed: {exc}")
            return {"CANCELLED"}

        warnings = [m for lvl, m in ctx.report if lvl in ("WARNING", "ERROR")]
        if warnings:
            self.report({"WARNING"}, f"Imported with {len(warnings)} warning(s) — see the Pascal panel")
        else:
            self.report({"INFO"}, f"Imported {len(ctx.anchors)} nodes")
        return {"FINISHED"}


class PASCAL_FH_import(bpy.types.FileHandler):
    bl_idname = "PASCAL_FH_import"
    bl_label = "Pascal Scene"
    bl_import_operator = "pascal.import_scene"
    bl_file_extensions = ".json"

    @classmethod
    def poll_drop(cls, context):
        return context.area is not None and context.area.type == "VIEW_3D"


def menu_import(self, context):
    self.layout.operator(PASCAL_OT_import.bl_idname, text="Pascal Scene (.json)")


CLASSES = (PASCAL_OT_import, PASCAL_FH_import)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)


def unregister():
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
