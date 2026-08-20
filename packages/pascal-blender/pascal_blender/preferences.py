"""Add-on preferences: persistent defaults for import options."""
from __future__ import annotations

import bpy
from bpy.props import BoolProperty, FloatProperty, StringProperty


class PascalPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    cdn_base: StringProperty(
        name="Asset CDN",
        description="Base URL for relative furniture GLB paths in scene files",
        default="https://editor.pascal.app",
    )
    network: BoolProperty(
        name="Download assets by default",
        description="Fetch furniture GLBs on import (cached locally). "
        "Also requires Blender's own 'Allow Online Access'",
        default=True,
    )
    light_watts: FloatProperty(
        name="Watts per light unit",
        description="Calibration for the editor's unitless light intensities",
        default=60.0,
        min=0.0,
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "cdn_base")
        layout.prop(self, "network")
        layout.prop(self, "light_watts")
        if hasattr(bpy.app, "online_access") and not bpy.app.online_access:
            box = layout.box()
            box.label(icon="ERROR", text="Blender's 'Allow Online Access' is disabled —")
            box.label(text="furniture will import as placeholders. See System preferences.")


def get_prefs(context) -> "PascalPreferences | None":
    addon = context.preferences.addons.get(__package__)
    return addon.preferences if addon else None


def register():
    bpy.utils.register_class(PascalPreferences)


def unregister():
    bpy.utils.unregister_class(PascalPreferences)
