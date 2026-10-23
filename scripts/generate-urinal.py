"""Generate the catalog urinal with Blender 4.5 LTS (see the asset README)."""

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/editor/public/items/urinal"
OUTPUT.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def material(name, color, roughness, metallic=0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


ceramic = material("slot_ceramic", (0.82, 0.85, 0.87), 0.22)
chrome = material("slot_drain", (0.42, 0.46, 0.5), 0.24, 0.85)

# Elliptical shell sections follow the generic fixture approach in KKG's BIM
# model. Moving the inner sections downward gives the bowl a low drain sump.
# Tuples are (half width, half height, height center, front depth, rim tilt).
profile = [
    (0, 0, 0.325, -0.175, 0),
    (0.165, 0.295, 0.325, -0.175, 0),
    (0.18, 0.32, 0.325, -0.165, 0),
    (0.2, 0.325, 0.325, -0.08, -0.08),
    (0.2, 0.305, 0.325, 0.05, -0.12),
    (0.184, 0.282, 0.325, 0.045, -0.115),
    (0.163, 0.26, 0.325, 0.015, -0.11),
    (0.14, 0.19, 0.255, -0.09, -0.01),
    (0.06, 0.055, 0.125, -0.04, 0),
    (0, 0, 0.115, -0.045, 0),
]
segments = 48
vertices, rings, faces = [], [], []
for rx, ry, cy, depth, tilt in profile:
    ring = []
    for i in range(segments if rx else 1):
        angle = 2 * math.pi * i / segments
        ring.append(len(vertices))
        # Blender Z-up / -Y-front exports to glTF Y-up / +Z-front.
        vertices.append((rx * math.cos(angle), -(depth + tilt * math.sin(angle)), cy + ry * math.sin(angle)))
    rings.append(ring)
for a, b in zip(rings, rings[1:]):
    for i in range(segments):
        j = (i + 1) % segments
        if len(a) == 1:
            faces.append((a[0], b[j], b[i]))
        elif len(b) == 1:
            faces.append((a[i], a[j], b[0]))
        else:
            faces.append((a[i], a[j], b[j], b[i]))

mesh = bpy.data.meshes.new("Urinal shell")
mesh.from_pydata(vertices, [], faces)
mesh.update()
body = bpy.data.objects.new("Urinal", mesh)
scene.collection.objects.link(body)
bpy.context.view_layer.objects.active = body
body.select_set(True)
body.data.materials.append(ceramic)
subdivision = body.modifiers.new("Rounded ceramic", "SUBSURF")
subdivision.levels = 2
bpy.ops.object.modifier_apply(modifier=subdivision.name)

# Normalize the authored mesh itself, so wall placement needs no corrective
# transform: back at Z=0, bottom at Y=0, front at Z=0.35 in glTF coordinates.
mins = [min(v.co[i] for v in body.data.vertices) for i in range(3)]
maxs = [max(v.co[i] for v in body.data.vertices) for i in range(3)]
sizes = (0.4, 0.35, 0.65)
for vertex in body.data.vertices:
    for i in range(3):
        vertex.co[i] = (vertex.co[i] - mins[i]) * sizes[i] / (maxs[i] - mins[i])
    vertex.co.x -= 0.2
    vertex.co.y -= 0.35
for polygon in body.data.polygons:
    polygon.use_smooth = True

def project_uvs(obj):
    # Project in metres rather than stretching each island to the unit square.
    obj.data.update()
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name="UVMap")
    for polygon in obj.data.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        axes = ((1, 2), (0, 2), (0, 1))[axis]
        for loop_index in polygon.loop_indices:
            point = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (point[axes[0]], point[axes[1]])


project_uvs(body)

# The small drain cap sits on the lowest inner section; it is visual detail,
# not a plumbing connection or a manufacturer-specific fitting.
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(0, -0.139, 0.112))
drain = bpy.context.object
drain.name = "Drain"
drain.scale = (0.025, 0.006, 0.022)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
drain.data.materials.append(chrome)
for polygon in drain.data.polygons:
    polygon.use_smooth = True
project_uvs(drain)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
drain.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT / "model.glb"),
    export_format="GLB",
    use_selection=True,
    export_extras=True,
    export_cameras=False,
    export_lights=False,
)

scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.7, 0.75, 0.8, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4
scene.view_settings.view_transform = "AgX"


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


for name, position, energy, size in [
    ("Key", (1, -2, 2), 110, 1.8),
    ("Fill", (-1, -0.5, 1), 55, 1.4),
    ("Rim", (0, 1, 1.5), 80, 1),
]:
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.shape = "DISK"
    light.size = size
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = position
    point_at(obj, (0, -0.15, 0.3))

camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.type = "ORTHO"
camera.data.ortho_scale = 0.85
camera.location = (1, -1.6, 1.0)
point_at(camera, (0, -0.15, 0.325))
scene.render.resolution_x = 450
scene.render.resolution_y = 450
scene.render.filepath = str(OUTPUT / "thumbnail.png")
bpy.ops.render.render(write_still=True)

camera.location = (0, -0.175, 3)
camera.rotation_euler = (0, 0, 0)
camera.data.ortho_scale = 0.4
scene.render.resolution_x = 400
scene.render.resolution_y = 350
scene.render.filepath = str(OUTPUT / "floor-plan.png")
bpy.ops.render.render(write_still=True)
