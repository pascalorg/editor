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
