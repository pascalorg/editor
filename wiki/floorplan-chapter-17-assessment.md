# Floor Plan Chapter 17 Assessment

## Purpose

This document compares the guidance in `Chapter_17_Floor_Plan_Dimensions_and_Notes.pdf` with Pascal's current floor-plan implementation. It records what the chapter teaches, what the editor supports, and the product's intentional scope boundaries.

The review covered the full 19-page chapter and the floor-plan stack across:

- Core floor-plan, wall, opening, and measurement schemas.
- The registry-owned `FloorplanGeometry` contract.
- Editor 2D rendering and interaction layers.
- Node-specific floor-plan builders.
- Automatic wall and opening dimension planning.
- Persistent measurements and smart measurement.
- Door/window documentation and schedules.
- Per-level PDF export.

## What the chapter is teaching

The chapter is primarily about construction communication, not merely measuring geometry. Its main principles are:

1. A drawing must locate and size every construction-critical feature without requiring field workers to guess, scale the drawing, or perform unnecessary arithmetic.
2. Dimensions must be organized into consistent strings that remain readable and uncrowded.
3. The selected datum must match the construction method: centerline, face of stud, face of finish, masonry opening, rough opening, or another explicit reference.
4. Dimension graphics must follow a consistent standard: thin lines, extension-line gaps, extension-line overshoot, uniform terminators, readable aligned text, and predictable spacing.
5. Exterior strings normally progress from detailed opening/partition information to the overall building dimension.
6. Local or specific notes identify individual features through leaders. General notes apply to the whole drawing and are normally numbered in a dedicated sheet area.
7. Door/window schedules and feature notes may replace repeated dimensions when they communicate the information more clearly.
8. Drawing scale, paper-space text size, line weight, and sheet composition are part of the construction-document contract.
9. Curved, circular, masonry, concrete, and foundation-related construction require different dimension semantics from ordinary wood-frame walls.

## Current implementation

### Automatic construction dimensions

`packages/nodes/src/wall/construction-dimensions.ts` already produces coordinated level-wide construction dimensions. The exterior hierarchy includes:

1. Opening widths.
2. Door and window center locations.
3. Intersecting partition references.
4. Structural columns.
5. Facade jogs, projections, and recesses.
6. Overall facade dimensions.
7. A structural overall dimension when an exterior column row extends beyond the wall envelope.

The planner also supports:

- Collinear wall runs that form one facade.
- Disconnected facade runs.
- Angled exterior walls.
- Exterior-side classification.
- Wall-thickness-aware partition references.
- Interior partition strings, including geometrically enclosed partitions whose side metadata remains stale after wall splitting.
- Subdivision chains on every exterior orientation when internal walls divide a facade into multiple runs.
- Hosted door and window widths.
- Interior clear spans bounded by adjacent wall faces.
- Suppression of very short accidental segments.
- Associative updates when the contributing model geometry changes.

`packages/nodes/src/wall/floorplan.ts` integrates these dimensions into the registry-driven wall floor-plan builder.

### Dimension graphics

`packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx` implements several conventions from the chapter:

- Aligned dimension lines.
- A gap between the feature and extension line.
- Extension lines that pass beyond the dimension line.
- Consistent 45-degree architectural slash terminators.
- Thin dimension and extension lines.
- Text above the dimension line.
- Text that remains readable when the plan is rotated.
- Explicit aligned baselines for stepped facade dimensions.
- Separate edit and document presentation profiles.
- True modeled wall thickness in document output while retaining interactive legibility in edit mode.
- Paper-space dimension text, tick, extension-gap, overshoot, and label-offset sizing in PDF output.
- Whole-millimetre document notation without an `mm` suffix, while retaining metre notation in the interactive editor.
- Short-segment values outside the dimension ticks when the value cannot fit inside.

### Automatic annotation layout

`packages/editor/src/components/editor-2d/renderers/floorplan-annotation-layout.ts` now resolves automatic dimension-value collisions in both the live floor plan and PDF composition. It supports:

- Label-to-label separation, including dense clusters.
- Stable same-string drawing order and priority for farther-out architectural strings.
- Movement along the dimension string before crossing into an adjacent tier.
- Fixed door/window mark pills as obstacles.
- Semantic architectural obstacles for walls, wall corners, door symbols and swing envelopes, windows, and columns.
- Sampled diagonal wall outlines, avoiding the oversized screen-aligned bounds produced by rotated walls.
- Outside-end placement for short values, followed by outside-start when the end side is blocked.
- Matching baseline extensions when a short value changes sides.
- A leader and true tick-to-tick baseline when both outside positions require further relocation.

The former orange/red dashed collision overlay was removed because it displayed stale pre-layout conflicts on top of labels that the automatic resolver had already made readable.

`packages/nodes/src/shared/construction-length.ts` formats imperial construction dimensions using feet, inches, and reduced fractions rounded to the nearest sixteenth.

### Persistent measurements

The existing measurement system is broader than the chapter's drafting examples. It supports:

- Distance.
- Angle.
- Area.
- Perimeter.
- Prism volume.
- Free and associative semantic anchors.
- Wall, roof, slab, ceiling, zone, and site features.
- Live updates when referenced geometry changes.
- Dangling-reference presentation and explicit detach behavior.
- 2D and 3D drafting and editing.
- Smart transient measurement reports.

The architecture is documented in `wiki/architecture/measurements.md`. These measurements remain analysis annotations rather than architectural construction-dimension strings.

### Manual construction dimensions

The editor provides a dedicated associative `ConstructionDimensionNode` for architectural drafting in Expert mode. A drafter can:

- Pick stable semantic references or free points.
- Create point-to-point, continuous, radius, diameter, center-mark, chord, arc-length, angular, and coordinate dimensions.
- Place and later move the dimension baseline.
- Reposition individual witness references.
- Suppress or restore individual segments.
- Keep dimensions associated with their host geometry as walls, openings, and other supported elements change.

Manual construction dimensions render in the live floor plan and PDF output, and their visibility is controlled independently from automatic dimensions and analysis measurements.

### Door and window documentation

`packages/nodes/src/shared/opening-documentation.ts` provides:

- Deterministic automatic door and window marks.
- Explicit mark overrides.
- Duplicate explicit-mark warnings.
- Mark bubbles and leaders.
- Door schedules.
- Window schedules.
- Nominal dimensions.
- Optional verified rough-opening dimensions.
- Window sill and head heights.
- Door operation, frame, and hardware fields.

The rough-opening fields intentionally remain optional rather than being invented from the nominal modeled opening size.

### Rooms, stairs, and other plan graphics

- Architectural room zones provide room names and numbers, finish and occupancy metadata, ceiling heights, clear dimensions, and room schedules. Generic colored zones remain available for non-room uses.
- Stairs render footprints, treads, and direction arrows, but do not yet emit a complete construction stair note.
- Columns can contribute structural center references to automatic exterior strings.
- The generic floor-plan registry already renders walls, doors, windows, slabs, ceilings, zones, roofs, stairs, columns, furniture, MEP nodes, and annotation nodes through a common geometry contract.

### PDF export

`packages/editor/src/lib/floorplan/floorplan-export.tsx` currently provides:

- Per-level PDF plan pages.
- North-up orientation that accounts for building rotation.
- Full and structure-only export scopes.
- Door and window schedule pages.
- Registry-driven geometry matching the live floor-plan builders.
- Conversion of non-scaling SVG strokes for PDF output.
- Preservation of persistent measurement value labels in full export.
- Respect for the existing measurement-visibility preference.
- Document-purpose wall rendering at modeled thickness.
- Document metric notation and paper-space sizing for dimensions, measurement labels, room labels, annotation text, mark bubbles, and annotation linework.
- The same automatic annotation collision layout used by the live floor plan.

The export intentionally fits the plan to an A4 landscape page.

## Intentional scope boundaries

### Walls use one modeled thickness

`WallNode` stores one total thickness and finish materials. It does not model separate studs, sheathing, finish layers, veneer, air space, concrete block, or furring. Face-based dimensions therefore reference the modeled wall face rather than a separately proven construction layer.

### Export uses the supported fitted-page presentation

PDF export fits each supported plan to an A4 landscape page. Construction dimensions, measurements, annotation text, room labels, mark bubbles, and annotation linework use the existing document presentation profiles.

### Automatic annotation placement uses its current obstacle set

Automatic placement handles adjacent labels, short values, opening marks, walls, wall corners, door symbols and swings, windows, columns, and room labels. Drafters can pin a label position, reset it with a double-click, and suppress individual manual-dimension segments.

## Features that should not be copied blindly

The chapter was published in 2012. Its example sizes and clearances are useful drafting and design references, but they should not be treated as current building-code requirements.

Any implementation of hallway, fixture, door, stair, appliance, or room-clearance checks should:

- Be configurable by jurisdiction and standard profile.
- Be presented as an advisory or verification result unless code provenance is known.
- Avoid embedding manufacturer-dependent rough openings or product sizes as universal facts.
- Avoid silently omitting dimensions merely because a feature is commonly considered standard.

The product should prefer explicit model data, verified manufacturer data, and user-controlled documentation policies.
