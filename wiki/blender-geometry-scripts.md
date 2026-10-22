# Blender geometry scripts

An authored object, window, door or column can be built from a Blender `bpy` module as well as a three.js one. Reach for Blender when the shape is easier with its modelling: bevelled or rounded edges, subdivision-smooth forms, booleans, curves and text, solidify, array, screw and the other modifiers.

## A cabinet in Blender

```python
import bmesh
import bpy

PARAMS = {"width": {"default": 1.2, "min": 0.6, "max": 2.4, "step": 0.05, "unit": "m", "label": "Width"}}
MOUNT = "floor"


def box(name, size, location, material):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build(params):
    w = params["width"]
    wood = bpy.data.materials.new("slot_wood")
    wood.diffuse_color = (0.55, 0.35, 0.2, 1)
    metal = bpy.data.materials.new("slot_metal")
    metal.diffuse_color = (0.7, 0.7, 0.72, 1)

    body = box("part:body", (w, 0.5, 0.9), (0, 0, 0.45), wood)
    body["type"] = "cabinet"
    bevel = body.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.01
    bevel.segments = 2

    action = bpy.data.actions.new("open")
    for name, x, sign in (("part:door_left", -w / 4, 1), ("part:door_right", w / 4, -1)):
        door = box(name, (w / 2 - 0.01, 0.02, 0.86), (x, -0.26, 0.45), metal)
        door.animation_data_create()
        door.animation_data.action = action
        door.keyframe_insert("rotation_euler", index=2, frame=1)
        door.rotation_euler.z = sign * 1.4
        door.keyframe_insert("rotation_euler", index=2, frame=24)
        door.rotation_euler.z = 0

    top = bpy.data.objects.new("anchor:top", None)
    top.location = (0, 0, 0.9)
    bpy.context.scene.collection.objects.link(top)

    lamp = bpy.data.objects.new("light:lamp", bpy.data.lights.new("lamp", "POINT"))
    lamp.location = (0, 0, 0.85)
    lamp["intensity"] = 3
    bpy.context.scene.collection.objects.link(lamp)
```

Send it to `add_object` with `language: "bpy"`:

```json
{
  "name": "add_object",
  "arguments": {
    "language": "bpy",
    "code": "<the module above>",
    "params": { "width": 1.5 },
    "position": [2, 0, 1],
    "name": "Oak cabinet",
    "category": "cabinet",
    "reason": "Bevelled two-door cabinet for the hallway"
  }
}
```

The result lists its parts (`body`, `door_left`, `door_right`), paint slots (`wood`, `metal`), the `top` socket, the `lamp` light and the `open` clip, which becomes the cabinet's open/close control. The fixture is `packages/geometry-script/src/__fixtures__/blender/cabinet.py`.

## The module

- `PARAMS` declares the parameters, as three.js's `params` does; `build(params)` gets the resolved values.
- `MOUNT` is `floor` (the default), `wall-side`, `wall` or `ceiling`.
- `build` adds objects to the empty scene it is given. Everything in the scene is exported as a GLB, modifiers applied.
- Use the data API and `bmesh`, not operators that need a 3D viewport.

## Conventions in Blender terms

| In the module | Becomes |
| --- | --- |
| Metres, Z up, the front facing −Y (Blender's Front view) | Pascal's metres, Y up, front +Z |
| object `part:<id>`, custom property `type` | an addressable, typed part (`find_by_type`) |
| material `slot_<id>` | a paint slot; while its shader keeps the default base colour, its viewport `diffuse_color` colours it |
| object `light:<id>` holding a light, custom property `intensity` (default 2) | a switchable light; Blender's watts are not read |
| empty `anchor:<id>` | a socket |
| object `cutout`, `cut:wall`, `cut:ceiling`, `cut:slab` | a cutter for the mounted host |
| object `collider` | the walkthrough proxy |
| one action named `open`, `close`, `loop` or anything else, assigned to every object it moves | one clip |

## Edit and read back

`get_source` returns the Python and its `language`. Pass `nodeId` with new `code`, new `params`, or both; an edit keeps the object's language unless `language` says otherwise, and a params-only edit rebuilds the stored module. In the editor the Parameters panel rebuilds a bpy object too ("Rebuilding in Blender…"). A failing module comes back with Blender's error and line.

## Where it runs

Blender cannot run in a browser, so a bpy module is built by its host:

- **Editor**: the host configures a builder with `configureBlenderScriptBuilder` from `@pascal-app/editor`; without one, bpy is refused.
- **Local MCP**: set `PASCAL_BLENDER` to a Blender binary (it runs `blender -b`). This runs the module on your machine with no sandbox, like `PASCAL_SERVER_SCRIPT_COMPILE=1` for three.js.

```bash
PASCAL_BLENDER=/Applications/Blender.app/Contents/MacOS/Blender bunx @pascal-app/mcp
```

- **Your own host**: `runBlenderLocally` (`@pascal-app/geometry-script/blender-local`) runs a local binary; `compileBlenderBuild` (`@pascal-app/geometry-script/blender`) turns the GLB a run exported into the same manifest a three.js build gets. It runs no model code, so any host may call it.

The compile pipeline and naming rules are in [authored objects](architecture/authored-objects.md#blender-modules).
