"""N-panel: Pascal node info for the active object + the import report."""
from __future__ import annotations

import bpy


class PASCAL_PT_node(bpy.types.Panel):
    bl_idname = "PASCAL_PT_node"
    bl_label = "Pascal"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Pascal"

    def draw(self, context):
        layout = self.layout
        obj = context.active_object
        if obj is not None and obj.get("pascal_id"):
            box = layout.box()
            row = box.row()
            row.label(text=str(obj.get("pascal_type", "?")).title(), icon="OBJECT_DATA")
            box.label(text=f"ID: {obj.get('pascal_id')}")
            params = obj.get("pascal_params")
            if params:
                col = box.column(align=True)
                for key in params.keys():
                    row = col.row()
                    row.label(text=str(key))
                    value = params[key]
                    if hasattr(value, "__len__") and not isinstance(value, str):
                        row.label(text=", ".join(f"{v:.3g}" for v in value))
                    else:
                        row.label(text=f"{value}")
            if obj.get("pascal_migrated"):
                box.label(text="Migrated from legacy format", icon="INFO")
            if obj.get("pascal_placeholder"):
                box.label(text="Placeholder (asset not downloaded)", icon="GHOST_ENABLED")
        else:
            layout.label(text="No Pascal node selected")


class PASCAL_PT_report(bpy.types.Panel):
    bl_idname = "PASCAL_PT_report"
    bl_label = "Import Report"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Pascal"
    bl_parent_id = "PASCAL_PT_node"
    bl_options = {"DEFAULT_CLOSED"}

    @classmethod
    def poll(cls, context):
        return bool(context.scene.get("pascal_import_report"))

    def draw(self, context):
        layout = self.layout
        report = str(context.scene.get("pascal_import_report", ""))
        lines = report.split("\n")
        warn = sum(1 for l in lines if l.startswith("[WARNING]") or l.startswith("[ERROR]"))
        layout.label(
            text=f"{len(lines)} entries, {warn} warnings",
            icon="ERROR" if warn else "CHECKMARK",
        )
        col = layout.column(align=True)
        for line in lines[:30]:
            icon = "ERROR" if line.startswith("[ERROR]") else (
                "INFO" if line.startswith("[INFO]") else "DOT"
            )
            col.label(text=line.split("] ", 1)[-1][:64], icon=icon)
        if len(lines) > 30:
            col.label(text=f"… {len(lines) - 30} more (see console)")


CLASSES = (PASCAL_PT_node, PASCAL_PT_report)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
