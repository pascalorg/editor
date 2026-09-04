# 06 — Blender Data Model for a Lossless Pascal Scene Graph

**Target:** Blender 4.5 LTS (all claims below verified empirically against Blender **4.5.3 LTS**, headless, factory startup, on macOS — probe scripts in `/tmp/blender_probe*.py`).

**Goal:** represent an external parametric scene graph (Pascal nodes: site → building → level → elements, each with an ID, type, and parameter dict) inside a `.blend` file with **zero information loss**, while keeping the file a pleasant, idiomatic Blender project for humans.

**Core strategy (summary):**

1. **Source of truth:** store the complete original JSON verbatim in a **Text datablock** (`bpy.data.texts["pascal_source.json"]`) — byte-exact round-trip verified.
2. **Per-node data:** mirror each node's ID/type/params onto the corresponding datablock as **custom properties (ID properties)**, following the glTF importer's `extras` precedent (`pascal_id`, `pascal_type`, `pascal_params`, …).
3. **Never rely on datablock names for identity.** Blender renames on collision (`.001`) and truncates at **63 bytes**. Names are display labels; `pascal_id` custom props are identity.
4. **Hierarchy:** Collections for the site/building/level containers; objects (meshes + empties) inside them. Convert Y-up→Z-up **into the data at import time** (the glTF-importer way), keep the scene in meters.

---

## 1. Custom properties (ID properties) in Blender 4.5

### 1.1 Which datablocks support them

Verified in 4.5.3 — assignment `datablock['key'] = value` works on:

| Type | ID props? | Custom Properties UI panel? |
|---|---|---|
| `Scene` | ✅ | ✅ (Scene properties tab) |
| `World` | ✅ | ✅ |
| `Object` | ✅ | ✅ (Object tab) |
| `Mesh` (and other object data) | ✅ | ✅ (Object Data tab) |
| `Collection` | ✅ | ✅ (`COLLECTION_PT_collection_custom_props`) |
| `Material` | ✅ | ✅ |
| `Light`, `Camera`, `Armature`, `Image`, `Action`, `Text` | ✅ | ✅ (where a properties tab exists) |
| `NodeTree`, individual `Node` | ✅ | shown in N-panel Item for nodes |
| `ViewLayer`, `Bone`, `PoseBone` | ✅ | ✅ |
| **`Modifier`** | ❌ `TypeError: id properties not supported for this type` | — |

Practical upshot: every container we care about (Scene, Collection, Object, Mesh, Material, World) takes custom properties. Only non-ID structs like modifiers don't.

> Note: 4.5 does **not** have the `system_properties` split that landed in 5.x (`hasattr(id, 'system_properties') == False` in 4.5.3). All ID properties on a datablock live in one group and all show in the UI panel.

### 1.2 Supported value types (verified)

| Python value | Stored as | Round-trips save/load? | Notes |
|---|---|---|---|
| `int` | C `int` (32-bit) | ✅ | **`2**31` raises `OverflowError`** — max `2147483647`. Store 64-bit IDs/timestamps as *strings*. |
| `float` | C `double` | ✅ bit-exact (`3.141592653589793` survives exactly) | |
| `bool` | bool | ✅ stays `bool` after reload (not int) | |
| `str` | UTF-8 string | ✅ (unicode incl. CJK, emoji, `\n`, `\t`, quotes, backslashes verified) | |
| `None` | `NoneType` idprop | ✅ survives save/reload, top-level **and** nested in dicts | JSON `null` is representable — good. |
| `bytes` | bytes | ✅ | |
| `dict` (nested, any depth) | `IDPropertyGroup` | ✅ (5-level nesting verified) | insertion order preserved, incl. across save/reload |
| `[int,…]`, `[float,…]`, `[bool,…]` | `IDPropertyArray` (typecodes `i`/`d`/`b`) | ✅ | **mixed `[1, 2.5]` coerces all to float** (`d`) |
| `["a","b"]`, `[{…},…]`, `[[…],…]` | Python-style idprop list | ✅ | |
| `[]`, `{}` | empty array / empty group | ✅ | |
| `tuple` | converted to `IDPropertyArray` | ✅ (comes back as array, not tuple) | |
| **mixed list `[1, "a", {…}]`** | ❌ `TypeError: only floats, ints, booleans and dicts are allowed in ID property arrays` | — | heterogeneous JSON arrays **cannot** be mirrored 1:1 — see §1.4 |
| `set` | ❌ `TypeError` | — | |

### 1.3 Size and key limits (verified)

- **Property key names: max 63 characters** (`KeyError: 'the length of IDProperty names is limited to 63 characters'` at 64). Applies to **nested dict keys too**.
- **Failed assignment is atomic-ish but destructive**: assigning a dict containing one over-long key raises and the *entire* property ends up absent — validate keys before mirroring.
- Unicode keys allowed (`obj["clé_日本"]` works) — but the 63 limit is characters-as-bytes at the name-buffer level; keep keys ASCII and short.
- **Value size:** effectively unbounded. A **10 MB unicode string** in a Scene custom property assigned in 0.004 s, survived uncompressed *and* compressed save/reload with identical SHA-256.
- Int range: signed 32-bit only (see table).

### 1.4 Zero-loss caveats when mirroring JSON into ID properties

ID properties are *almost* a JSON superset, with exactly these mismatches:

1. **Heterogeneous arrays** (`[1, "a"]`) — unsupported. 2. **Mixed int/float arrays** promote ints to floats. 3. **Ints ≥ 2³¹** overflow. 4. **Key length > 63** raises. 5. Numeric key order inside a dict is preserved, but a JSON document's *formatting* (whitespace, key duplication, number formatting like `1.0` vs `1`) is not.

**Design consequence:** custom properties are the **convenience mirror** for humans and tooling; the verbatim JSON Text datablock (§2) is the **lossless source of truth**. If a node's params contain a heterogeneous array or big int, store that subtree as a JSON *string* prop (e.g. `pascal_params_json`) and skip the pretty mirror for it.

### 1.5 Python API (4.5)

```python
obj["pascal_id"] = "node-7f3a"          # create/assign (dict-style)
obj.get("pascal_id")                     # read with default
"pascal_id" in obj / obj.keys()          # membership / iterate
del obj["pascal_id"]                     # remove

grp = obj.id_properties_ensure()         # -> IDPropertyGroup (the root group; creates if missing)
obj.id_properties_clear()                # wipe all idprops
ui = obj.id_properties_ui("height_m")    # UI metadata manager (int/float/string props only)
ui.update(min=0, max=10, soft_max=5, default=2.5,
          description="Wall height", subtype='DISTANCE')
ui.as_dict()                             # inspect
obj.property_overridable_library_set('["height_m"]', True)  # allow library overrides
```

Verified behaviors:

- `id_properties_ui()` works for scalar/string props; **raises `TypeError` on dict (`IDPropertyGroup`) props** ("does not support UI data"). UI metadata (min/max/subtype/description/default) **survives save/reload**, as does the library-overridable flag.
- `IDPropertyGroup.to_dict()` / `IDPropertyArray.to_list()` convert back to plain Python; `to_dict()` preserves `None` values and key order. A `json → idprop → to_dict() → json` round-trip is exact for JSON documents that avoid the §1.4 caveats (verified).
- Everything above **persists in the .blend** (uncompressed and compressed verified) *provided the owning datablock is saved* — see §1.6.

### 1.6 What survives save/load — the zero-users trap

ID properties themselves always survive; **the datablock they sit on might not**. Blender garbage-collects datablocks with zero users on save:

- An unlinked `Collection` (not a child of any scene's collection tree) **was purged on save** (verified: unlinked collections vanished after reload).
- Materials/Worlds/etc. with no users are purged unless `use_fake_user = True` (verified survival with fake user).
- **Text datablocks default to `use_fake_user = True` in 4.5** (verified) — they survive without any extra step.

Rule: every datablock carrying Pascal data must be reachable from the scene (linked) or fake-user'd.

### 1.7 UI visibility

All ID properties on Scene/Object/Mesh/Collection/Material/World appear in the corresponding **Properties editor → Custom Properties** panel (edit/remove buttons included). Dict-valued props display via their `to_dict()` repr (see `rna_prop_ui.py`); long arrays and nested groups are shown read-only-ish as text. Scalars with `id_properties_ui` metadata render as proper sliders with units (e.g. `subtype='DISTANCE'` shows meters).

---

## 2. Storing the complete original JSON

Two candidate homes; **use a Text datablock as primary**, optionally duplicating into a Scene prop.

### 2.1 Text datablock (`bpy.data.texts`) — recommended

```python
txt = bpy.data.texts.get("pascal_source.json") or bpy.data.texts.new("pascal_source.json")
txt.clear()
txt.from_string(json_str)      # fast bulk path
round_trip = txt.as_string()   # exact
```

Verified round-trip safety:

- **Byte-exact**: unicode (CJK, accents, ✓), embedded `null`, quotes/escapes, trailing-newline vs no-trailing-newline, and even `\r\n` line endings all round-trip exactly via `from_string()`/`as_string()` and across save/reload (SHA-256 compared, 10 MB payload).
- Text datablocks are **line-based** internally but this does not corrupt content (a 1.6 MB pretty-printed JSON and a 10 MB multi-line blob round-tripped exactly).
- `use_fake_user` defaults to **True** → survives save with zero users.
- Name obeys the 63-byte datablock limit (`"N"*100` → truncated to 63) — fine for `pascal_source.json`.

**Performance gotcha (verified, big):** Text write speed is line-length-bound, not size-bound:

| Payload | `from_string()` time |
|---|---|
| 100 kB single line | 0.14 s |
| **1 MB single line** | **13.4 s** (quadratic in line length) |
| 10 MB multi-line (120-char lines) | 0.009 s |
| 1.6 MB pretty-printed JSON (`indent=2`) | 0.004 s |

→ **Always store pretty-printed (or otherwise line-broken) JSON**, never minified single-line JSON, in a Text datablock. If you must store minified, put it in a Scene string prop instead (10 MB assign = 0.004 s).

Pros: visible/editable in the Text Editor (great debuggability), diff-able mental model, exact round-trip, no size issue, addon scripts can `json.loads(txt.as_string())`.
Cons: a user can edit or delete it (mitigate: also store a content hash + schema version as Scene props and validate on export); minified-JSON perf trap above.

### 2.2 Scene custom property — good secondary

`scene['pascal_source_json'] = json_str` — verified exact for 10 MB unicode strings, fast regardless of line structure, survives compressed save.
Pros: harder to fat-finger-edit than a text block; travels with the Scene on append/link.
Cons: renders as one giant string field in the Custom Properties panel (UI pain); invisible to casual inspection.

### 2.3 Recommended metadata block (Scene props)

```python
scene['pascal_schema_version'] = "1.0"
scene['pascal_source_hash']    = hashlib.sha256(json_bytes).hexdigest()
scene['pascal_source_text']    = "pascal_source.json"   # name of the Text datablock
scene['pascal_import_time']    = "2026-08-01T12:00:00Z" # string, not int (32-bit int limit!)
```

---

## 3. Collections

Verified semantics in 4.5.3:

- **Nesting:** arbitrary depth (`Site → Building → Level-0` verified). The structure is a **DAG, not a tree** — the same collection can be linked under two parents (verified), and an object can be linked into multiple collections simultaneously (verified). Cycles are blocked at the API level (`RuntimeError: Collection 'Site' already in collection 'Level-0'`). For a clean hierarchy mirror, enforce single-parent by convention.
- **Naming:** datablock names are limited to **63 bytes, not characters** (verified: 100×`A` → 63 chars; 60×`é` (2-byte) → 31 chars/62 bytes; 60×`日` (3-byte) → 21 chars/63 bytes). Truncation is UTF-8-aware (never splits a codepoint).
- **Collisions:** names are unique **per datablock type** (a Mesh and an Object may both be `PascalWall`; two Collections cannot both be `Level` — second becomes `Level.001`).
- **Instancing:** an Empty with `instance_type='COLLECTION'` + `instance_collection` instantiates a whole collection (verified) — the natural mapping for repeated Pascal subtrees (typical apartments, repeated fixtures). `Collection.instance_offset` sets the instancing origin.
- **Exclusion/visibility:** the per-view-layer checkbox is `LayerCollection.exclude` (found by walking `view_layer.layer_collection.children`), **not** on the Collection ID; it persists in the file (verified). ID-level `Collection.hide_viewport` / `hide_render` also exist and apply globally. `color_tag` (`'COLOR_01'`…`'COLOR_08'`) is handy for visually distinguishing Pascal-managed collections.
- Collections take custom properties and they survive reload (verified) — so containers carry `pascal_id` just like objects.
- **Unlinked collections are purged on save** (§1.6) — always link Pascal collections into `scene.collection` tree.

---

## 4. Object naming: why Pascal IDs must live in custom props

Verified renaming behavior:

- Creating/renaming to an existing name of the same ID type silently appends `.001`, `.002`, … (rename-onto-existing gave `PascalWall.003`). Suffix counts beyond `.999` keep growing (`Dup.1004` verified) — the counter is not capped at 3 digits.
- Freed suffixes are reused: after deleting `PascalWall.001`, the next `PascalWall` became `PascalWall.001` again → **names are not stable identifiers over edit sessions**.
- At the 63-byte cap, collision handling **truncates the base name to make room for the suffix**: four objects named `B*63` came back as lengths 63, 62, 61, 60 (each ending `...BBB.001` etc. within 63 bytes) — so long IDs get silently mangled *twice* (truncation + suffix).
- Any UTF-8 is legal in names, including `/ . :` (verified `a/b.c:d`).

**Implication:** a UUID (36 chars, verified fits) *could* be a name, but a second import of the same node, a user duplicate (Shift-D), or an append would silently produce `<uuid>.001` and break the mapping. Therefore:

- **Identity:** `datablock['pascal_id'] = "<node-id>"` on Object **and** its Mesh/Collection. Custom props are duplicated verbatim on user-duplication, so exporters must treat `pascal_id` + one-of-many resolution (or a `pascal_instance` marker) explicitly.
- **Names:** human-readable, best-effort, e.g. `"{type}:{short-id} {label}"` truncated to fit 63 bytes; never parsed on export.
- Build the export map by scanning `pascal_id` props, not `bpy.data.objects[name]`.

---

## 5. Units and axes

### 5.1 Units — meters

```python
us = scene.unit_settings
us.system = 'METRIC'        # enum: NONE / METRIC / IMPERIAL
us.scale_length = 1.0       # 1 Blender unit = 1 m
us.length_unit = 'METERS'
```

Verified: factory default in 4.5.3 is already `METRIC / 1.0 / METERS`; the settings persist per-Scene in the file. Set them explicitly anyway (defaults can differ per user startup file). Note `length_unit`'s enum is populated dynamically from `system` (RNA introspection only shows `DEFAULT`; assignment of `'METERS'` works and persists — verified). The glTF importer consumes `scale_length` as its unit factor (`u = 1.0 / scale_length`), confirming `scale_length=1.0` ⇒ meters convention.

### 5.2 Axis conversion — the glTF importer convention

Pascal is Y-up (glTF-style); Blender is **Z-up, right-handed**. The official glTF importer (`io_scene_gltf2`, bundled with 4.5.3) converts, verified from its source (`blender/imp/blender_gltf.py::set_convert_functions`):

```
location:  (x, y, z)_gltf  →  (x, −z, y)_blender          # X, -Z, Y
quaternion (x,y,z,w)_gltf  →  (w, x, −z, y)_blender
scale:     (x, y, z)       →  (x, z, y)
```

i.e. a +90° rotation about X applied *into the math*, plus a camera/light correction quaternion (`Quaternion((√2/2, √2/2, 0, 0))`) because those objects aim down −Z/+Y differently. The exporter's mirror option is `export_yup` (**"+Y Up", default True**).

**Where to apply the conversion — bake it into the data (the importer way):**

- The glTF importer converts **every node TRS and every mesh vertex/normal at import time** (`gltf.locs_batch_gltf_to_blender(vert_locs)` in `imp/mesh.py`), producing a file with **no compensating root rotation**.
- **Do the same for Pascal.** Do *not* park the scene under a root empty with `rotation_euler.x = radians(90)`: that leaves every world matrix "lying" about up, breaks physics/snapping/walk-nav assumptions, survives poorly through Apply-Transform, and makes exported values need double bookkeeping.
- Concretely: transform node translations/rotations with the mapping above; transform authored mesh coordinates with the same swap; on export, apply the exact inverse `(x, y, z)_blender → (x, z, −y)_gltf`. This is lossless (a pure signed axis permutation — no floating-point rounding beyond sign flips).
- Keep original transform values available for paranoid round-tripping by storing the node's raw source TRS in `pascal_params` (or rely on the verbatim JSON text block).

---

## 6. Empties vs Collections for site/building/level containers

| Criterion | Empty (parent object) | Collection |
|---|---|---|
| Carries a transform | ✅ (children inherit) | ❌ (only `instance_offset`, used when instanced) |
| Outliner UX | one flat object tree; children indent under parent | first-class hierarchy UI, checkboxes, isolation, color tags |
| Per-container hide/exclude/render toggles | via object hide (affects children only through parenting quirks) | ✅ per view-layer `exclude`, `hide_viewport`, `holdout`, `indirect_only` |
| Instancing a subtree | ❌ (must duplicate) | ✅ collection-instance empties (verified) |
| Membership | strictly one parent | object may be in several collections; collection may have several parents (DAG) |
| Custom properties | ✅ | ✅ (verified, survives reload) |
| Transform inheritance pitfalls | scale/rotation on the container silently affects all children | none — collections don't transform |
| Selection/export grouping | manual | natural (`collection.all_objects`) |

**Recommendation (matches how architects use Blender and how the glTF importer builds scenes):**

- **Site / Building / Level → Collections** (`Site`, `Site/Building-A`… as nested collections). These are *organizational* nodes; giving them transforms via empties invites accidental scaling of a whole building. Store `pascal_id`/`pascal_type` props on the collection.
- **If a Pascal container node carries a non-identity transform** (e.g. a building rotated on the site), add **one Empty per transformed container** as the parent of that container's objects (empty display type `PLAIN_AXES`, default size 1.0 — verified), *inside* its collection: collection = grouping, empty = transform. The glTF importer itself represents intermediate scene-graph nodes as empties, so this is precedented.
- **Repeated subtrees → collection instances** (empty with `instance_type='COLLECTION'`).
- Levels one wants to solo/hide get that for free via layer-collection `exclude` (persists; verified).

---

## 7. The glTF `extras` precedent (what we're copying)

Bundled importer `io_scene_gltf2` (4.5.3) — `blender/com/extras.py`:

- **Import:** `set_extras(blender_element, extras)` copies every key of a node/mesh/material/camera/light/scene `extras` dict **directly into custom properties** (`blender_element[key] = value`); values that fail assignment (e.g. heterogeneous arrays, §1.4) are **stringified as fallback** (`str(value)`) rather than dropped. Applied to Objects (node extras), Meshes (mesh extras, excluding `targetNames`), Materials, Lights, Cameras, Scene, and even edit/pose bones. Scene-extras import is gated by an `import_scene_extras` option (default on); node/mesh extras are imported unconditionally.
- **Export:** `generate_extras()` walks `element.keys()`, skips a `BLACK_LIST` (internal keys like `cycles`, `glTF2ExportSettings`), converts `IDPropertyArray → to_list()`, `IDPropertyGroup → to_dict()` (with a JSON-convertibility check), and emits them as `extras`. Gated by the `export_extras` option ("Custom Properties", default **off**).

**Pascal should mirror this design, with the same defensive moves:**

```python
def apply_pascal_node(db, node):                     # db: Object/Mesh/Collection/Material
    db['pascal_id']   = node['id']                   # identity — never in the name
    db['pascal_type'] = node['type']
    try:
        db['pascal_params'] = node['params']         # pretty mirror (dict idprop)
    except (TypeError, OverflowError, KeyError):     # §1.4 mismatches
        db['pascal_params_json'] = json.dumps(node['params'], ensure_ascii=False)
```

plus a reserved-prefix blacklist (`pascal_*`) so user-added custom props are ignored by the exporter, and the verbatim source (§2) as the ultimate fallback.

---

## 8. Checklist for the importer implementation

1. `scene.unit_settings ← METRIC / 1.0 / METERS`; convert axes into data (§5.2).
2. Write pretty-printed source JSON to Text datablock `pascal_source.json` (`from_string`; never single-line — 13 s vs 4 ms at 1 MB); store sha256 + schema version as Scene props.
3. Create Collections for containers, Objects/Meshes for elements; link everything under `scene.collection` (zero-user purge!).
4. Stamp `pascal_id` / `pascal_type` / `pascal_params` on every created datablock; validate keys ≤ 63 chars, ints < 2³¹, no heterogeneous arrays — fall back to `*_json` string props.
5. Add `id_properties_ui` metadata (units, min/max, descriptions) on scalar params you want editable — it persists and gives real sliders.
6. Never read identity from names; export by scanning `pascal_id`.
