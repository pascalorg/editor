# Floor Plan Chapter 17 Assessment

## Purpose

This document compares the guidance in `Chapter_17_Floor_Plan_Dimensions_and_Notes.pdf` with Pascal's current floor-plan implementation. It records what the chapter teaches, what the editor already supports, and the remaining construction-document gaps.

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

The former orange/red dashed collision overlay was removed because it displayed stale pre-layout conflicts on top of labels that the automatic resolver had already made readable. Any future unresolved-collision reporting should live in a separate preflight surface rather than being painted over the drawing.

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

The architecture is documented in `wiki/architecture/measurements.md`. These measurements are analysis annotations; they are not yet a complete replacement for architectural construction-dimension strings.

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

- Zones render a centered name but currently represent generic colored polygons rather than a complete architectural room model.
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
- Document metric notation and initial paper-space sizing for construction dimensions and measurement labels.
- The same automatic annotation collision layout used by the live floor plan.

The plan is fitted to an A4 landscape page. It is not yet plotted at a fixed architectural scale.

## Important current limitations

### Interactive measurement and construction dimension are different concepts

The measurement system stores geometric analysis annotations. The wall planner creates automatic construction strings. There is no dedicated manual construction-dimension object that lets a drafter pick references, place a baseline, add points to a continuous string, and later reposition or suppress individual segments.

### The current datum is not truly face of stud

`WallNode` stores total thickness and finish materials but does not describe studs, sheathing, finish layers, veneer, air space, concrete block, or furring. Automatic dimensions can reference a generic wall face, but the model cannot yet prove that this face is a structural stud face or finish face.

### Paper-space control is only partially implemented

Exported construction dimensions and measurement labels now resolve their main text, tick, extension-gap, overshoot, and label-offset sizes from paper points. Note text, mark bubbles, room labels, remaining line-weight categories, and fixed user-selectable drawing scales still require the drawing-sheet work.

### Construction dimensions have no independent visibility layer

The live floor plan exposes independent visibility controls for automatic dimensions, manual dimensions, measurements, opening marks, structural grids, room labels, and stair annotations. Full export intentionally includes every supported annotation category regardless of the live-view toggles.

### Automatic collision layout has no persistent manual override

Automatic placement now handles adjacent labels, short values, opening marks, and the first set of architectural obstacles. It does not yet let a drafter pin a chosen label position, suppress a segment, or persist a view-specific layout override. Broader fixed-symbol coverage and a separate unresolved-collision preflight also remain.

### Curved and circular construction dimensions

Curved walls emit an automatic radius leader and center mark in live plans and document output, matching the chapter's curved-wall callout method. Manual associative construction dimensions cover radius, diameter, center, chord, arc-length, coordinate-pattern, and angular-pattern workflows, with curved-wall defining geometry resolved from stable semantic host features.

### Construction systems are not semantically modeled

The editor cannot yet apply different documentation rules for wood framing, masonry veneer, concrete block, structural masonry, or solid concrete because those assembly semantics do not exist in the wall model.

### The floor plan has no drawing-sheet model

The export layer produces plan and schedule pages, but there is no persistent drawing sheet with view identity, scale, title block, drawing number, note blocks, graphic scale, north arrow, or per-view annotation visibility.

## Features that should not be copied blindly

The chapter was published in 2012. Its example sizes and clearances are useful drafting and design references, but they should not be treated as current building-code requirements.

Any implementation of hallway, fixture, door, stair, appliance, or room-clearance checks should:

- Be configurable by jurisdiction and standard profile.
- Be presented as an advisory or verification result unless code provenance is known.
- Avoid embedding manufacturer-dependent rough openings or product sizes as universal facts.
- Avoid silently omitting dimensions merely because a feature is commonly considered standard.

The product should prefer explicit model data, verified manufacturer data, and user-controlled documentation policies.
