# Floor Plan Construction Documentation Plan

## Goal

Turn the current interactive, registry-driven floor plan into a configurable construction-document system while preserving the existing 2D/3D editing architecture.

The plan is based on the assessment in `wiki/floorplan-chapter-17-assessment.md`.

## Current remaining work

Last consolidated from this branch on 2026-07-21. Completed items remain documented in the phase
sections below; this checklist is the short, canonical view of what is still missing from the PDF
assessment.

### Construction dimensions and visibility

- [x] Add witness-point dragging, reassociation, and explicit detachment for manual construction
  dimensions.
- [x] Complete point-to-point multi-segment strings and converge manual and automatic dimensions on
  one shared dimension-string presentation primitive.
- [ ] Add project/drawing dimension standards for datum policy, terminators, text position,
  imperial precision, metric notation, tier spacing, extension lines, and reference style.
- [ ] Add independent visibility controls for hidden/overhead geometry and reference dimensions.
- [ ] Support segment suppression and other view-specific dimension overrides without changing the
  physical model.

### Drawing sheets and plotted output

- [ ] Add a persistent Core drawing-sheet model with sheet identity, paper size, orientation,
  placed views, drawing numbers, fixed scales, annotation profiles, notes, schedules, and title-block
  metadata.
- [ ] Plot views at fixed user-selectable architectural scales instead of fitting every plan to A4.
- [ ] Finish paper-space sizing and line-weight profiles for notes, leaders, marks, room labels, and
  the remaining annotation categories.
- [ ] Compose north arrows, graphic scales, view titles, scale notation, drawing/sheet references,
  schedules, and notes on the sheet.
- [ ] Support multiple paper sizes and preflight clipped view or annotation content.

### Annotation layout and preflight

- [ ] Let users pin label positions and persist layout overrides on the drawing view.
- [ ] Extend collision avoidance to the remaining fixed symbols and annotation categories.
- [ ] Add a separate preflight surface for unresolved collisions, short unreadable segments, and
  plan-geometry conflicts; do not paint diagnostic warnings over the drawing or export them to PDF.

### Notes, callouts, and revisions

- [ ] Add sheet-level numbered general notes and reusable project note sets with duplicate-note
  warnings.
- [ ] Add stable keyed-note definitions, symbols, legends, and repeated instances.
- [ ] Add wall/glazing/assembly tags, section and elevation callouts, detail references, delta
  markers, revision clouds, and revision IDs.
- [ ] Expand reusable leader terminators to include filled arrows and slashes.

### Wall assemblies and construction datums

- [ ] Model wall layers and their roles, thicknesses, materials, and eligibility as dimension
  datums.
- [ ] Resolve stable centerline, structural-face, finish-face, veneer-face, and other
  assembly-aware references.
- [ ] Add assembly-aware poche, hatches, cut weights, finish graphics, masonry/air-space graphics,
  concrete-block and structural-masonry graphics, and concrete/furring graphics.
- [ ] Add explicit rough-opening (`RO`), masonry-opening (`MO`), framed centerline, masonry
  edge-to-edge, and optional finish-opening documentation policies.

### Room documentation gaps

- [ ] Add finish-face and room-to-room clear dimensions once wall-assembly and inter-room datum
  evidence exists.
- [ ] Extend reliable automatic clear dimensions beyond proven straight rectangular enclosures
  without presenting guessed dimensions for open, irregular, or incomplete rooms.

### Advisory and completeness analysis

- [ ] Add optional imperial and metric construction-module advisories.
- [ ] Add jurisdiction/profile-based clearance advisories for circulation, doors, fixtures,
  cabinets, appliances, closets, and stairs, with explicit code provenance.
- [ ] Audit missing overall, opening, partition, and verified rough-opening dimensions.
- [ ] Detect duplicate or contradictory strings, segment-total mismatches, and construction-critical
  nodes that have no dimension, schedule entry, or keyed note.
- [ ] Include unresolved annotation collisions and clipped sheet content in the completeness audit.

## Design principles

1. Construction dimensions and generic measurements remain separate concepts.
2. All stored geometry remains in level-local SI metres.
3. Unit notation, line weights, text sizes, and spacing are presentation concerns resolved at render/export time.
4. Automatic annotations remain derived and associative; they do not rewrite scene nodes during rendering.
5. Manual construction annotations use stable semantic references and explicit fallbacks.
6. Sheet-level information is not forced into arbitrary level-local positions.
7. Editing graphics and construction-document graphics may share builders but must have distinct render purposes.
8. New floor-plan behaviors must respect the registry-driven composition and per-node subscription model.

## Phase 1: harden current documentation output

### 1.1 Fix unit consistency

Status: formatter and opening-placement work implemented. Temporary opening clearances and equal-spacing badges now use the live metric/imperial preference, and the shared formatter exposes a document profile for whole millimetres without a suffix. Selecting that profile from document rendering remains part of Phase 1.4.

- Route opening-placement labels through the shared construction-length formatter.
- Respect the live unit preference in all temporary dimension graphics.
- Add a construction-document metric profile that displays millimetres and can omit the `mm` suffix on dimension lines.
- Keep the current metre-based format available for the interactive editor.
- Add tests for metric and imperial placement dimensions.

### 1.2 Preserve measurement labels in full PDF export

Status: implemented without new sidebar UI. Full export honors the existing measurement visibility preference, preserves export-safe `dimension-label` rendering, and removes measurement nodes entirely when measurements are hidden.

- Decide whether a full export should honor the current `showMeasurements` preference or expose a separate export option.
- Render `dimension-label` primitives in export-safe form.
- Verify distance, angle, area, perimeter, and volume labels in generated PDFs.
- Prevent a measurement line from being exported without its value.

### 1.3 Add construction-annotation visibility controls

Status: initial editor controls are implemented for automatic dimensions, manual construction
dimensions, generic measurements, door/window marks, construction notes, structural grids, column
centers, and architectural room labels. The persisted settings apply to both the live 2D plan and
PDF export. Categories that do not yet have an implementation remain deferred.

Introduce per-view controls for:

- Automatic construction dimensions.
- Manual construction dimensions.
- Generic measurements.
- Door/window marks.
- Local notes.
- Room labels.
- Structural grids and column centers. Initial persistent two-point grid axes use automatic
  numeric/alphabetic identifiers, endpoint bubbles, and derived column-center marks. Columns now
  snap to nearby axes/intersections during placement and 2D/3D movement, display associative grid
  references such as `B-2`, and structural-grid drafting preserves right-drag plan rotation.
- Hidden or overhead geometry.
- Reference dimensions.

Do not overload the existing `showMeasurements` preference with every documentation category.

### 1.4 Separate edit and document rendering

Status: the render-purpose seam and true-thickness wall output are implemented. Interactive plans retain legibility exaggeration; document output uses modeled wall thickness, document metric notation, and neutral interaction state. Scale-derived paper-space styling remains part of Phase 3.2.

Extend the floor-plan render context with an explicit purpose such as:

```ts
type FloorplanRenderPurpose = 'edit' | 'document'
```

In document mode:

- Render walls at their true modeled thickness.
- Use construction line weights rather than selection-oriented styling.
- Remove hover, selection, and manipulation chrome.
- Resolve annotation sizes from the drawing scale and paper-space profile.

### 1.5 Add initial collision diagnostics

Status: deferred to a future preflight surface. The former orange/red dashed overlay used pre-layout geometry and obscured otherwise readable labels, so both the live overlay and its orphaned analyzer were removed from the normal floor-plan implementation. Collision warnings must not be reintroduced as graphics painted over the drawing and are not added to PDF output.

- Detect overlapping dimension labels.
- Detect labels that collide with plan geometry.
- Detect very short dimension segments whose text cannot fit.
- Report the conflicts before implementing automatic relocation.

## Phase 2: manual associative construction dimensions

Status: linear point-to-point and continuous authoring are implemented. A dedicated Core node stores
two or more free or semantic measurement anchors and an independent baseline. The point-to-point
workflow retains its three clicks; continuous mode collects any number of witnesses and uses Enter or
double-click to advance to baseline placement. Both create one undoable node, support step-back and
Alt magnetic bypass, follow referenced geometry, report dangling references, and expose selected
baseline and witness drag handles. Witness dragging can reassociate to nearby semantic wall features
or detach to an explicit free point with Alt. Point-to-point strings now support multiple independent
witness pairs, and manual linear/chord dimensions plus automatic straight-wall dimensions share the
native dimension-string presentation primitive. Additional dimension modes remain.

### 2.1 Add a construction-dimension schema

Create a dedicated Core node rather than adding construction-document behavior to `MeasurementNode`.

Suggested payload:

```ts
type ConstructionDimensionNode = {
  type: 'construction-dimension'
  mode: 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter'
  anchors: ConstructionDimensionAnchor[]
  baseline: {
    origin: [number, number]
    direction?: [number, number]
  }
  chainMode: 'continuous' | 'point-to-point'
  datumPolicy?: DimensionDatumPolicy
  terminator?: DimensionTerminator
  reference?: boolean
  prefix?: string
  suffix?: string
  textOverride?: string
}
```

Construction anchors should reuse the stable semantic reference pattern already proven by measurements: node ID, feature ID, parameters, and fallback point.

### 2.2 Implement the CADD authoring workflow

The 2D tool should:

1. Pick the first semantic feature.
2. Pick the next feature or features.
3. Place the dimension baseline.
4. Commit one undoable node.

Support:

- Two-point dimensions.
- Continuous strings.
- [x] Point-to-point strings.
- Removing the last point.
- Dragging the baseline after creation.
- [x] Dragging or reassociating individual witness points.
- [x] Detaching dangling references explicitly.
- Alt to bypass magnetic attraction while retaining exact contact association.

A 3D authoring tool is not required for plan-only construction dimensions, but selected annotations should remain visible in appropriate 3D/document contexts only when that is meaningful.

### 2.3 Add a dimension-string geometry primitive

Status: implemented for linear/chord manual dimensions and automatic straight-wall dimensions. Both
sources emit the native `dimension-string` primitive, and the renderer draws per-segment labels and
baselines while deduplicating shared witness extension lines and ticks. Point-to-point manual strings
use independent paired witness segments.

The current wall planner emits one `dimension` primitive per segment. Introduce a higher-level dimension-string representation so the renderer can:

- Draw one shared baseline.
- Deduplicate witness lines at adjacent segments.
- Apply one terminator policy consistently.
- Relocate short-segment labels.
- Break or continue the baseline consistently.
- Support user overrides without mutating model geometry.

The automatic wall planner and manual construction-dimension node should converge on this shared presentation model.

### 2.4 Add project and drawing dimension standards

Status: initial persistent standards are implemented on manual construction dimensions and flow
through the shared dimension-string renderer. Each dimension now stores datum policy, terminator,
text position, imperial precision, metric notation, extension-line gap/overshoot, and
reference-dimension style; the selected-dimension panel exposes those controls. Linear/chord and
diameter dimensions render the stored line standards, and metric/imperial notation uses the stored
precision. Project-level drawing profiles, automatic wall-string tier spacing, and assembly-aware
datum resolution remain.

Suggested settings:

- [x] Datum policy: centerline, wall face, structural face, or finish face.
- [x] Terminator: architectural tick, filled arrow, open arrow, or dot.
- [x] Text position: above or centered.
- [x] Imperial precision.
- [x] Metric notation.
- First-string offset and tier spacing in paper units.
- [x] Extension-line gap and overshoot.
- [x] Reference-dimension style.

The current architectural tick can remain the default.

## Phase 3: drawing sheets and paper-space output

### 3.1 Add a persistent drawing-sheet model

A drawing sheet should own:

- Sheet ID and number.
- Sheet title.
- Paper size and orientation.
- One or more placed drawing views.
- View title and drawing number.
- Fixed drawing scale.
- Annotation profile.
- General notes.
- Keyed-note legend.
- Schedule placement.
- Title-block metadata.

The model belongs in Core because it is persistent project data. Interactive sheet composition belongs in the editor application. The Viewer should not acquire editor-only sheet concepts.

### 3.2 Implement paper-space annotation sizing

Status: initial automatic sizing is implemented for exported construction dimensions and measurement labels. Text height, tick size, extension gaps, overshoot, and label offsets are resolved from page points after the plan is fitted. Fixed user-selectable architectural scales and the remaining annotation categories still require the drawing-sheet work in Phase 3.1.

Resolve the following from plotted scale:

- Dimension text height.
- Note text height and line spacing.
- Tick and arrow size.
- Dimension-line and extension-line weight.
- Dimension-string spacing.
- Leader shoulder and terminator size.
- Mark bubble size.
- Room-label size.

The same annotation should plot consistently whether the modeled building is 8 metres or 80 metres wide.

### 3.3 Improve PDF composition

- Export at fixed architectural scales.
- Add north arrow.
- Add graphic scale.
- Add view title.
- Add scale notation.
- Add drawing and sheet reference.
- Compose schedules and notes intentionally rather than always placing schedules on separate pages.
- Support multiple paper sizes.
- Validate that no view or annotation is clipped.

### 3.4 Implement collision resolution

Status: initial label-to-label resolution is implemented in the live floor plan and PDF composition. Fixed mark pills and semantic architectural obstacles are registered with the layout resolver, so dimension values avoid door/window identifiers, wall outlines, door symbols and swing envelopes, windows, and columns. Diagonal wall outlines are sampled as short screen-space segments instead of one oversized bounding box. Short segments try outside-end and outside-start positions in order, switch the baseline extension to the clear side, and receive a leader when both architectural outside positions require further relocation. Adjacent facade strings resolve in architectural order: farther-out strings retain their datum position, same-tier labels retain drawing order, and moved labels prefer sliding along their own string before crossing tiers. Manual placement, broader symbol coverage, and user-pinned positions remain.

- [x] Move text outside short segments with a leader or extended dimension line.
- [x] Preserve string order and datum consistency.
- [x] Avoid overlaps between adjacent facade strings.
- [ ] Allow user-pinned positions to override automatic layout.
- [ ] Record layout overrides on the drawing view, not on the physical building nodes.

## Phase 4: general notes and reusable callouts

### 4.1 General notes

- Add numbered sheet-level note blocks.
- Support reusable project note sets.
- Warn about exact duplicate notes.
- Keep notes concise but do not rewrite user-authored contractual language automatically.

### 4.2 Keyed notes

- Add numbered or lettered symbols linked to a note definition.
- Support multiple instances of one keyed note.
- Keep symbol-to-note relationships stable when notes are reordered.

### 4.3 Extend leader and marker vocabulary

- Filled arrowheads.
- Slash terminators.
- Delta markers.
- Wall, glazing, and assembly tags.
- Section and elevation callouts.
- Detail references.
- Revision clouds and revision IDs.

Extend reusable annotation primitives instead of creating feature-specific SVG implementations.

## Phase 5: wall assemblies and datum semantics

### 5.1 Add wall assembly data

Represent wall layers such as:

- Structural framing.
- Interior finish.
- Exterior sheathing.
- Exterior finish or siding.
- Masonry veneer.
- Air space.
- Concrete block.
- Structural masonry.
- Solid concrete.
- Interior furring.

Each layer should declare thickness, role, material reference, and whether it can act as a dimension datum.

### 5.2 Resolve true dimension faces

Once wall layers exist, the construction-dimension resolver can provide stable semantic features such as:

- Wall centerline.
- Exterior structural face.
- Interior structural face.
- Interior finish face.
- Exterior finish face.
- Veneer face.

Automatic strings should select one face consistently for the complete string.

### 5.3 Add construction-system-specific graphics

- Assembly-aware poche and hatches.
- Heavy wall-cut graphics.
- Thin finish-layer graphics.
- Masonry veneer and air-space dimensions.
- Concrete-block and structural-masonry representation.
- Solid-concrete and furring representation.

### 5.4 Add opening documentation policies

- `RO` rough-opening notation.
- `MO` masonry-opening notation.
- Edge-to-edge opening dimensions for masonry construction.
- Centerline opening locations for framed construction.
- Optional finish-opening reference dimensions.

Do not derive rough openings from nominal dimensions unless an explicit manufacturer or assembly rule proves the value.

## Phase 6: architectural rooms and specialty documentation

### 6.1 Add an architectural space model

Status: the existing zone model now has an explicit opt-in architectural-room role while generic
site and analysis zones remain unchanged. Room zones persist number, enclosure policy, floor/wall/
ceiling finishes, ceiling height, occupancy/use, and clear-dimension policy.

Generic zones should remain available for lawns, sites, analysis regions, and user-defined areas. Add either a distinct room node or an explicit architectural-space role containing:

- Room name.
- Room number.
- Enclosure status.
- Floor finish.
- Wall finish.
- Ceiling finish.
- Ceiling height.
- Occupancy or use.
- Optional clear-dimension policy.

### 6.2 Add room documentation

Status: centered plan labels are implemented for room name, number, finishes, ceiling height, and
occupancy/use, with independent live/PDF visibility. Generated room schedules now include area,
finishes, ceiling height, occupancy/use, resolved enclosure state, unit-aware values, and document
warnings for missing/duplicate room numbers or unproven enclosure claims. Reliable clear dimensions
now render between modeled inside wall faces for proven straight rectangular enclosures, including
rotated rooms. Open, irregular, incomplete, and finish-face cases remain suppressed rather than
presenting an unproven datum; finish-face dimensions remain dependent on Phase 5 wall assemblies.

- Center room name and number.
- Place finish information below the room name.
- [x] Generate room schedules.
- [x] Generate inside-face clear dimensions only when enclosure evidence is reliable. Finish-face
  and room-to-room dimensions remain dependent on wall-assembly and inter-room datum evidence.

### 6.3 Add stair annotations

Status: implemented for straight, curved, and spiral stairs. Direction labels and arrows resolve to
`UP` or `DN` from the active level, flight notes derive riser count/height, tread depth, and clear
width from modeled geometry, rail notes use the configured side and height, and break lines separate
solid lower treads from dashed overhead construction. Stair annotations have independent persisted
live/PDF visibility.

- [x] `UP` and `DN` labels.
- [x] Riser count.
- [x] Riser height.
- [x] Tread depth.
- [x] Stair clear width.
- [x] Rail-height note.
- [x] Break-line and overhead conventions.

### 6.4 Add typed specialty notes

Status: implemented as structured construction-note specializations with schema-validated fields,
standardized derived note text, associative leaders, editor controls, and live/PDF output. Overhead
notes generate dimensioned dashed rectangular outlines with configurable rotation. Every specialty
note also carries explicit in-contract, owner-provided, existing, or `NIC` responsibility metadata
and an optional scope reference.

- [x] Attic and crawl-space access sizes.
- [x] Firewalls and rated assemblies.
- [x] Tub, shower, and spa size/type/material.
- [x] Fireplace and solid-fuel appliance requirements.
- [x] Closet type, shelf count, and shelf/pole notation.
- [x] Equipment and appliance identifiers.
- [x] Floor-above, balcony-above, and projection outlines.
- [x] Contract-scope metadata and `NIC` presentation.

## Phase 7: curved, circular, and coordinated drawings

### 7.1 Curved and circular dimensions

Status: implemented as associative construction-dimension modes using the existing semantic-anchor
workflow. The 2D measurement menu now exposes each mode; radius, chord, arc-length, and angular
dimensions include explicit label/baseline placement, while diameter and center marks commit from
their defining points and coordinate mode accepts repeated feature points. The selected-dimension
panel controls center marks, feature count, reference presentation, prefixes, suffixes, and text
overrides. Radius, center-mark, chord, arc-length, and angular modes can bind all defining points
from one curved-wall click and update when that wall is reshaped. All modes render through the
live/PDF floor-plan pipeline with unit-aware values. Curved walls also emit a visible automatic
radius leader and center mark without requiring selection or manual dimension authoring.

- [x] Radius dimensions.
- [x] Diameter dimensions.
- [x] Center marks.
- [x] Chord dimensions.
- [x] Arc length where appropriate.
- [x] Angular dimensions.
- [x] Coordinate dimensions for repeated circular features.
- [x] Feature-count notation such as `6 x DIA ...`.
- [x] Single-click associative curved-wall dimensions that follow host curve edits.
- [x] Automatic curved-wall radius leaders in live plans and document output.

### 7.2 Drawing-type coordination

Status: implemented with a persistent 2D drawing selector, one shared physical scene, and
per-dimension drawing coordination stored on associative construction-dimension nodes. The live
floor-plan registry and PDF exporter resolve the same active drawing type. Dimensions are created
in the active drawing and may be shown, omitted, or presented as references elsewhere. A floor-plan
dimension can link to a foundation-plan controller and derives its anchors, baseline, and mode from
that controller; linked/reference geometry remains read-only in the dependent drawing and reports a
visible unlinked-control state if its controller is unavailable.

Persistent views:

- [x] Floor plans.
- [x] Foundation plans.
- [x] Reflected ceiling plans.
- [x] Roof plans.
- [x] Site plans.

- [x] Allow a floor-plan dimension to be omitted, shown as reference, or linked to a controlling
  foundation-plan dimension without duplicating physical model data.

## Phase 8: advisory and completeness analysis

### 8.1 Construction module advisories

Provide optional checks for project-selected modules such as:

- 12-inch, 16-inch, and 24-inch modules.
- 100 mm, 200 mm, 400 mm, and 600 mm metric modules.

### 8.2 Clearance advisories

When configured with a current jurisdiction or office standard, check:

- Hallways and entries.
- Door approaches.
- Fixture clearances.
- Cabinet and appliance clearances.
- Closet depth.
- Stair width and tread/riser relationships.

These checks must be presented as advisory unless the exact governing code and edition are known.

### 8.3 Dimension completeness audit

Detect and report:

- Undimensioned exterior openings.
- Missing overall dimensions.
- Missing partition references.
- Missing verified rough openings.
- Duplicate or contradictory strings.
- Strings whose segment totals do not match the overall value.
- Construction-critical nodes with neither a dimension, schedule entry, nor keyed note.
- Annotation collisions and clipped sheet content.

## Recommended implementation order

1. Fix unit and export inconsistencies.
2. Add construction-annotation visibility controls.
3. Add edit/document render purpose and true-thickness document rendering.
4. Add fixed-scale, paper-space annotation output.
5. Add the manual associative construction-dimension node and tool.
6. Unify automatic and manual output through a dimension-string primitive.
7. Add sheet-level general notes, keyed notes, and title/scale/north-arrow composition.
8. Add wall assemblies and selectable datum policies.
9. Add architectural spaces and reliable room-clear dimensions.
10. Add stair, access, firewall, equipment, and contract-scope annotations.
11. Add curved/circular dimensions and construction-system-specific rules.
12. Add configurable completeness and advisory checks.

## Principal implementation locations

- Automatic dimension planning: `packages/nodes/src/wall/construction-dimensions.ts`
- Wall floor-plan integration: `packages/nodes/src/wall/floorplan.ts`
- Dimension rendering: `packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx`
- Floor-plan geometry contract: `packages/core/src/registry/types.ts`
- Registry floor-plan layer: `packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx`
- Persistent measurements: `packages/core/src/schema/nodes/measurement.ts`
- Measurement architecture: `wiki/architecture/measurements.md`
- Construction notes: `packages/nodes/src/construction-note/`
- Opening documentation: `packages/nodes/src/shared/opening-documentation.ts`
- Opening placement dimensions: `packages/nodes/src/shared/opening-placement-dimensions.ts`
- Zone labels and room precursor: `packages/nodes/src/zone/floorplan.ts`
- Stair plan graphics: `packages/nodes/src/stair/floorplan.ts`
- PDF and schedule export: `packages/editor/src/lib/floorplan/floorplan-export.tsx`

## Acceptance scenes

Every documentation phase should be checked against at least:

- A rectangular building with no openings.
- Doors and windows on all four facades.
- An L-shaped building.
- A stepped facade with several jogs.
- Multiple collinear wall segments forming one facade.
- Two disconnected collinear facade runs.
- Interior partitions with openings and different wall thicknesses.
- Exterior columns extending beyond the wall envelope.
- Rotated and angled buildings.
- Curved walls and circular column patterns.
- Imperial and metric document profiles.
- Small and large buildings plotted at the same paper scale.
- Dense notes, dimensions, and schedules that exercise collision handling.
- A foundation plan and floor plan sharing one modeled opening.
