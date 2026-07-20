# Floor Plan Construction Documentation Roadmap

## Purpose

This document tracks the gap between the current Pascal floor plan and a U.S.-style construction-document floor plan. It combines:

- `Chapter_17_Floor_Plan_Dimensions_and_Notes.pdf`
- `Screenshot 2026-06-30 at 2.36.59 PM.png`
- The implementation present at commit `1f09dc120`
- Product decisions made during the floor-plan dimension work

This is a working implementation tracker, not a claim that every convention in the textbook is mandatory for every project or jurisdiction.

## Status legend

| Status | Meaning |
| --- | --- |
| Implemented | Present in the current working implementation and covered by tests where practical. |
| Partial | Some supporting behavior exists, but the construction-document requirement is incomplete. |
| Planned | Not implemented yet and included in the recommended roadmap. |
| Intentionally excluded | Deliberately removed or deferred by product decision. |

## Current product decisions

1. Classified interior partitions receive wall-local jamb-to-jamb strings plus an overall wall span. Full room-to-room clear-dimension automation still waits for a reliable room model.
2. Exterior construction dimensions remain outside the building or exterior zone. Interior partition strings use the larger bounded adjacent space and do not alter the exterior hierarchy.
3. The existing metric/imperial control is the product-level unit switch. Strict textbook metric notation is not currently a priority.
4. Door and window widths are documented through exterior or interior wall strings and schedules rather than repeating full nominal size labels beside every opening.

## Combined recommendation

The original first-phase recommendation was:

1. Establish a consistent dimension datum policy.
2. Add a building-jog/projection dimension tier.
3. Improve string spacing, suppression, and cleanliness.

The reference drawing confirms those priorities, but also shows that structural grids and column centerlines belong in the same foundation. The recommended first phase is therefore:

### Phase 1 - Exterior construction dimension system (implemented)

#### 1. Dimension datum policy

Use one explicit policy for automatic U.S. new-construction dimensions:

| Feature | Default datum |
| --- | --- |
| Exterior wall | Outside face of structural wall |
| Interior partition referenced from an exterior string | Consistent face of stud |
| Door or window location | Opening centerline |
| Door or window width | Opening edges |
| Freestanding post or column | Structural centerline |
| Building projection or recess | Exterior structural face |

The partition face must be chosen consistently for an entire string. A project-level centerline option can be added later if required, but face-of-stud should be the default for new construction.

#### 2. Exterior string hierarchy

The automatic hierarchy should be:

1. Opening widths
2. Opening center locations
3. Intersecting partition locations
4. Structural grid and column center locations
5. Building jogs, projections, and recesses
6. Overall building dimension
7. Overall structural envelope when posts or columns extend beyond the building

Empty tiers should not consume space.

#### 3. Layout and cleanup rules

- Keep all automatic strings outside the building envelope.
- Keep tier offsets consistent on every facade.
- Remove duplicate reference points.
- Suppress zero-length and very small accidental segments.
- Combine continuous collinear facade runs.
- Keep disconnected facade runs independent.
- Avoid dimension text collisions and move text when a segment is too short.
- Preserve extension-line gaps, overshoot, slash direction, and readable text orientation.
- Update associatively when a wall, opening, post, column, or wall thickness changes.

#### 4. Phase 1 acceptance scenes

- Rectangular building with no openings
- Building with doors and windows on all four facades
- L-shaped building with one projection and one recess
- Stepped facade with multiple jogs
- Patio or canopy supported by columns outside the wall envelope
- Multiple collinear wall segments forming one facade
- Two disconnected collinear facade runs
- Exterior wall intersected by partitions with different thicknesses
- Rotated building and angled exterior wall
- Imperial and metric display modes

The Phase 1 implementation keeps its baselines outside the outermost wall or structural-column row, compacts inactive tiers, and has regression coverage for straight, stepped, disconnected, varied-thickness, structural-column, angled, imperial, and metric cases. Final visual QA should still be repeated as new node types begin contributing construction references.

## Master implementation inventory

### A. Dimension graphics

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Aligned architectural dimension lines | PDF | Implemented | Dimensions align with the measured feature. |
| Thin dimension and extension lines | PDF and reference | Implemented | Dimension strokes are lighter than primary wall geometry. |
| Extension-line gap at the measured feature | PDF | Implemented | A small gap is rendered before the extension line begins. |
| Extension-line overshoot | PDF | Implemented | Extension lines continue past the dimension line. |
| Consistent 45-degree architectural slash marks | PDF and reference | Implemented | Slash direction is consistent within a string. |
| Dimension text above the line | PDF and reference | Implemented | Labels remain upright after plan rotation. |
| Imperial feet, inches, and fractions | PDF and reference | Implemented | Imperial values support fractional inches. |
| Metric display through the global unit control | Product decision | Implemented | Current display uses meters. |
| Strict millimeter drafting notation with no unit suffix | PDF | Intentionally excluded | Revisit only if strict metric construction-document output becomes a requirement. |
| Adaptive paper-space spacing and collision handling | PDF and reference | Planned | Current offsets and text sizes are primarily plan-space constants. |
| Fixed plotted architectural scale | PDF and reference | Planned | Current PDF export fits the plan to the page. |

### B. Automatic exterior dimension strings

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Opening-width string | Current product requirement | Implemented | Uses door and window opening edges only when the host face is geometrically open to the exterior. |
| Door and window center-location string | PDF and reference | Implemented | Uses hosted opening centers; openings on occluded interior walls never send witness lines outside. |
| Intersecting partition string | PDF and reference | Implemented | Uses a consistent face of stud and responds to partition thickness. |
| Overall facade dimension | PDF and reference | Implemented | Collinear facade segments can form one overall run. |
| Exterior-face dimension origin | PDF | Implemented | Uses the classified exterior side of the wall. |
| Building jog/projection/recess string | PDF and reference | Implemented | Connected stepped facade runs share an aligned exterior baseline. |
| Structural column and post centerline string | Reference | Implemented | Aligned exterior or wall-integrated column rows use structural centers; fully interior columns retain local center marks without sending witness lines outside. |
| Overall structural envelope beyond walls | Reference | Implemented | Added when the exterior column row extends past the wall envelope. |
| Project-selectable centerline/face-of-stud/face-of-finish policy | PDF | Partial | Face-of-stud is the automatic default; project-level selection remains planned. |
| Automatic internal partition dimensions | PDF and reference | Implemented | Wall-local strings dimension solid segments, hosted door/window widths, and the overall partition span; bounded partitions remain eligible when side metadata is incomplete, and the larger adjacent side is preferred. |
| Automatic room-to-room clear dimensions | PDF and reference | Planned | Requires a reliable architectural room model and finish-face policy. |

### C. Doors and windows

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Door swing and operation graphics | Reference | Implemented | Hinged, sliding, pocket, and other supported types have plan symbols. |
| Window plan symbol | Reference | Implemented | Basic frame and mullion graphics are present. |
| Automatic door and window marks | PDF and reference | Implemented | Deterministic marks can be overridden. |
| Mark bubbles with leaders | Reference | Implemented | Current bubble styling is product-specific. |
| Door schedule | PDF | Implemented | Includes mark, type, nominal size, rough opening, operation, frame, and hardware. |
| Window schedule | PDF | Implemented | Includes mark, type, nominal size, rough opening, sill, head, and operation. |
| Rough-opening fields | PDF | Implemented | Values remain optional until verified. |
| Duplicate-mark warning | Construction-document quality | Implemented | Export reports duplicate explicit marks. |
| Full nominal-size text beside every opening | PDF alternative | Intentionally excluded | Schedules and exterior dimensions are the preferred presentation. |
| Masonry-opening `MO` and rough-opening `RO` plan notation | PDF | Planned | Requires construction-system-aware wall and opening documentation. |

### D. Rooms and interior features

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Centered zone name | Current implementation | Implemented | Existing zone labels are not yet a complete architectural room model. |
| Architectural room/space object | PDF and reference | Planned | Needs room name, number, finish data, and reliable room polygon ownership. |
| Interior partition and opening dimension strings | Reference | Implemented | Associative wall-local chains include door/window widths and a farther overall span. |
| Room name and finish dimensions | PDF | Planned | Finish information should appear below the room name when required. |
| Appliance labels | PDF | Partial | Cabinet appliance modules provide common labels; generic items do not have a complete documentation policy. |
| Tub, shower, spa, fireplace, and equipment notes | PDF | Planned | Depends on the reusable note and leader system. |
| Closet shelf and pole labels | PDF | Planned | Includes closet type and shelf count. |
| Attic and crawl-space access callouts | PDF | Planned | Requires access-opening semantics and annotation. |
| Firewall designation | PDF | Planned | Includes rated wall type and extent. |
| Standard-feature assumption rules | PDF | Planned | Examples include centered doors and standard cabinet or shower sizes. |

### E. Notes, tags, and cross-references

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Generic straight leader with shoulder and terminator | PDF and reference | Implemented | Construction notes support multiline text, arrow/dot/no terminator, editable shoulder length, free anchors, and optional associative attachment to scene elements. |
| Curved leader | PDF | Implemented | Construction notes support quadratic leaders with a draggable on-curve handle that remains associative as targets and text move. |
| Specific or local construction note | PDF and reference | Implemented | The reusable construction-note node can author examples such as column size, grouting, ventilation, and installation notes. |
| General numbered notes block | PDF | Planned | Needs sheet-level placement and reusable project notes. |
| Keyed note symbols | PDF and reference | Planned | Includes symbol-to-note mapping. |
| Wall, glazing, and assembly type tags | Reference | Planned | Reference examples include tags such as `2`, `4`, `2A`, `A`, and `G`. |
| Section, elevation, and detail callouts | Reference | Planned | Includes drawing number, sheet number, and view direction. |
| Revision cloud | Reference | Planned | Must associate with a revision identifier. |
| Delta revision marker | PDF and reference | Planned | Includes numbered triangular markers. |

### F. Stairs, elevators, and structural elements

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Stair direction graphic | PDF and reference | Implemented | Straight and curved stair representations provide direction. |
| `UP` or `DN` label | PDF and reference | Planned | Should follow the stair direction. |
| Riser count, riser height, and tread depth | PDF and reference | Planned | Reference uses a compact stair note. |
| Stair break and overhead convention | Reference | Partial | Stair geometry exists, but construction-document cut and overhead rules need review. |
| Elevator and shaft geometry | Reference | Implemented | Basic plan representation is available. |
| Elevator installation or manufacturer note | Reference | Planned | Depends on the note and leader system. |
| Column geometry | Reference | Implemented | Structural documentation is incomplete. |
| Column centerline, size, material, and reinforcement callout | Reference | Partial | Center marks and exterior centerline dimensions are implemented; size, material, and reinforcement notes remain planned. |

### G. Special geometry and construction systems

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Curved wall plan geometry | PDF | Implemented | Curved walls can be modeled and displayed. |
| Selected curved-wall arc-length label | Current implementation | Implemented | This is an editing label, not full construction documentation. |
| Radius, center, and chord dimensions for curved walls | PDF | Planned | Curved walls are currently skipped by automatic construction dimensions. |
| Circular feature coordinate and angular dimensions | PDF | Planned | Needed for patterned columns and circular layouts. |
| Diameter callout and feature count | PDF | Planned | Requires a leader-note primitive and circular feature semantics. |
| Masonry veneer thickness and air-space documentation | PDF | Planned | Requires wall assembly semantics. |
| Concrete block and structural masonry dimension rules | PDF | Planned | Openings should support edge-to-edge `MO` or `RO` dimensions. |
| Solid concrete wall and interior furring documentation | PDF | Planned | Requires construction-system-aware wall assemblies. |
| Foundation-plan coordination | PDF | Planned | Allows garage-door and other foundation-established dimensions to be referenced or omitted. |

### H. Graphic hierarchy and hidden information

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Heavy wall cut graphics | Reference | Partial | Walls have strong graphics, but they are not assembly-specific. |
| Medium door, window, stair, and fixture graphics | Reference | Partial | Individual symbols exist; plotted hierarchy needs normalization. |
| Thin dimensions, leaders, and centerlines | PDF and reference | Partial | Dimensions and straight or curved construction-note leaders are implemented; a unified centerline annotation remains planned. |
| Material poche and hatch patterns | Reference | Planned | Needed for masonry, concrete, elevator shafts, and wall assemblies. |
| Hidden or overhead dashed geometry | PDF and reference | Partial | Some nodes use dashed graphics, but there is no unified architectural visibility policy. |
| Upper-floor, balcony, or projection-above outline | PDF | Planned | Should use dashed lines and a specific note. |
| `NIC` or excluded-from-contract display | PDF | Planned | Requires contract-scope metadata and dashed representation. |

### I. Sheet presentation and export

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Per-level PDF plan export | Current implementation | Implemented | Each level can be exported. |
| Door and window schedule pages | PDF | Implemented | Generated from registered node definitions. |
| North-up export orientation | Reference | Implemented | Export accounts for building rotation. |
| North arrow | Reference | Planned | Requires a sheet annotation layer. |
| Graphic scale | Reference | Planned | Must match the selected plotted scale. |
| View title such as `FIRST FLOOR` | Reference | Partial | Export includes a level label, but not the reference drawing's title treatment. |
| Drawing and sheet reference such as `1/A101` | Reference | Planned | Depends on sheet and drawing identity. |
| Fixed architectural print scale | PDF and reference | Planned | Examples include `1/4\" = 1'-0\"` and `1:50`. |
| Paper-space text, tick, and line-weight control | PDF and reference | Planned | Required for consistent output across differently sized buildings. |

### J. Design validation and advisory rules

| Requirement | Source | Status | Notes |
| --- | --- | --- | --- |
| Persistent distance, angle, area, perimeter, and volume measurements | Current implementation | Implemented | These are editing measurements, not automatic construction strings. |
| Standard U.S. construction module advisory | PDF | Planned | Optional validation for 12-inch, 16-inch, and 24-inch modules. |
| Common hallway, closet, cabinet, and fixture clearance checks | PDF | Planned | Better treated as validation warnings than automatic dimensions. |
| Dimension completeness audit | PDF | Planned | Should identify undimensioned construction-critical features without flooding the plan. |

## Recommended delivery phases

### Phase 1 - Exterior datum, jogs, grids, and structural envelope (implemented)

Implemented with consistent face-of-stud partition references, active-tier spacing, stepped-facade chains, structural column centers, and an extended structural envelope.

### Phase 2 - Reusable construction annotation framework (in progress)

The construction-note node now supports multiline text, straight and curved leaders with shoulders, selectable terminators, editable anchor, text, and curve handles, and optional associative attachment to walls, openings, and other scene elements.

Build reusable scene/document primitives for:

- Straight and curved leaders
- Specific notes
- General notes
- Keyed notes and delta markers
- Wall, glazing, and assembly tags
- Section, elevation, and detail callouts
- Revision clouds

This phase unlocks many later features without adding one-off annotation implementations.

### Phase 3 - Sheet presentation and print control

- Fixed architectural scales
- Paper-space text and line weights
- North arrow
- Graphic scale
- View title and drawing reference
- Reliable PDF composition

### Phase 4 - Construction-system documentation

- Wall assemblies and material hatch patterns
- Masonry veneer
- Concrete block and structural masonry
- Solid concrete and furring
- `MO` and `RO` dimensions
- Foundation-plan coordination

### Phase 5 - Rooms and specialty documentation

- Architectural room/space model
- Room finish information
- Stair annotations
- Access, firewall, equipment, and closet notes
- Curved and circular construction dimensions
- Design validation and completeness checks

## Implementation pointers

- Exterior dimension planning: `packages/nodes/src/wall/construction-dimensions.ts`
- Wall floor-plan integration: `packages/nodes/src/wall/floorplan.ts`
- Architectural dimension renderer: `packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx`
- Door and window documentation: `packages/nodes/src/shared/opening-documentation.ts`
- Door and window documentation fields: `packages/nodes/src/shared/opening-documentation-fields.tsx`
- Floor-plan PDF and schedule export: `packages/editor/src/lib/floorplan/floorplan-export.tsx`
- Room-name precursor: `packages/nodes/src/zone/floorplan.ts`
- Stair plan graphics: `packages/nodes/src/stair/floorplan.ts`
- Persistent editing measurements: `packages/core/src/schema/nodes/measurement.ts`
- Reusable construction notes: `packages/nodes/src/construction-note/`

## Change log

- `2026-07-20` - Made internal door/window dimension chains resilient to incomplete wall-side metadata by geometrically recognizing bounded partitions without treating unbounded unknown walls as interior.
- `2026-07-20` - Increased the facade clear zone and active dimension-tier spacing so opening widths, center locations, partitions, structure, jogs, and overall strings remain readable as tiers accumulate.
- `2026-07-20` - Added quadratic curved construction-note leaders with tangent terminators and an associative draggable curve control.
- `2026-07-20` - Added automatic interior partition chains with door/window widths, clear wall segments, overall spans, and bounded-side placement.
- `2026-07-20` - Started Phase 2 with reusable straight-leader construction notes, multiline text, terminator controls, editable handles, and associative target attachment.
- `2026-07-20` - Implemented Phase 1 exterior datum policy, compact tier planning, jog chains, column center marks and centerline strings, and structural-envelope dimensions.
- `1f09dc120` - Added opening marks, opening schedules, rough-opening documentation, exterior construction-dimension refinements, and removed automatic internal dimension strings.
