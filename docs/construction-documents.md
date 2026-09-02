# Construction documents, native to Pascal

Decision (2026-09-02): construction drawings are drawn by Pascal's own
renderer from Pascal's own nodes. No remote engine, no imported SVG.
Every mark on a sheet is a scene node or a live projection of one. Editing
on a sheet edits the scene. The PlanCrafters engines and `plugin-plans` are
parked; nothing new depends on them.

## What exists and is reused (do not reinvent)

- 2D floor plan: pure React SVG. `packages/editor/src/components/editor-2d/renderers/floorplan-geometry-renderer.tsx`
  (world → SVG, `renderMode 'screen' | 'pdf'`), `floorplan-registry-layer.tsx` (per-kind dispatch via
  `def.floorplan`), `floorplan-dimension-renderer.tsx`. Geometry primitive union:
  `packages/core/src/registry/types.ts:364+` (`path | polygon | polyline | rect | circle | line | text` +
  `dimension*`). Kinds draw themselves with `def.floorplan` (see `packages/nodes/src/wall/floorplan.ts`).
- Dimensions: `packages/core/src/schema/nodes/construction-dimension.ts` (modes, chain, drawingType
  overrides, textOverride). Visibility matrix: `packages/editor/src/lib/floorplan/annotation-visibility.ts`.
  Drawing types: `ConstructionDrawingType` (floor-plan, foundation-plan, reflected-ceiling-plan, roof-plan,
  site-plan) and `packages/editor/src/store/use-drawing-view.ts` (currently pinned to floor-plan).
- PDF: `packages/editor/src/lib/floorplan/floorplan-export.tsx` renders the same SVG offscreen and writes
  vector PDF via `floorplan-pdfkit-renderer.ts` / `floorplan-pdfkit-document.ts`; has page layout, title
  band, paginated schedules.
- Wall geometry: `packages/core/src/systems/wall/wall-mitering.ts` (`calculateLevelMiters`),
  `wall-footprint.ts`, `wall-topology.ts`. Walls have one `thickness`; face bands/slots are PAINT, not assembly.
- Bones (`node_modules/@pascal-app/plugin-bones`, read-only): `src/engines/wall-layers.ts` has the
  IRC-cited assembly stack data (`data/wall-assemblies.json`); framing/plumbing/hvac/electrical engines
  are pure functions of the scene.
- Plugin node kinds: `Plugin { id, apiVersion:1, nodes: NodeDefinition[] }` registered in
  `apps/editor/lib/bootstrap.ts` via `extendPluginDiscovery`; kinds carry `schema` (zod), `category`,
  `floorplan`, `extensions['pascal:editor/floorplan']` (see plugin-bones `src/service/definition.ts`).
  New kinds go in their own package under `packages/` — never edit the core node union for them.
- Thumbnail/snapshot: `packages/editor/src/components/editor/thumbnail-generator.tsx`
  (`camera-controls:generate-thumbnail`, captureMode standard|viewport|area).

## Workstreams and file ownership (one owner per file; others do not touch)

| WS | Owner | Owns |
|----|-------|------|
| 1 Site plan + address | `site` agent | `apps/editor/lib/parcel/**`, `apps/editor/app/api/parcel/**`, `packages/core/src/schema/nodes/site.ts`, `packages/nodes/src/site/**`, `packages/editor/src/store/use-drawing-view.ts`, site-plan drawing code under `packages/editor/src/lib/floorplan/site-plan/**` |
| 2 Sheets mode | `sheets` agent | `packages/plugin-sheets/**` (sheet, viewport, project-record kinds + workspace UI), `packages/editor/src/store/use-editor.tsx` (add `'sheets'` to `WorkspaceMode` only), `packages/editor/src/lib/floorplan/sheet-export.ts` (new), cover-view pose |
| 3 Annotations | later | dimension label click-to-type, door/window marks + tag symbols, schedule data |
| 4 Site utilities | later | `packages/plugin-utilities/**` (utility-line, utility-pole, service-point) |
| 5 Wall assemblies | `walls` agent | `packages/core/src/schema/nodes/wall.ts` (add `assembly`), `packages/core/src/systems/wall/wall-assembly.ts` (new), `packages/nodes/src/wall/**` (floorplan layer lines, panel) |
| 6 Vector sections/elevations | `sections` agent | `packages/plugin-sections/**` (section-marker, elevation-marker kinds; `buildSectionDrawing`, `buildElevationDrawing`) |

Shared files everyone may append ONE line to (re-read immediately before editing, append only):
`apps/editor/lib/bootstrap.ts`, `apps/editor/next.config.ts` (transpilePackages), `apps/editor/app/globals.css`
(`@source`), `apps/editor/package.json` (dependency line). Run `bun install` after adding a workspace package.

## Contracts between workstreams

- **Drawing output** — every drawing (plan, site plan, section, elevation) is a list of the core geometry
  primitives (`packages/core/src/registry/types.ts:364+`) in world metres with a `bounds`. Sheets render
  those through the existing SVG renderer at a scale. Signature all producers implement:
  `build<X>Drawing(scene: SceneSnapshot, args) => { primitives: FloorplanGeometry[]; bounds: {minX,minY,maxX,maxY}; annotations?: ... }`.
- **Sheet viewport kinds** (WS2 consumes): `plan` (drawingType + levelId), `site-plan`, `section`
  (markerId), `elevation` (markerId | direction), `view3d` (pose: 'cover-front' | custom), `schedule`
  (doors | windows | rooms), `notes`, `image`.
- **Site node fields** (WS1 owns; WS2/WS6 read): `address {street, city, state, zip}`, `parcel {apn,
  source:'gis-parcel', county, state, lotAreaSqFt, originLngLat:[lng,lat], resolvedAt, layer}`,
  `setbacks {front, side, rear, left?, right?}` metres, `setbacksSource`, `zone`, `frontEdge`,
  `northRotation` radians. Lot ring = `site.polygon.points` metres, origin = the geocoded point,
  x east, y(z) south.
- **Wall assembly** (WS5 owns; WS6 reads): `wall.assembly = { preset, exterior: {finish, thickness},
  sheathing: {material, thickness}, framing: {depth}, interior: {finish, thickness} }` metres;
  `resolveWallAssembly(wall) → layers[] outward-ordered with thickness`; `wall.thickness` stays the
  TOTAL and is derived when `assembly` is present.
- **Project record** (WS2 owns): a `project-record` kind (one per scene): identity (name, number,
  address mirror, APN), designer (name, license, firm, phone, email), owner, engineer, jurisdiction,
  documentStatus, revisions[], date, drawnBy. Migrates from `site.metadata.plancrafters.project` if found.
- **Marks** (WS3, later): deterministic door/window marks per level (101, 102 …) with `mark` override.

## Rules

- Local commits only in this clone; never push. Never touch `pascalorg` remotes.
- Report defects honestly; nothing papered over. No invented code values: cite bones data or mark unverified.
- `bun test` in the packages you touch must stay green; `bunx tsc --noEmit -p <package>` clean.
- Theme tokens only (bg-background, text-foreground, border-border, bg-card, text-muted-foreground, bg-primary …).
