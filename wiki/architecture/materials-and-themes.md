# Materials & themes (surface colour)

How a node's surfaces get their colour. Applies to: `packages/viewer/src/lib/{materials.ts,scene-themes.ts}`, the per-kind material logic in `packages/viewer/src/systems/<kind>/` and `packages/nodes/src/<kind>/`, and the appearance state in `packages/viewer/src/store/use-viewer.ts`.

## The axes

Appearance is a set of orthogonal axes, all held in `useViewer`:

| State | Values | What it controls |
|---|---|---|
| `shading` | `'solid' \| 'rendered'` | `solid` = `MeshLambertNodeMaterial`, no SSGI/AO. `rendered` = `MeshStandardNodeMaterial` + SSGI/AO. |
| `textures` | `boolean` | Whether surfaces that have a real material/preset show their texture. |
| `colorPreset` | `'clay' \| 'white' \| 'mono' \| 'blueprint'` | The per-role base palette for untextured surfaces. |
| `sceneTheme` | theme id (`studio`, `mediterranean`, `night`, `verdant`, …) | Lighting + background + ground + per-role colour tints. See [scene themes](#scene-themes). |
| `shadows` | `boolean` | Directional shadow casting (always-on key light; see `lights.tsx`). |
| `edges` | `'off' \| 'soft' \| 'strong'` | Screen-space ink outline in `post-processing.tsx` (`lib/ink-edges.ts`). |

`shading`/`textures`/`colorPreset` are persisted per-context; `shadingByContext` lets the editor default to `solid` and the community viewer to `rendered`.

## Surface roles

Every registry kind may declare one token on its `NodeDefinition` (`packages/core/src/registry/types.ts`):

```ts
surfaceRole?: 'wall' | 'floor' | 'ceiling' | 'roof' | 'joinery' | 'glazing' | 'furnishing'
```

`core` only stores the token — it carries no colour and never imports three.js. The token is what lets a wall, a slab, a column, etc. each resolve a *different* colour from the same palette.

## Resolving a colour

The single source of truth is in `packages/viewer/src/lib/materials.ts`:

```ts
resolveSurfaceColor(role, colorPreset, sceneThemeId?)
  // = getSceneTheme(sceneThemeId).clayTints?.[role]   // theme override, if any
  //   ?? PRESET_PALETTES[colorPreset][role]            // else the preset palette
```

`createSurfaceRoleMaterial(role, colorPreset, side?, sceneThemeId?)` wraps that in a lit `MeshLambertNodeMaterial`, **cached by `role-preset-side-sceneTheme`**. The cache key is why every consumer must thread `sceneTheme` through — otherwise switching themes returns a stale cached material.

## The rule: untextured surfaces are theme-coloured in both modes

This is the important invariant. A surface is "textured" only if its node has an explicit `materialPreset` or `material`.

- **`textures` off** → every surface uses `resolveSurfaceColor(role, …)`.
- **`textures` on** → textured surfaces show their texture; **untextured surfaces still use `resolveSurfaceColor`** (not a hardcoded white/grey default).

So picking the Mediterranean theme gives a blue roof + warm walls without touching the textures toggle. There is no "all white" mode — untextured always means "themed role colour".

### Where it's wired per kind

| Kind | Where the role colour is applied |
|---|---|
| wall | `systems/wall/wall-materials.ts` (`getMaterialsForWall`), re-applied each frame by `wall-cutout.tsx` |
| roof / roof-segment | `systems/roof/roof-materials.ts` (`getRoofMaterialArray`) |
| slab | `nodes/slab/geometry.ts` (`getSlabMaterial`) |
| ceiling | `nodes/ceiling/renderer.tsx` |
| generic registry kinds | `systems/geometry/geometry-system.tsx` → `applyDefaultSurfaceRole` (textures-off) |
| door / window | `systems/{door,window}/*-system.tsx` |
| stair / column / item / elevator | `nodes/<kind>/renderer.tsx` |

Each of these reads `shading`/`textures`/`colorPreset`/`sceneTheme` from `useViewer` (or receives them threaded from `GeometrySystem`) and **must include `sceneTheme` in its material cache key and its rebuild dependency array**, or theme switches won't re-colour. `GeometrySystem` marks every geometry node dirty on any of those changing.

## Custom-mesh face materials

blockes use the reusable `MaterialRef` model through stable, user-named object slots. `BlockNode.slots` maps slot IDs to `scene:` or `library:` references, `slotNames` stores their editable labels, and each `BlockFace.materialSlot` stores one slot ID. `body` is the permanent base slot and the fallback for unbound or unresolved slots.

The geometry builder emits one Three.js group per topology face and a material array ordered by the node's stable slot IDs. It publishes that render-material order as `userData.slotIds` and records each face's vertex range in `geometry.userData.blockFaces`. The paint capability re-raycasts the mesh and maps the hit triangle through those ranges to a stable topology face ID, so preview and commit affect only that face. Face UVs retain the world-scale projection contract below.

The block inspector calls this collection **Slots**. Users add and rename slots independently from their material binding. A compact dropdown changes the active slot's material using deduplicated `MaterialRef`s already used by scene node slots plus reusable scene-material datablocks. Choosing a slot changes only the transient assignment source; **Assign** applies that slot to the selected faces. **Select** and **Deselect** only add or subtract faces using the active slot from transient component selection.

Deleting a non-body slot remaps every assigned face to `body` in the same node update, and `body` becomes the active assignment source. The reusable scene or library material remains available to other nodes.

The global Paint tool resolves the hit face's assigned slot and changes that slot's material binding. A fresh mesh has every face assigned to `body`, so its first paint updates the entire mesh. Once faces are assigned to named slots, painting any one of those faces updates every face using that slot. A one-off material reuses a structurally matching scene material before creating a reusable scene material. Erasing clears the slot binding; `body` returns to the wall-role default and other unbound slots fall back to `body`.

Topology operators preserve assignments deterministically:

- retained and transformed faces keep their slot;
- extrude caps/sides and inset caps/rings inherit the source face;
- loop-cut pieces inherit the face they split;
- bevel bands and mixed-material dissolve use the first adjacent face in stable `topology.faces` order;
- deleting the last face that uses a slot does not delete its reusable material.

### External plugin renderers

Plugin renderers follow the same four axes through the public `@pascal-app/viewer`
surface. For an imported hierarchy, capture its authored materials once and apply
this mapping reactively:

| Host state | Imported material |
|---|---|
| Colored + Rendered | Authored material |
| Colored + Solid | Cached Lambert variant retaining colour, albedo map, alpha, and slots |
| Monochrome | `createSurfaceRoleMaterial(surfaceRole, colorPreset, side, sceneTheme)` |

The adapter belongs to the plugin renderer because it owns the hierarchy and knows
which surfaces are furnishing, glazing, or another role. Material swaps happen on
preference changes, never in `useFrame`. Restore authored materials before disposing
the loader-owned hierarchy, dispose only plugin-owned variants, and leave host-cached
role materials alone.

Edges and the expensive render pipeline do not need a plugin material hook: they are
screen-space host passes over `SCENE_LAYER`. Placement ghosts should use the editor
overlay layer so they remain crisp and do not enter the scene depth/normal targets.

## Scene themes

A `SceneTheme` (`lib/scene-themes.ts`) bundles everything that defines a "look":

| Field | Drives |
|---|---|
| `appearance: 'light' \| 'dark'` | 2D scene chrome — canvas backdrop, grid line colours, measurement-label/cursor contrast. (There is **no** separate light/dark toggle; the theme owns this.) |
| `background` | The 3D backdrop, mixed in `post-processing.tsx` where there is no geometry. |
| `ground` | The site ground fill (`nodes/site/renderer.tsx`) and the infinite ground-occluder plane (`viewer/ground-occluder.tsx`). Kept separate from `background` so dark themes get a lit mid-tone ground instead of near-black. |
| `lights` / `ambient` / `hemi` | The light rig (`lights.tsx`). One key light casts shadows. |
| `toneMappingExposure` | Renderer exposure. |
| `clayTints?` | Per-`SurfaceRole` colour overrides layered on top of `colorPreset` (see [resolving a colour](#resolving-a-colour)). |

The editor UI chrome is always dark (a fixed `document.body.classList.add('dark')`) and is independent of `appearance`.

## Adding a theme

Append a `SceneTheme` to `SCENE_THEMES` with all required fields. `clayTints` is a `Partial` — any role you omit falls back to the active `colorPreset`. The theme pickers (toolbar + community overlay) render a 2×2 swatch from `clayTints` over `background`, so populate at least `wall`/`roof`/`floor`/`glazing` for a good swatch.

## Texture world scale (UVs in metres)

Every procedural surface generates UVs in metres: 1 UV unit = 1 m.

This contract is shared by wall `systems/wall/wall-system.tsx` (`ExtrudeGeometry`), slab `systems/slab/slab-system.tsx` (`generatePositiveSlabGeometry`, and `generatePoolGeometry`), ceiling `systems/ceiling/ceiling-system.tsx`, roof `systems/roof/roof-system.tsx`, and chimney/dormer `nodes/src/chimney/geometry.ts`.

GLB item slots follow the same ~1 UV unit/m authoring convention, enforced by the slot validator's UV-presence check and the Blender recipe in [item-authoring](item-authoring.md). This is an authoring requirement, not a render-time correction.

A catalog material's `repeat` (`mapProperties.repeatX/repeatY` in `packages/core/src/material-library.ts`) is therefore a per-material world-scale setting: tiles per metre.

`repeat: 1` means 1 tile/m, `0.4` means one tile every 2.5 m, and `1.5` means 1.5 tiles/m.

Repeat is a property of the material, identical for every surface that uses it, never per-item or per-surface. Custom repeat values are intentional material scale, not per-surface hacks.
