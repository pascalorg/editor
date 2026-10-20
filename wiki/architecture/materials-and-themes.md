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

For kinds without declared slot defaults, a surface is "textured" only if its node has an explicit `materialPreset` or `material`. Kinds with slot defaults use the slot contract described below.

- **`textures` off** → every surface uses `resolveSurfaceColor(role, …)`.
- **`textures` on** → textured surfaces show their texture; **untextured surfaces still use `resolveSurfaceColor`** (not a hardcoded white/grey default).

So picking the Mediterranean theme gives a blue roof + warm walls without touching the textures toggle. There is no "all white" mode — untextured always means "themed role colour".

### Where it's wired per kind

| Kind | Where the role colour is applied |
|---|---|
| wall | `systems/wall/wall-materials.ts` (`getMaterialsForWall`), re-applied each frame by `wall-cutout.tsx` |
| roof / roof-segment | `systems/roof/roof-materials.ts` (`getRoofMaterialArray`) |
| slab | `nodes/slab/geometry.ts` (`getSlabSlotMaterial`) |
| ceiling | `nodes/ceiling/renderer.tsx` |
| generic registry kinds | `systems/geometry/geometry-system.tsx` → `applyDefaultSurfaceRole` (textures-off) |
| door / window | `systems/{door,window}/*-system.tsx` |
| stair / column / item / elevator | `nodes/<kind>/renderer.tsx` |

Each of these reads `shading`/`textures`/`colorPreset`/`sceneTheme` from `useViewer` (or receives them threaded from `GeometrySystem`) and **must include `sceneTheme` in its material cache key and its rebuild dependency array**, or theme switches won't re-colour. `GeometrySystem` marks every geometry node dirty on any of those changing.

Ceilings and slabs use declared slot defaults in colored (`textures` on) mode.
Ceiling undersides use an opaque `BackSide` material in both appearances; only
`ceiling-grid` blends. Slab top, side/underside and optional terrain skirt meshes
can batch separately. Flat slot defaults share the viewer cache by color, roughness
and shading; slab legacy cached materials carry `__pascalCachedMaterial` so geometry
rebuilds leave shared materials alive. Transparent slot overrides draw themselves.

## Procedural item recipe finishes

Recipe slots keep a required authored hex color and may declare
`finish: 'glass' | 'metal' | 'wood'`. On a generated design's first catalog save,
`snapProceduralSlotsToLibrary` calls `resolveProceduralFinishRef(finish, color)` to
select the curated preset nearest to the authored color in CIE76 Lab (D65).
Ties follow the list order below. Glass always selects `library:preset-glass`;
slots without a finish select the nearest flat library color. Explicit overrides,
including an Authored hex pick, are preserved. The recipe hex is never rewritten.
Existing recipes and scene instances are not automatically resnapped.

| Finish | Library preset id | Label | Representative tone |
|---|---|---|---|
| Glass | `preset-glass` | Glass | `#87ceeb` |
| Metal | `metal-steel` | Brushed Steel | `#636363` |
| Metal | `metal-chrome` | Chrome | `#c8ccce` |
| Metal | `metal-brass` | Brass | `#b08d57` |
| Metal | `metal-copper` | Copper | `#cc845b` |
| Metal | `metal-polished` | Polished Metal | `#f3f3f3` |
| Metal | `preset-metal` | Metal | `#c7ccd2` |
| Wood | `wood-finewood27` | Finewood 27 | `#a77440` |
| Wood | `wood-woodplank48` | Wood Plank 48 | `#88654c` |
| Wood | `wood-hungarianparquet2` | Hungarian Parquet 2 | `#663020` |
| Wood | `wood-squareparquet21` | Square Parquet 21 | `#3e220d` |

The wood list is owner-curated: two light browns, one medium brown, and one darkest
brown. Metal includes only the six listed surface finishes, excluding Garage Panel
and other panel textures. Brushed Steel, Copper, and Polished Metal still have
surface texture maps; Chrome, Brass, and Metal use flat material properties.

Representative tones live beside the curated references in `library-colors.ts`.
For wood, they are the arithmetic mean of every sRGB pixel's R/G/B channels in the
1024×1024 source base-color WebPs under `apps/editor/public/material/wood/`:
`finewood_27/finewood_27_basecolor.webp`, `woodplank_48/woodplank_48_BaseColor.webp`,
`hungarian_parquet_2/Hungarian Parquet_2_baseColor.webp`, and
`square_parquet_21/Square Pattern Parquet_21_baseColor.webp`.
For textured metals, the equivalent mean uses the 512×512 base level decoded from
`metal/{stainless_steel_brushed,copper_metal,polished_metal}/*_basecolor_512.ktx2`
with `basisu -unpack -no_ktx -etc1_only`. A small Python script used Pillow's
`ImageStat.Stat(image.convert('RGB')).mean`, rounding each channel to the nearest
integer before hex encoding. Flat finishes use `mapProperties.color`.

Studio and the colored scene renderer resolve the actual library preset, retaining
its texture maps and world-scale repeat (currently one tile per metre for these
finishes). Representative tones only drive nearest-color matching and the 2D
bounds glyph: `proceduralSlotColor` uses them for curated library overrides so a
white texture tint does not produce a white glyph. Absent overrides and Authored
picks use the recipe hex; other library and scene-material color resolution is
unchanged.

Glass remains blue `#87ceeb`, transparency enabled, opacity 0.3, with Fresnel
reflections in rendered shading. The recipe hex does not retint that preset.
Monochrome scene appearance still uses the furnishing theme material. Studio's
Authored option clears a saved slot override (or stores the hex on an unsaved
draft), restoring the opaque authored material.

## Custom-mesh face materials

Blocks use the reusable `MaterialRef` model through stable, user-named object slots. `BlockNode.slots` maps slot IDs to `scene:` or `library:` references, `slotNames` stores their editable labels, and each `BlockFace.materialSlot` stores one slot ID. `body` is the permanent base slot and the fallback for unbound or unresolved slots.

The geometry builder lays the faces out slot by slot and emits one Three.js group per material slot, with a material array ordered by the node's stable slot IDs; a block with a single slot draws with that one material, so node batching can pack it. It publishes that render-material order as `userData.slotIds` and records each face's contiguous vertex range in `geometry.userData.blockFaces`. The paint capability re-raycasts the mesh and maps the hit triangle through those ranges to a stable topology face ID and its slot; preview and commit affect that slot's faces. Face UVs are metres in each face's own frame (`getBlockFaceFrame`, the frame face hosting uses): U runs level along the face and V up it, so courses stay level on every side, slopes tile at true length and no face reads mirrored from outside. This is the world-scale contract below.

The block inspector calls this collection **Slots**. Users can rename slots, and the Paint tool changes a slot's material using reusable scene-material datablocks. While one or more faces are selected in edit mode, clicking a slot binds those faces to it immediately; there is no separate Assign / Select / Deselect button row.

Adding a slot while faces are selected creates the slot, binds those faces to it, and assigns a distinct generated accent material in the same scene update. This makes the new surface visibly different in both edit mode and the rendered model before the user chooses a final paint material. With no selected faces, Add Slot is a no-op so it cannot create an invisible, unused slot.

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

The editor UI chrome follows the host's theme and is independent of `appearance`. The editor sets no `dark` class itself: its chrome and every portal resolve against the host's `.dark` ancestor (the open-source app adds `dark` to `<body>` while its editor page is mounted; Pascal's hosted app lets next-themes set it on `<html>`). Chrome colour literals have a light base with the dark value under `dark:` (`bg-black/4 dark:bg-[#2C2C2E]`), so a new control needs both. `dark:hover:*` ties with `disabled:hover:*` and is emitted later, so a control that resets its hover when disabled resets it under `dark:disabled:hover:` too. Presentation HUDs (Preview, walkthrough, the viewer's controls with their menus and tooltips) and self-contained overlays (cursor badges, room labels, the snapshot viewfinder, the Point and ask layer) stay dark in either theme. A host that owns the theme setting passes `InterfaceThemeRow` (System / Light / Dark) to `SettingsPanel` through `preferences`.

## Underground ambiance

The ground is the medium, and the eye is above it or below it.

**Above the ground, a level below grade shown** (`groundVeiled`): the ground stays solid and a hole opens in it over the below-grade footprint (`nodes/src/site/ground-hole.tsx`). The footprint is baked on the CPU into a signed-distance texture (the polygons the grade ring runs along); the ground's `maskNode` compares that distance to a radius that wanders with one perlin lookup (`HOLE_MARGIN` ± `HOLE_ERODE`), so the cut is a scalloped, noise-thresholded edge with a thin slate rim, and the solid ground's shadow reception is off while it is open. How far it is open is the viewer's `groundHoleOpenNode` (eased with the same 0.7 s, instant with Animation Off). Picks and Follow's sight drop hits inside the hole's guaranteed core (`groundHoleContains`, same bake, the noise not replayed). The faint veil sheets (`ground-veil.tsx`) are now only the ground window's (a hillside in the eye's way) and a capture's (`temporarilyVeilGround`, which sets the solid ground aside); the grade ring draws in all of them. A level only partly below grade (a walk-out) opens the hole over the part of each floor slab the ground stands over, judged at that slab's own floor (`levelPlaneWorldY` plus its elevation, in `belowGradeFootprints` and in `levelGradeStanding`'s samples): the sunken room of a split level is buried by ground the raised part's top is above. On a flat site the datum is that ground: each floor slab is buried or not against it, so a split level whose raised part is at grade is partly below grade over its sunken room (`levelGradeStanding`, not `isLevelBelowGrade`, which is the level as a whole and derives the ground level). No dark mode in this state. **The pit** (`nodes/src/site/ground-pit.tsx`, `ground-pit-geometry.ts`): over a deep level the hole reads as the ground cut open, not a white plate. The walls are cut once per footprint change by walking the hole's own threshold (`distance < radius`) on a fine grid, with the shader's fractal noise ported to the CPU (`hole-noise.ts`, three's MaterialX perlin; keep the two in step if the hole's noise changes); each wall carries a `drop` attribute, and the shader drops it from grade to the shown level's floor (`belowGradeFloorY` in core) by a uniform, so a floor switch moves uniforms and swaps the geometry, never a material. Section look: topsoil, then two anthracite strata cut by a noise threshold, darkening with depth; a dark floor (`PIT_FLOOR`) fills the hole under what the level does not cover (`false` keeps the walls alone), drawn at `groundPitFloorY` in core: 5 cm under the top of the lowest floor plate (the sunken room of a split level, not its raised part), and 2 cm under the plate's underside where that would meet it, because the footing and the walls on it stop on that underside (`levelPlateUndersideWorldY`, which `genericFoundation` reads too) and two faces on one plane flicker. The pit is not a site ground surface (no `SITE_GROUND` role): it opens and closes with `groundHoleOpenNode`, so Off, a capture and the dive draw none of it.

**The underground look: edge and crossing variants** (`useViewer.undergroundLook`, `{ edge, transition }`, `setUndergroundLook`, never persisted; default `{ noise, fade }`: the fade is chosen, the edge stays until the owner picks between `section` and `section-earth`). `edge` is one of `UndergroundEdge`: `noise` (today's eroded rim), `quiet` (the same noise, fine and faint: rim almost straight from the default camera), `section` (an architect's section cut: a constant 0.6 m offset of the footprint, no noise, a crisp dark line on the cut, the pit's wall one flat tone with a thin dark line at grade; the offset's convex corners are rounded, a distance-field offset) and `section-earth` (the same outline exactly, the pit's walls the earth's: topsoil band, flat strata, `quiet`'s low crumble that is zero at the rim, so the top edge is the section's clean line). The numbers are `EDGE_LOOKS` (`nodes/src/site/underground-edge.ts`): margin, erosion, noise scale, feather, line, wall roughness, section flag. The shader reads them as uniforms (`setGroundHoleEdge`, `setGroundPitEdge`) and the CPU twin (`holeRadiusAt`, the picks' sure core, the walls' contour) reads the same table, so choosing a look compiles nothing and swaps no mesh or material; only the pit's walls are cut again (`GroundHole` re-runs on the edge). `transition` is `UndergroundTransition`: `noise` (the noise-mask crossing, `AMBIANCE_SECONDS` 0.7) or `fade` (the whole frame fades at once over `FADE_SECONDS` 0.4; `undergroundDissolve` mixes the amount with the mask by the `grainWeightNode` uniform, the hole's own opening stays 0.7 s). The sky going to black is in both.

**Below the ground** (`eyeUnderGround`, a free orbit under the lid; the ground height at the eye is `groundHeightAt`, the terrain field or the flat plane, with a 0.10 m band each side): the scene goes to its dark mode, a neutral anthracite / slate grey with no hue (`UNDERGROUND_PALETTE`, beside the scene theme tokens in `lib/scene-themes.ts`: neither dark scene theme is neutral, `night` is navy). One factor (`lib/underground-ambiance.ts`, eased over 0.7 s, instant with Animation Off, reduced motion or exporting; Solid turns it off) drives:

| Piece | Where | What |
|---|---|---|
| Backdrop | `post-processing.tsx` | the theme backdrop's own gradient in the palette's greys, after the colour grade; theme or atmosphere sky; the day's backdrop greys and dims over the first half of the crossing |
| Fog | `post-processing.tsx` | from the scene pass's depth: distance outside the shown level's box (the host's `groundWindowBox`, else the level or building worked out from the selection) dissolves into the backdrop's colour, per pixel; the no-post-FX fallback has the clear colour only |
| Vignette | `post-processing.tsx` | the corners close in, before the overlays are composited |
| Crossing | `post-processing.tsx` (`undergroundDissolve`) | a screen-space perlin mask: soft blobs of the dark world spread over the screen, 0 everywhere above and 1 everywhere below; weighs the three above |
| Sky light | `lib/underground-ambiance.ts` | ambient and hemisphere come down and tint toward the palette's neutral light grey for the frame about to be drawn and are given back before `Lights` lerps them; the sun and the IBL are untouched |
| Eye light | `lights.tsx` `UndergroundFill` | its intensity is the ambiance's: the veil's 1 (or 0) at rest, up to `EYE_FILL_INTENSITY` under the ground |
| Grade ring | `ground-veil.tsx` | `#1c1917` → the palette's light grey, a light rim |

Changing floors changes uniforms only, never a material or the light count (adding a light or swapping a material is a runtime shader compile, ~430 ms on the villa). The ground's hole mask is on the ground materials from the moment the scene has a level below grade (`hasLevelBelowGrade`, set by `GroundHole`; scenes without one keep the plain window mask), and the eye's fill, once mounted, stays: only its intensity moves. Tests: `ground-veil.test.tsx` and `lights.test.tsx` ("switching floors…").

Several levels below grade (round 5). The hole and the grade ring are cut over `belowGradeFootprints(nodes, shownLevelId)`: the shown level and the levels between it and grade (the ones the level display hides above it), unioned into one outline set, so a deeper level wider than the one over it, or under part of it, is one hole and a deeper level than the one shown stays under solid ground; the materials still follow "any level below grade" (`hasLevelBelowGrade`) and never change between floors. The fog keeps clear `levelStackGroundBox` (the shown level and the ones under it), not the host's single-level window box. The orbit overview keeps the eye over the ground when the pivot goes down to a deep level (`overviewEyeY`, `OVERVIEW_GROUND_CLEARANCE` 2 m: the eye stays where it was and looks down through the hole); only the person orbiting under the ground dives. The editor's "add a basement" (`addStoreyBelow`, core `buildLevelBelowChanges`) gives the new lowest level the offset that puts it one storey under the old lowest, which gives its own offset up: a new lowest level at offset 0 used to lift every floor above it by its height, which stood the basement above the terrain.

The walkthrough walks on its floors. `groundVeiled` / `anyGroundVeiled` are false while `walkthroughMode` (solid ground: no hole, no veil, no ground window, no ring; the part under the house, below, stays open), and the dark mode's factor stays 0 there (`ambianceTarget`: the rooms keep their normal light, no fog, no vignette); only what is seen outside turns to earth, with its own eased factor (`earthTarget`, `undergroundEarthNode`, the backdrop and the sky only) when the eye goes under the ground. The walker's collision ground is cut open over the same part (`cutGroundCollider`, `first-person/ground-holes.ts`, on the rings of `coveredBelowGradeFootprints`, flat slab or terrain alike, whatever the view does with the ground): a sheet across the stairwell would hold the walker at grade on the stair down, so inside the covered footprint he follows the building's floors and stairs, and outside it the ground holds him as before. Leaving the walkthrough returns to the overview rule. To change it: the walkthrough clause in `ambianceTarget` / `groundVeiled`, and the backdrop's `undergroundEarthNode` in `post-processing.tsx`.

**`showGround: false` and a basement** (`siteGroundShown` in `store/use-viewer.ts`, read by `site/renderer.tsx`): the flag says other geometry (an authored landscape, hosted on a level above the ground) supplies the ground, so the site draws none. While a level below grade is shown, the level display hides the storeys above it (`belowGrade`) and the landscape with them: the site's ground stands in then, with its hole, veil and pit, drawn exactly as with `showGround` on, so the basement is seen through an opening and not through nothing. With a level at or above grade shown, or no level below grade in the scene, `showGround` is the author's, and the two grounds never draw together. The rule reads the display's own fact, not the landscape's name or kind; a landscape the display does not hide (hosted on the building or the site) would stand over the stand-in while a basement is shown.

**The ground over the house itself** (`coveredBelowGradeFootprints` in core, read by `site/renderer.tsx` as `holes`): the part of a basement under the footprint of the levels above it is always open in the site's ground, whatever level is shown, the walkthrough included. It is cut as geometry, the way a recessed slab is (the ground fill, the horizon disc and the sculpted terrain all take it, so a pick passes through it with no CPU twin), and it is independent of the hole above: no easing, no noise edge, no pit, no fog, no ring. From outside nothing changes (the storeys stand over it); a stairwell, a floor opening or a walkthrough on the stair meets the basement, not a sheet of ground across it. A level's cover is the floor slabs of the visible levels over it in the same building (`level` index above its own) that are not fully buried: the ones at grade, and the part of a floor only partly below grade that stands out of the hill; a slab's own openings do not count. A basement reaching out under the garden is covered only up to the house, the rest stays closed until its level is shown (no pit in the garden), and a walk-out opens only the part the ground stands over. A courtyard the house wraps round, a hidden level, and a level of another building cover nothing. The one case it closes: a level below grade shown with the ground on Solid (`belowGrade` and `groundMode`), where the storeys are away, nothing covers it, and Solid asks for solid ground; Solid with the house shown leaves it open. Under `showGround: false` there is no site ground to cut at grade; the stand-in carries the cut like the rest.

**The ground window never opens over the hole** (`GroundWindowSystem`): a level shown fully below grade is seen through the hole in solid ground (`groundVeiled`), so no window opens over it. The window is for ground that stands in the eye's way without a hole: a level at grade, or only partly below it (a walk-out). It asks for a terrain field (`terrainBetweenEyeAndBox`), which a sculpted site has: open over a level fully below grade it cut the solid ground in the box's silhouette and stood the 10% veil in its place, so the basement's outer walls were seen through a translucent ground in front of the opening instead of only the opening. A capture still asks the window (`temporarilyGroundWindowForCapture`): it sets the solid ground aside already, so the cut lands on nothing. The box (`levelGroundBox`) runs from the level's lowest floor to the highest floor's ceiling, so the sight lines, the window and the fog's clear region reach the sunken room of a split level; a level with one floor is boxed as before.

**Site flatwork is not a floor of the house** (`isSiteFlatwork`, core): a slab the site's works laid on a level (a lawn, a driveway, a path, `metadata.flatwork`) is outdoors. `levelGradeStanding`'s samples, the buried and cover plates of `belowGradeFootprints` / `coveredBelowGradeFootprints` and the level's ground box (`levelGroundBox`) leave it out, and so do the storey walkers that say where a level's floors are, how high and how deep (`levelFloorWorldY`, `levelLowestFloorWorldY`, `levelPlateUndersideWorldY`) and the dive's `deepestDrawnY`, so a driveway laid lower than the house's slab does not take the pit, the footing or the dive depth down with it: a lot-wide lawn on the ground level does not make that level partly below grade under a hill (and open the hole over the hillside), does not cover a basement reaching under the garden, and does not stretch the level's box over the whole lot.

**A wall with no cladding over a bare masonry or concrete core shows that structure outside** (`wallAssemblyExposedStructure`, core: `'cmu'` or `'concrete'`; the viewer's `wall-materials.ts` dresses the exterior face with it when the cladding's own `wallAssemblyFinishRef` is null): the foundation walls above grade, and from under the ground, were the white slot default because their assembly (`FOUNDATION_CONSTRUCTIONS`) has no `finish` layer, and read unlike the generic foundation under them. The face now takes the generic foundation's own materials (`viewer/src/lib/foundation-materials.ts`, shared with `nodes/src/site/generic-foundation.tsx`): courses of block with joints and the block colours for `cmu` (courses from the world's Y, so they bond with the foundation's; the bond along the face's world-planar U), the same grained concrete for `concrete`; solid shading keeps a flat colour (`STRUCTURE_COLORS`). Only the exterior face, and only when its side is resolved; paint on the face wins; a layer of cladding or lining outside the core (a partition, stucco on block), a framed core and `icf` are untouched, and no preset of `WALL_ASSEMBLY_PRESETS` changes its look. Thumbnails and captures take the viewer's wall materials, so they follow.

Looking under any house (round 7). With the ground on Auto the orbit's eye may leave the ground for the earth under any building, whatever level is selected: the floor limit is `orbitFloorMinY(levelFloorY, diveFloor)`, the dive floor `diveFloorY` = 3 m under the lowest ground (`lowestGroundY`) or 1 m under the deepest drawn thing (`deepestDrawnY`: the footing under the lowest floor), whichever is deeper, and the floor-surface lookup is off while the dive is on (the level's slab and the ground would hold the eye over them). Solid keeps the old limit; `allowUndergroundCamera` stays the dev's free camera; the overview rule (`overviewEyeY`) and the walkthrough are unchanged.

The generic foundation (`genericFoundation` in core, `site/generic-foundation.tsx`): under the exterior walls of each building's lowest level, derived and never stored, a 16 × 8 in footing whose bottom is 12 in under the lowest grade (a generic depth: core has no frost data) and an 8 in foundation wall from the footing up to the underside of the lowest floor, drawn as a footing in concrete and a wall in running-bond block (a TSL pattern on the wall's own length and world height). A level wholly below grade has no second wall (its exterior walls are the foundation walls): only the footing, under its floor. A wall that stores a stem (`underpinning`) keeps it and gets only the footing under the stem; a slab with a solid `foundation` skirt is the foundation under its level. A node that declares the `drawsFoundation` capability on that level (Bones' X-ray, while its foundation is shown) replaces the generic one, so nothing is drawn twice. The standard numbers are `FOUNDATION_STANDARD` in core, read by Bones and the sections plugin as well; what depends on the jurisdiction (frost depth, wall convention) stays in Bones. The two meshes and two materials exist from the moment a building has the walls, and are not touched by a floor switch or by the eye crossing the ground (the ground hides the part under it from above); the walkthrough hides them (a flag), exports strip them (`pascalExport`), and a capture through the veil leaves them out (`SITE_FOUNDATION`, `temporarilyVeilGround`). The wall is block only where the building's foundation construction is block (the default and the US): each stem run carries a `material` (`cmu`, `concrete`), the viewer draws one stem mesh per material in use, and the stem is as wide as the construction says (8 in, 25 cm); see "The construction follows the region" in `vertical-model.md`.

A plugin that pours the real foundation takes the level over under the ground. `drawsFoundation(node)` (a node capability) steps the generic foundation aside under a level for good while the node draws its own; and `useViewer.pluginFoundationLevelIds` does it for the levels a plugin draws only while the eye is under the ground (Bones: a building with no X-ray, or an X-ray set to Off), so `GenericFoundation` filters those levels' members out of its two geometries (the meshes and materials stay; nothing compiles). The plugin writes the ids while its meshes hold members and clears them when the eye surfaces. Bones' own meshes (`framing/underground.tsx` in `plugin-bones`, mounted by the host beside the framing reveal) are made once per level, hold one instance of no size above the ground and are refilled under it: a pipeline lives as long as the instanced mesh that draws with it (the node's cache key carries the mesh's uuid), so rebuilding the meshes on each dive would compile again.

The shown level's own materials are never touched. A capture (the agent's pictures, the hero shot) renders from its own camera with `gl.render`, so the composite pieces are not in it; `temporarilyWithoutAmbiance()` (held by the thumbnail generator's set-up and the hero bake) also closes the hole, lets the sky light and the fill go back to what they were, and restores them after.

## Adding a theme

Append a `SceneTheme` to `SCENE_THEMES` with all required fields. `clayTints` is a `Partial` — any role you omit falls back to the active `colorPreset`. The theme pickers (toolbar + community overlay) render a 2×2 swatch from `clayTints` over `background`, so populate at least `wall`/`roof`/`floor`/`glazing` for a good swatch.

## Texture world scale (UVs in metres)

Every procedural surface generates UVs in metres: 1 UV unit = 1 m.

This contract is shared by wall `systems/wall/wall-system.tsx` (`ExtrudeGeometry`), slab `systems/slab/slab-system.tsx` (`generatePositiveSlabGeometry`, and `generatePoolGeometry`), ceiling `systems/ceiling/ceiling-system.tsx`, roof `systems/roof/roof-system.tsx`, and chimney/dormer `nodes/src/chimney/geometry.ts`.

GLB item slots follow the same ~1 UV unit/m authoring convention, enforced by the slot validator's UV-presence check and the Blender recipe in [item-authoring](item-authoring.md). This is an authoring requirement, not a render-time correction.

A catalog material's `repeat` (`mapProperties.repeatX/repeatY` in `packages/core/src/material-library.ts`) is therefore a per-material world-scale setting: tiles per metre.

`repeat: 1` means 1 tile/m, `0.4` means one tile every 2.5 m, and `1.5` means 1.5 tiles/m.

Repeat is a property of the material, identical for every surface that uses it, never per-item or per-surface. Custom repeat values are intentional material scale, not per-surface hacks.
