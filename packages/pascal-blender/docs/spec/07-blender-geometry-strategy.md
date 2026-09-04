# 07 — Blender Geometry Strategy (Blender 4.5 LTS)

How the importer add-on should build parametric architecture geometry in Blender.
Everything marked **[verified]** was executed against **Blender 4.5.3 LTS** headless
(`Blender --background --factory-startup --python ...`) on macOS during research for this doc.

Source-scene inventory this must cover:

- Walls: 2D footprint polygons, extruded, with door/window boolean cutouts
- Slabs/ceilings: polygons with holes (stairwells, shafts)
- 7 parametric roof types
- Parametric doors/windows (frames, panels, glass grids)
- GLB furniture assets (some emissive with a light effect)

---

## 1. Mesh construction: polygon + holes → extruded solid

### 1.1 Filling polygons with holes

Two viable stdlib approaches, no external deps needed:

**Primary: `mathutils.geometry.tessellate_polygon(loops)`** — takes a list of vertex
loops (outer + holes as separate loops, 3D coords with z=0) and returns triangle index
tuples into the *concatenated* vertex list.

- **[verified]** Correctly punches holes: 4×3 rect with 1×1 hole → 8 tris, area exactly 11.0.
- **[verified]** Winding-insensitive: hole loop CW or CCW both give area 11.0. No need to
  normalize winding of source data before tessellating.
- **[verified]** Handles a hole loop touching the outer boundary (degenerate contact) —
  still returned area 11.0. Robust enough for real floor-plan data.

**Fallback for pathological input: `mathutils.geometry.delaunay_2d_cdt(...)`** —
constrained Delaunay, tolerant of self-intersections and duplicate verts.
**[verified]** with `output_type=2` it removes hole faces correctly (area 11.0);
`output_type=0/1` fill the hole (area 12.0), `output_type=3` returns 2 n-gon faces
including a hole-carrying face (not directly usable via `from_pydata`). Use
`output_type=2` and remap via the returned `orig_verts` if we ever hit input
`tessellate_polygon` chokes on. In practice `tessellate_polygon` should be the default.

### 1.2 Build + extrude pipeline (recommended)

`from_pydata` for the cap, then one bmesh pass for extrusion and normals:

```python
import bpy, bmesh, math
import mathutils.geometry as mg

def prism_from_footprint(name, outer, holes, height, z=0.0):
    loops = [[(x, y, z) for x, y in loop] for loop in [outer, *holes]]
    verts = [v for loop in loops for v in loop]
    tris  = mg.tessellate_polygon(loops)

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [list(t) for t in tris])
    me.validate()

    bm = bmesh.new(); bm.from_mesh(me)
    # optional: merge coplanar cap triangles into clean n-gons
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0),
                             verts=bm.verts[:], edges=bm.edges[:])
    geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    up_verts = [g for g in geom['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, height), verts=up_verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()

    obj = bpy.data.objects.new(name, me)
    return obj
```

- **[verified]** end-to-end on a 5×4 slab with a 1×1 stair hole, 0.3 m thick:
  0 non-manifold edges, signed volume exactly 5.7 (= 20·0.3 − 1·0.3), bottom faces
  pointing −Z and top faces +Z after `recalc_face_normals`.
- **[verified]** `bmesh.ops.dissolve_limit(angle_limit≈1°)` collapses the 8 cap
  triangles into 2 clean n-gons. Do this *before* extruding so side quads come out
  one-per-edge and caps stay editable. Skip it if you plan to export back out to
  engines that dislike n-gons; keep it for user-facing Blender scenes.

Notes:

- `recalc_face_normals` gives consistent *outward* normals on any closed extrusion —
  don't hand-manage winding; triangulator output winding is not guaranteed.
- Always call `mesh.validate()` after `from_pydata`; it silently drops degenerate faces
  instead of crashing later.
- Walls are the same routine with the wall's rectangle/segment footprint; multi-segment
  walls can either be one footprint polygon per wall run or one object per segment
  (prefer one object per wall entity from the source scene — keeps 1:1 identity for
  round-tripping and per-wall materials).

## 2. Door/window openings: booleans vs exact geometry

### 2.1 Solver reliability on thin walls **[verified]**

Blender 4.5's Boolean modifier has three solvers: `FAST`, `EXACT` (default), and the
**new `MANIFOLD` solver added in 4.5**. Tested on a 4 m × 0.1 m × 2.7 m wall:

| Case | FAST | EXACT | MANIFOLD |
|---|---|---|---|
| Cutter thicker than wall (0.3 m through 0.1 m) | ok | ok, watertight, exact volume | ok, watertight, exact volume |
| Cutter faces exactly coplanar with wall faces (both 0.1 m) | **fails: 8 non-manifold edges, wrong volume** | ok, watertight, exact volume | ok, watertight, exact volume |
| Door cutter flush with wall bottom (z=0 coplanar) | — | ok, watertight | ok, watertight |

Conclusions:

- **Never use FAST.**
- `EXACT` and `MANIFOLD` both survived coplanar faces and flush-bottom door cuts with
  zero non-manifold edges and exact volumes. Since our generated walls and cutters are
  always closed manifold prisms, `MANIFOLD` is the best fit (it's faster and specifically
  designed for watertight inputs); `EXACT` is the safe fallback and handles non-manifold
  operands (`use_self`, `use_hole_tolerant` options exist on the modifier).
- Even so, make cutters **slightly deeper than the wall** (e.g. thickness + 2 cm,
  centered) as cheap insurance — coplanarity works today but there is no reason to
  ride the edge case.

### 2.2 Live modifiers vs applied vs exact geometry — recommendation

**Recommended default: live Boolean modifier per wall + hidden cutter objects,**
with an "Apply booleans" import option (and apply automatically before any export path).

Why live modifiers are viable and clean **[verified]**:

- A cutter object does **not** need to be visible — hiding it (`hide_viewport=True`,
  `hide_render=True`, `display_type='WIRE'`) does not disable the boolean.
- A cutter doesn't even need to be linked to the scene for the modifier to evaluate
  (verified: unlinked cutter still cut). *But* keep cutters linked in a dedicated
  `Cutters` collection anyway — unlinked objects have 0 users and are garbage-collected
  on save/reload.
- **[verified]** One modifier can take a whole **collection** as operand
  (`operand_type='COLLECTION'`): put all of a wall's opening cutters in one collection
  → exactly one modifier per wall, watertight result. This is the tidiest structure:

  ```
  Scene
  ├── Building/
  │   ├── Wall.001            (Boolean mod → collection "Wall.001 Cutters")
  │   └── ...
  └── IFC_Cutters/            (hidden; hide_viewport, excluded from render)
      └── Wall.001 Cutters/   (one cube per door/window opening)
  ```

- **[verified]** In 4.5 the boolean kept evaluating even with the cutter's collection
  excluded from the view layer, but don't rely on that (historically exclusion removes
  objects from the depsgraph); use `hide_viewport/hide_render` on objects and collection,
  not view-layer exclusion.

Benefits: openings stay editable (move/resize a window by moving its cutter; door/window
asset can be parented to its cutter so both move together), and the wall's base mesh
stays a pristine 6-face prism. Cost: depsgraph evaluation per wall — negligible at
building scale (tens to low hundreds of walls).

**Building exact geometry** (tessellating the wall face with openings as holes, stitching
reveals manually) is the most robust output but by far the most code (each wall face
becomes a polygon-with-holes problem in wall-plane space, plus 4 reveal faces per
opening, plus corner cases when openings touch edges). Not worth it while
EXACT/MANIFOLD are this reliable. Keep it as a documented plan-B only.

**Applied booleans** (`bpy.ops.object.modifier_apply` — **[verified]** works headless
with `temp_override`) is the right choice when the user wants a "baked" scene or when
we detect an export-oriented workflow. Offer it as an importer checkbox:
*"Keep openings editable (live booleans)"*, default on.

Extra: the Boolean modifier's `material_mode='TRANSFER'` **[verified]** can transfer the
cutter's material onto the cut faces — a free way to give window reveals a distinct
material without post-processing face indices.

## 3. Parametric layer: Geometry Nodes vs Python + custom props

### 3.1 What GN would look like

Geometry Nodes *can* express our parametrics. **[verified]** in 4.5:

- Node groups are created via `bpy.data.node_groups.new(..., 'GeometryNodeTree')` and
  inputs exposed with the 4.x interface API:
  `ng.interface.new_socket("Height", in_out='INPUT', socket_type='NodeSocketFloat')`.
- A minimal Wall group (footprint mesh in → `GeometryNodeExtrudeMesh` with Height →
  out) evaluates correctly; modifier inputs are set via ID props keyed `"Socket_1"`,
  `"Socket_2"`, … (not by name — verified key layout).
- All the nodes a wall/roof kit needs exist as GN nodes: `ExtrudeMesh`, `MeshBoolean`,
  `CurveToMesh`, `FillCurve`, `ScaleElements`, `SetPosition`, `Transform`, `ObjectInfo`,
  `Switch`, `MenuSwitch`, `InputNamedAttribute` **[verified all present]**. (There is no
  Solidify GN node; extrude + flip covers it.)

### 3.2 Cost/benefit

Against GN as the primary layer:

- **7 roof types is the killer.** Hip/gable/mansard/etc. as node graphs means building a
  small visual-programming codebase in Python that constructs node trees — much harder
  to write, review, diff, and debug than plain mesh code. Straight-skeleton style roofs
  are genuinely painful in nodes.
- Node-tree construction code is verbose (~5–10 lines per node+links) and versioning
  node groups across Blender releases is an ongoing maintenance tax.
- GN inputs keyed by `Socket_N` are awkward to address programmatically and fragile if
  the group interface is regenerated in a different order.
- Live GN booleans + per-window glass-grid graphs multiply depsgraph cost.

For GN: users get sliders in the modifier panel with real-time updates, and the object
remains procedural after the add-on is uninstalled (node groups are stored in the .blend).

### 3.3 Recommendation

**Plain Python-generated meshes, parameters stored as custom properties, plus a
"Regenerate" operator.** This is the standard pattern for importers (IfcOpenShell/Bonsai
does the same).

- On import, every generated object gets ID props, e.g.:

  ```python
  obj["pascal_type"]   = "wall"          # wall | slab | roof | door | window ...
  obj["pascal_id"]     = source_entity_id
  obj["pascal_params"] = {"height": 2.7, "thickness": 0.1, ...}  # [verified] dict id-props work
  ```

- A `pascal.regenerate` operator reads the props off selected objects and rebuilds the
  mesh **in place** (`bm.to_mesh(obj.data)`) so object identity, parenting, modifiers and
  material slots survive.
- Expose the params in a small N-panel (`bpy.types.Panel` listing the props with a
  Regenerate button). Optionally add `update=` callbacks on a `PropertyGroup` for
  live-ish editing later.
- The live Boolean-cutter structure from §2 already gives users the most-wanted direct
  manipulation (move/resize openings) for free, without GN.

**Optional later milestone:** wrap only *doors/windows* (frame + panel + glass grid —
box-based, GN-friendly) as GN asset groups with exposed Width/Height/Grid params. Walls,
slabs and especially roofs stay Python. Don't block v1 on any GN work.

## 4. Materials

### 4.1 PBR → Principled BSDF (4.x socket names!) **[verified list from 4.5.3]**

The 4.x Principled BSDF renamed most 3.x sockets. Actual input names in 4.5:
`Base Color`, `Metallic`, `Roughness`, `IOR`, `Alpha`, `Normal`, `Emission Color`,
`Emission Strength`, `Transmission Weight`, `Specular IOR Level`, `Sheen Weight`,
`Coat Weight`, …

Mapping table:

| Source param | 4.5 Principled input | Notes |
|---|---|---|
| color | `Base Color` | RGBA tuple; keep A=1, use Alpha for opacity |
| roughness | `Roughness` | direct 0–1 |
| metalness | `Metallic` | direct 0–1 |
| opacity | `Alpha` | also set `mat.surface_render_method='BLENDED'` for EEVEE (4.5 replaces the old `blend_method`-driven pipeline; enum is `DITHERED`/`BLENDED` **[verified]**) |
| glass/transmission | `Transmission Weight` = 1.0, `Roughness` low, `IOR` ≈ 1.45 | prefer transmission over alpha for real glass; for cheap viewport glass, Alpha ≈ 0.3 is fine |
| emissive | `Emission Color` + `Emission Strength` | 3.x's single `Emission` socket is gone |
| double-sided | `mat.use_backface_culling = not double_sided` | Blender shades double-sided by default; single-sided = enable backface culling |

Never look sockets up by index; always `bsdf.inputs["Base Color"]` by name.

### 4.2 Per-face material assignment **[verified]**

Material slots + `polygon.material_index` work exactly as expected:

```python
me.materials.append(mat_inner)   # slot 0
me.materials.append(mat_outer)   # slot 1
for poly in me.polygons:
    poly.material_index = 0 if poly.normal.dot(inward) > 0 else 1
```

For walls, assign inner/outer/edge faces at generation time in the bmesh pass
(`face.material_index` on BMFace) — deciding by normal direction against the footprint
is trivial there. Boolean cut faces inherit the material of the face they slice by
default, or use `material_mode='TRANSFER'` per §2.2.

### 4.3 Image textures with repeat/scale **[verified node chain]**

`UV Map → Mapping → Image Texture → Base Color`:

```python
uv   = nt.nodes.new("ShaderNodeUVMap");   uv.uv_map = "UVMap"
mapp = nt.nodes.new("ShaderNodeMapping"); mapp.inputs["Scale"].default_value = (rx, ry, 1)
tex  = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.extension = 'REPEAT'
nt.links.new(uv.outputs["UV"], mapp.inputs["Vector"])
nt.links.new(mapp.outputs["Vector"], tex.inputs["Vector"])
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
```

- `tex.extension` supports `REPEAT` (default), `EXTEND`, `CLIP`, `MIRROR` **[verified]**.
- Generated meshes need UVs: create with `me.uv_layers.new(name="UVMap")` **[verified]**
  and write per-loop UVs during generation. For walls/slabs the natural choice is
  world-scale box mapping computed in the bmesh pass (u,v = position along the face's
  dominant plane, in meters) — then the Mapping node's Scale is `1/texture_physical_size`
  and textures tile in real-world units. Avoid `bpy.ops.uv.*` (context-dependent);
  writing `loop[uv_layer].uv` in bmesh is deterministic and headless-safe.
- Downloaded textures: `bpy.data.images.load(path, check_existing=True)` against the
  same cache dir as GLBs (§5.3); set `img.colorspace_settings.name='Non-Color'` for
  roughness/normal maps.

## 5. GLB furniture assets

### 5.1 Import **[verified]**

`bpy.ops.import_scene.gltf(filepath=...)` is available and poll-true in background mode
(glTF I/O ships as a core add-on, with Draco decoding available). Useful 4.5 kwargs
**[verified present]**: `import_scene_as_collection` (default True in 4.5 — imports into
a new collection, convenient for us), `import_select_created_objects`, `merge_vertices`,
`import_shading`, `import_pack_images`.

Track imported objects by set-difference on `bpy.data.objects` before/after (verified
pattern) rather than relying on selection, which is unreliable headless.

### 5.2 Repeated assets: collection instancing **[verified]**

For an asset used N times, import **once** into an asset collection, then instance:

```python
inst = bpy.data.objects.new(f"{asset_id}_instance", None)   # empty
inst.instance_type = 'COLLECTION'
inst.instance_collection = asset_col      # collection NOT linked into the scene tree
inst.matrix_world = placement_matrix
scene.collection.objects.link(inst)
```

- Keep the source asset collections inside a hidden `Assets` library collection (or
  don't link them into the scene tree at all — instancing works either way; linked+hidden
  is safer against GC, same reasoning as cutters).
- Alternative: **linked duplicates** (new `Object`s sharing one `Mesh` datablock —
  **[verified]** `obj2 = bpy.data.objects.new(n, obj1.data)`, `mesh.users` increments).
  Choose linked duplicates when instances need per-instance material overrides or when
  the user is expected to enter edit mode; collection instances when assets are
  multi-object hierarchies (typical for GLB furniture — meshes + empties) and placement
  count is high. **Default: collection instancing**, with an import option to "make
  real" (`object.duplicates_make_real`) for users who want editable copies.

### 5.3 Downloading + caching

- Blender 4.5's Python (3.11.11) bundles `requests` 2.32.3 and full `ssl`
  **[verified]** — but `requests` being bundled is an implementation detail of core
  add-ons; use stdlib `urllib.request` to be safe. No wheel needed for HTTP.
- Cache directory: `bpy.utils.extension_path_user(__package__, path="cache", create=True)`
  **[verified API exists]** — the blessed per-extension writable dir. Key cache files by
  content hash or asset id + version (`{sha1(url)}.glb`); skip download on hit.
  `import_scene.gltf` then imports from the cached file path.
- **Respect `bpy.app.online_access`** **[verified attr exists]**: if False (user disabled
  online access, the default in fresh installs is prefs-dependent), don't download —
  import placeholder empties/bounding boxes with the asset id, and report. This is also
  an Extensions-platform review requirement (declare `permissions.network`, §6).
- Downloads must not block the UI thread forever: for v1 a synchronous download inside
  the import operator with a progress report (`wm.progress_begin/update/end`) is
  acceptable; a modal-timer + thread pool is the upgrade path if asset counts get large.

## 6. Add-on packaging for 4.5

### 6.1 Extension, not legacy add-on

Target the **Extensions** format (Blender 4.2+): `blender_manifest.toml` next to
`__init__.py`, no `bl_info` dict. Legacy add-ons still load in 4.5 but are deprecated
and can't declare network permission or wheels. **[verified]** the following manifest
validates and builds with Blender's own tooling
(`Blender --command extension validate|build`):

```toml
schema_version = "1.0.0"
id = "pascal_importer"
version = "0.1.0"
name = "Pascal Importer"
tagline = "Import parametric architecture scenes"
maintainer = "..."
type = "add-on"
blender_version_min = "4.2.0"
license = ["SPDX:GPL-3.0-or-later"]
permissions.network = "Download GLB furniture assets"
permissions.files = "Cache downloaded assets"
```

Because extensions live in the `bl_ext.<repo>.<id>` namespace, use **relative imports
only** inside the package and `__package__` for preferences/paths lookups.

### 6.2 Wheel policy

**Ship zero wheels for v1.** Everything above uses `bpy`, `bmesh`, `mathutils`, stdlib
`json`/`urllib`/`hashlib` — all bundled. If a dependency ever becomes necessary
(e.g. `shapely` for roof straight skeletons), the extension manifest supports it
cleanly: put platform wheels in `./wheels/` and list them under `wheels = [...]` in the
manifest; Blender installs them into the extension's isolated site-packages. Prefer
pure-Python wheels; binary wheels require one per platform tag (macos-arm64, windows-x64,
linux-x64) and inflate the zip. A pure-Python straight-skeleton implementation vendored
as a module is the lighter alternative.

### 6.3 Minimal operator + drag-drop file handler **[verified registers in 4.5.3]**

`bpy.types.FileHandler` (4.1+) gives drag-and-drop of our `.json` scene files into the
3D viewport:

```python
class PASCAL_OT_import(bpy.types.Operator):
    bl_idname = "pascal.import_scene"
    bl_label  = "Import Pascal Scene"
    bl_options = {'REGISTER', 'UNDO'}

    filepath: bpy.props.StringProperty(subtype='FILE_PATH', options={'SKIP_SAVE'})
    apply_booleans: bpy.props.BoolProperty(name="Bake openings", default=False)

    def execute(self, context):
        build_scene(context, json.loads(Path(self.filepath).read_text()),
                    apply_booleans=self.apply_booleans)
        return {'FINISHED'}

    def invoke(self, context, event):
        if self.filepath:                      # set by drag-drop
            return self.execute(context)
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}

class PASCAL_FH_json(bpy.types.FileHandler):
    bl_idname = "PASCAL_FH_json"
    bl_label  = "Pascal Scene"
    bl_import_operator = "pascal.import_scene"
    bl_file_extensions = ".json"               # ";"-separated list supported [verified]

    @classmethod
    def poll_drop(cls, context):
        return context.area is not None and context.area.type == 'VIEW_3D'
```

Caveat: claiming bare `.json` in a drag-drop handler is broad — `poll_drop` limits it to
the 3D viewport, and a distinctive double extension (e.g. `.pascal.json` — matching still
works via `.json`) or a dedicated `.pascal` extension avoids fighting other handlers.
Also register a `File ▸ Import` menu entry (`TOPBAR_MT_file_import.append`) since
FileHandler alone doesn't add one.

## 7. Lights for emissive assets

An "emissive item with light effect" maps to **two things**:

1. **Emissive material** on the visible mesh so the fixture itself glows:
   `Emission Color` + `Emission Strength` on Principled (§4.1). Mesh emission alone *does*
   light scenes in Cycles but is noisy and does nothing useful in EEVEE without probes —
   hence also:
2. **A real light object parented into the asset** **[verified]**:

```python
ld = bpy.data.lights.new(f"{asset_id}_light", 'POINT')   # types: POINT/SUN/SPOT/AREA [verified]
ld.energy = watts                    # Blender light energy is in Watts
ld.color = (r, g, b)
ld.shadow_soft_size = 0.05           # small radius = crisp fixture shadows
light_obj = bpy.data.objects.new(ld.name, ld)
scene.collection.objects.link(light_obj)
light_obj.parent = anchor            # asset root object / instance empty
light_obj.location = local_offset    # emitter position within the asset
```

- With **collection instancing** (§5.2) a light *inside* the asset collection is
  duplicated per instance automatically — put the light in the asset collection if every
  instance should emit; parent it to the placement empty instead if light params vary
  per instance.
- Mapping source intensity: if the source uses lumens, `watts ≈ lumens / 683 / efficacy_factor`;
  in practice calibrate one fixture visually and scale linearly. Source point-ish
  emitters → `POINT`; panels → `AREA` (set `size`); directional spots → `SPOT`
  (`spot_size`, `spot_blend`).
- Set `light_obj.hide_select = False` but keep lights in the asset's collection so
  hiding a fixture hides its light.

## 8. Decision summary

| Topic | Decision |
|---|---|
| Cap fill | `mathutils.geometry.tessellate_polygon` (+ `delaunay_2d_cdt(output_type=2)` fallback) |
| Solid build | `from_pydata` → bmesh `dissolve_limit` → `extrude_face_region` → `recalc_face_normals` |
| Openings | Live Boolean modifier per wall, `MANIFOLD` solver (`EXACT` fallback), one hidden cutter collection per wall; cutters 2 cm over-deep; optional "bake" apply |
| Parametrics | Python meshes + custom props (`pascal_type`/`pascal_params`) + Regenerate operator; GN only as later doors/windows milestone |
| Materials | Principled BSDF with 4.x names (`Base Color`, `Emission Color/Strength`, `Transmission Weight`); slots + `material_index` per face; UV Map→Mapping→Image Texture, `REPEAT` |
| GLB assets | Import once per asset, collection-instance placements; cache in `extension_path_user`; honor `bpy.app.online_access` |
| Packaging | Blender Extension (`blender_manifest.toml`, `permissions.network/files`), no wheels for v1, FileHandler drag-drop + File▸Import menu |
| Lights | Emission material + real POINT/AREA/SPOT light parented in the asset |
