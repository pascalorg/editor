"""Pascal Scene Importer — Blender 4.5 extension.

Imports Pascal editor scene JSON ({nodes, rootNodeIds}) as a clean, lossless
Blender project. See docs/design/lossless-mapping.md in the repo.
"""
from __future__ import annotations


def register():
    from . import preferences
    from .operators import import_scene as op_import
    from .ui import panel

    preferences.register()
    op_import.register()
    panel.register()


def unregister():
    from . import preferences
    from .operators import import_scene as op_import
    from .ui import panel

    panel.unregister()
    op_import.unregister()
    preferences.unregister()
