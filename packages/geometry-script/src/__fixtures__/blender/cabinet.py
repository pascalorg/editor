import bmesh
import bpy

PARAMS = {"width": {"default": 1.2, "min": 0.6, "max": 2.4, "step": 0.05, "unit": "m"}}
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
