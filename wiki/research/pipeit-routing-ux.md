# PipeIt routing UX comparison

Research date: 2026-09-07

## Recommendation

Use PipeIt's interaction model as the reference, but keep Pascal's engineering-specific duct and DWV rules. The best first implementation slice is exact typed length plus in-draw step-back in the shared distribution-run engine. Follow it with visible direction candidates and endpoint “continue” affordances. These improve both tools without requiring a scene-schema migration.

PipeIt's deeper advantage is its explicit connected-network model. Pascal already infers a connection graph from coincident typed ports and preserves connected geometry during moves, so persistent network topology should be evaluated only after the high-value drawing improvements have shipped.

## Verified PipeIt workflow and features

All product claims below come from PipeIt's official documentation/site or its publisher listing on Epic's Fab marketplace.

1. **Connected graph model.** A network contains nodes and edges. Node roles include caps, straights, 90° corners, 45° half-corners, tees, crosses, and brackets. Changing topology makes PipeIt choose the matching kit pieces again. [Official core concepts](https://pipeit-plugin.com/docs/guide/concepts/)
2. **Draw from a valid connection.** Selecting a piece exposes green `+` arrows in directions it can grow. Clicking one starts Draw Mode; repeated clicks chain a run, while `Enter` or `Esc` finishes. A ghost piece, active guide, alternate direction guides, and live length accompany the cursor. [Official drawing guide](https://pipeit-plugin.com/docs/guide/drawing-pipes/)
3. **Direction candidates.** PipeIt projects the cursor onto piece-local axes, world axes, and 45° diagonals when the active kit supports them. It highlights the winning candidate and leaves alternatives visible. [Official drawing guide](https://pipeit-plugin.com/docs/guide/drawing-pipes/)
4. **Exact numeric length.** Digits and a decimal set length in centimetres; `Enter` commits it. The typed value overrides cursor and surface-snap distances. `Backspace` first edits the number and then removes the most recently placed segment. [Official drawing guide](https://pipeit-plugin.com/docs/guide/drawing-pipes/)
5. **Surface termination.** Holding `Ctrl`/`Cmd` traces along the chosen direction to a wall or floor, shows a cyan target, lands exactly on the surface, and finishes that run. Too-short placements are rejected based on fitting/socket clearance. [Official drawing guide](https://pipeit-plugin.com/docs/guide/drawing-pipes/)
6. **Topology editing.** Users can insert a section on an edge, branch from it, and promote a joint to a tee or cross. Surrounding spans update automatically. [Official editing guide](https://pipeit-plugin.com/docs/guide/editing-networks/)
7. **Contextual selection and commands.** Users select nodes or edges, walk a run with comma/period, multi-select, and box-select. A viewport panel shows only relevant shortcuts, while a right-click menu exposes the same operations and explains disabled actions. [Official editing guide](https://pipeit-plugin.com/docs/guide/editing-networks/)
8. **Connected transforms.** Move, rotate, and roll use on-screen gizmos. A junction rotation swings the connected chain without breaking joints, and affected pieces ghost-preview before commit. [Official changelog](https://pipeit-plugin.com/changelog/)
9. **Variants and kits.** Compatible mesh variants can be cycled or selected from thumbnails. The same topology can be re-skinned with another kit; kits define pipes, junctions, caps, brackets, tiling, and connection sockets. [Official kits guide](https://pipeit-plugin.com/docs/guide/kits/)
10. **Flexible curves.** A fixed corner can become a spline edge with insertable control points and automatic or user-controlled tangents. [Official flexi-pipe guide](https://pipeit-plugin.com/docs/guide/curved-pipes/)
11. **Associative brackets.** A bracket inserted on an edge traces toward the nearest suitable surface, sizes its arm automatically, and re-solves when the pipe or supporting surface moves. [Official brackets guide](https://pipeit-plugin.com/docs/guide/brackets/)
12. **Authoring and output.** Users can author socket-based custom kits with validation, and bake finished networks into static meshes, components, or instanced meshes. The Fab listing also advertises runtime Blueprint editing, undo/redo batching, and save/load. [Official kit-authoring guide](https://pipeit-plugin.com/docs/guide/authoring-kits/), [official baking guide](https://pipeit-plugin.com/docs/guide/baking-and-exporting/), [Epic Fab listing](https://www.fab.com/listings/379dbd74-6b86-4aa5-a9ff-78bf7e394153)

### Camera-relative 3D direction selection

PipeIt's published web editor shows the aiming algorithm behind the drawing guide. It builds legal direction candidates from the current piece direction, including perpendicular 90° turns and normalized 45° blends. For each candidate it solves the closest approach between the camera cursor ray and the candidate ray from the connection point. It clamps that distance to the fitting/socket minimum, then chooses the candidate whose resulting point has the smallest angle to the camera ray. The camera therefore selects among true model-space directions; it does not redefine which way is vertical. [Official live editor](https://pipeit-plugin.com/editor/), [official drawing guide](https://pipeit-plugin.com/docs/guide/drawing-pipes/)

## Current Pascal comparison

| Capability | Pascal today | Gap / next move |
|---|---|---|
| Continuous drawing | The shared engine keeps the last endpoint as the next start and both tools place repeated runs. | Preserve this; add explicit finish semantics rather than treating `Esc` only as clearing the current start. |
| Grid and angle behavior | Connected runs now resolve true 3D straight, perpendicular, and 45° directions against the building-local camera ray. The preview shows the winning direction and alternatives; Alt remains an explicit vertical override. | Filter candidates against exact fitting-clearance rules before showing them. |
| Live measurements | The shared cursor shows X/Y/Z deltas and duct/pipe size; DWV also shows system and slope state. | Add a focused length value and an editable numeric-entry state. |
| Exact length / step-back | Not implemented in the shared run engine. | Highest-value first slice: number buffer, unit-aware parsing, `Enter` commit, `Backspace` digit removal, then segment step-back. |
| Draw from existing geometry | The cursor can begin at a nearby port or run body, and each tool inherits connected profile/system properties. | Add discoverable endpoint `+` handles and valid-direction affordances on selected runs/fittings. |
| Automatic fittings | Both tools plan elbows, body taps/tees, and cross intersections. Duct previews planned fitting ghosts before commit. | Make pipe preview use the same plan-as-preview contract; expose invalid/too-short outcomes before click. |
| Branching | Starting or ending on a run body creates a tap; crossing a run creates a cross. | Add intentional insert-on-edge and branch commands so topology editing does not depend on proximity alone. |
| Connection-preserving edits | Core reconstructs a graph from coincident compatible ports; shared move connectivity propagates changes to attached runs/fittings. Endpoint tools re-aim fittings. | Strong foundation, but connections are inferred geometrically within tolerance rather than persisted as topology. Add stable joint identity only when network operations require it. |
| Committed-run editing | 3D and 2D path-point handles exist; run translation and duct roll are supported, with live connected previews. | Consolidate node/edge selection language and contextual actions across duct and DWV. Add walk-selection and clearer affected-chain highlighting. |
| Styles | Duct and pipe expose engineering properties such as shape, size, system, material, insulation, roll, and slope. | Prefer engineering “system/profile presets” over copying PipeIt's art-mesh kits literally. A preset must not move topology. |
| Surface snap | Duct supports ceiling-mode placement; ports and run bodies snap automatically according to Pascal's snap mode. | Add an explicit directional terminate-at-surface operation. Do not copy PipeIt's `Ctrl` binding directly because Pascal reserves Ctrl to cycle the grid step. |
| Curves | Paths can contain multiple straight sections; no PipeIt-style editable spline edge exists here. | Later: support flex duct or engineered long-radius bends as domain-specific geometry. Do not permit arbitrary DWV splines. |
| Brackets/hangers | No corresponding associative support workflow exists in these folders. | Later: shared hanger/support nodes with surface association; spacing and support rules should be system-specific. |

### Code evidence

- Shared draw state, snapping, continuous commit, vertical gesture, and cursor UI: `packages/nodes/src/shared/distribution-run-tool.tsx`.
- Pipe slope/system/diameter behavior and elbow/tee/cross commit planning: `packages/nodes/src/pipe-segment/tool.tsx`.
- Duct profile/ceiling behavior plus plan-driven fitting preview: `packages/nodes/src/duct-segment/tool.tsx`.
- Shared duct and pipe fitting planners: `packages/nodes/src/shared/auto-fitting.ts`.
- Geometry-derived connected-chain editing: `packages/core/src/services/port-connectivity.ts` and `packages/nodes/src/shared/run-move-connectivity.ts`.
- Committed-run handles and fitting re-aiming: `packages/nodes/src/{pipe-segment,duct-segment}/selection.tsx`.

## Implementation sequence

### Phase 1 — Finish the shared draw loop

1. Add a pure, tested numeric-length input state machine to `distribution-run-tool.tsx`.
2. Accept decimal input in the viewer's current unit, display it in the cursor pill, and project the endpoint along the active direction.
3. Make `Enter` commit a typed length when input exists; otherwise finish the active run.
4. Make `Backspace` edit input first, then undo only the previous segment from the current draw session.
5. Track draw-session commits as reversible batches so step-back restores every fitting/run split made by that click, not merely the new segment.
6. Add the same behavior to the 2D drafting path, per the repository's 2D/3D parity rule.

Acceptance criteria: duct and DWV share all interaction code; exact imperial and metric lengths land correctly; one Backspace restores the complete prior click; Escape never deletes already-finished work.

### Phase 2 — Make the preview explain the route

1. Extract direction-candidate calculation into pure shared logic.
2. Render the active direction guide, faint alternatives, exact length, and invalid/minimum-length state.
3. Extract pipe commit planning into a pure planner like `planDuctDraw`, then preview the exact pipe fittings and trims that will commit.
4. Add selected-end `+` affordances for runs and fittings, filtered to directions the relevant fitting/profile can build.

Acceptance criteria: the preview is structurally identical to the commit; unavailable directions never appear; starting from existing geometry is visually discoverable.

### Phase 3 — Intentional topology editing

1. Add edge hit-testing that preserves the exact segment and interpolation parameter.
2. Add Insert Section and Branch Here actions in a contextual menu/HUD.
3. Reuse current tee/cross planners for automatic promotion and splitting.
4. Add node/edge selection vocabulary, network walking, and affected-chain highlighting.
5. Add minimum straight/fitting-clearance validation with a visible explanation.

### Phase 4 — Surface and engineering workflows

1. Add directional terminate-at-surface snapping using Pascal's existing snap-mode conventions and a non-conflicting control.
2. Add topology-preserving profile/system presets, including valid size transitions.
3. Add associative hangers/supports with shared surface tracing and duct/DWV-specific spacing rules.
4. Consider explicit persistent joint IDs if inferred coincident-port connectivity becomes ambiguous during insert/delete/multi-select operations.

### Phase 5 — Specialized features

- Flex/spline routing only for systems where it is physically meaningful.
- Network copy/paste and batch operations.
- Export/bake optimization if scene performance or downstream delivery requires it.
- Authorable visual kits only if custom appearance libraries become a real product requirement.

## What not to copy directly

- PipeIt is an environment-art tool, whereas Pascal models engineering systems. Arbitrary mesh variants and flexible curves must remain constrained by fitting, slope, profile, and system rules.
- PipeIt's `Ctrl` surface-snap shortcut conflicts with Pascal's documented Ctrl grid-step behavior.
- Unreal-specific Blueprint/runtime editing and mesh baking do not improve the immediate duct/DWV authoring workflow and should not lead the roadmap.
