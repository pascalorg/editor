# Blender-Style Block Edit Mode Research

## Purpose and conclusion

This brief describes the Edit Mode interaction shown by the linked X post, how Blender's mesh Edit Mode actually behaves, what the current Pascal block slice already implements, and the staged work required for a credible Blender-like experience. External behavior claims use only current first-party Blender manuals, developer documentation, and API documentation. Repository claims come from the current worktree, audited on 2026-08-10.

The central recommendation is unchanged but now concrete:

1. Keep persistent, adjacency-rich topology with stable component IDs as the source of truth. `THREE.BufferGeometry` remains a derived render and picking artifact.
2. Treat Edit Mode as a persistent editor session containing component selection and display state.
3. Run every transform or topology command through one modal preview → confirm/cancel lifecycle, regardless of whether it starts from a gizmo, keyboard shortcut, or toolbar button.
4. Deliver in dependency order. The current box, component selection, axis translation, and single-face extrusion are a useful vertical slice, not Blender parity.

## What the linked video suggests

The [37-second X video](https://x.com/00namazu86_7/status/2079180451521200550) primarily demonstrates architectural massing: a rectangular footprint becomes a shallow solid, a top face is raised with a measured handle, and contextual surface actions lead into higher-level building and material workflows. The closest first product target is therefore **face Push/Pull on an editable architectural solid**, built on a topology model capable of growing toward Blender-style component editing.

That does not mean the block should absorb Pascal's semantic model. Walls, slabs, roofs, openings, balconies, and hosted items should remain semantic nodes or explicit semantic commands. Materials and day/night presentation remain orthogonal to topology. Stable hosting on a block face would require a later face-host contract that survives topology remapping.

## Current Pascal implementation

The worktree already contains a coherent first vertical slice.

| Area                 | Current implementation                                                                                                                                                                                                                                                                                                                                                                                                          | Current boundary                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent schema    | [`BlockNode`](../packages/core/src/schema/nodes/block.ts) stores level-local position/rotation plus stable-ID vertices, undirected edges, ordered face vertex loops, per-face `materialSlot`, and optional slots. A box is the default topology.                                                                                                                                                                     | No face-corner/loop attributes, holes, explicit adjacency, or topology version/revision.                                                                                                                                      |
| Validation           | `inspectBlockTopology` rejects duplicate component IDs, self-edges, missing vertex references, duplicate undirected edges, faces with fewer than three distinct vertices, and missing face-boundary edges.                                                                                                                                                                                                                 | It does not yet define a manifold policy or reject zero-length edges, repeated vertices in a longer face loop, duplicate faces, non-planar/zero-area/self-intersecting faces, inconsistent winding, or failed triangulation.  |
| Pure commands        | [`commands.ts`](../packages/nodes/src/block/commands.ts) exposes component translate/rotate/scale/delete plus single-face extrude/inset, returns a new topology plus selection, preserves input immutability, allocates stable IDs, and validates the result.                                                                                                                                                             | Selection supports one mode at a time, has no identity remap, and extrude/inset handle exactly one face with immediate numeric parameters rather than modal region operations.                                                |
| Derived geometry     | [`geometry.ts`](../packages/nodes/src/block/geometry.ts) projects each face to 2D, triangulates it, generates flat normals/UVs/material groups, and stores triangle ranges keyed by face ID.                                                                                                                                                                                                                              | Triangulation assumes a usable planar simple loop; rebuilding replaces the whole `BufferGeometry`; the face-range metadata is not yet the main component picker.                                                              |
| Registry integration | [`definition.ts`](../packages/nodes/src/block/definition.ts) registers geometry, floor-plan output, placement preview/tool, selection affordance, item-style snapping, move/delete/duplicate, floor placement, collision, and materials. The node is registered in the built-in plugin and appears through registry-driven build UI.                                                                                      | Object rotation is stored but no rotatable capability is declared. The floor plan uses the XZ convex hull, so concavity and overhang distinctions are lost.                                                                   |
| Edit UI              | [`selection.tsx`](../packages/nodes/src/block/selection.tsx) mounts only for a sole selected block. It has a dedicated `mesh-editing` interaction scope, active-white/selected-orange components, topology-aware `1`/`2`/`3` conversion, All/Invert/Clear, X-Ray, tool-gated compact move handles, numeric rotate/scale, Extrude, Inset, Merge at Center, Dissolve Edge, component Delete, shortcuts, and Done/Tab. | Detailed session state is still component-local; there is no mixed-mode or box selection, face-center picking, plane/free transform handles, orientation/pivot controls, proportional editing, or full modal operator engine. |
| Preview/history      | The complete Edit Mode session owns the `mesh-editing` scope, suppressing object selection and whole-node movement. Axis drag snapshots topology, previews through `useLiveNodeOverrides`, clears on cancel/unmount, and performs one `updateNode` on release. Numeric operators perform one validated scene update.                                                                                                            | Numeric operators do not yet provide pointer preview/cancel, typed modal input, or a durable last-operator record for parameter replay.                                                                                       |
| Tests                | Core schema tests cover the default box and a missing boundary edge. Command tests cover extrusion, ID allocation, translation, rotation, scale, inset, deletion, and topology validity. Selection tests cover active identity, toggling, conversion, All, and Invert; scope tests cover persistent mesh-edit ownership.                                                                                                        | No tests yet cover pointer picking/occlusion, component visuals, preview cancellation/history, save/reload, floor-plan updates, degeneracies, performance, or end-to-end user workflows.                                      |

This implementation already follows two important repository precedents:

- Polygon editing already provides direct vertex/edge affordances through the shared [`PolygonEditor`](../packages/editor/src/components/tools/shared/polygon-editor.tsx).
- The slab boundary editor already demonstrates the desired one-undo transaction: preview through `useLiveNodeOverrides`, mark dirty at pointer rate, clear on cancel/unmount, and perform one scene update on release. [Slab boundary editor](../packages/nodes/src/slab/boundary-editor.tsx), [Pascal tool rules](architecture/tools.md)

## Blender's actual Edit Mode UX

### Entry, exit, and mode ownership

Blender uses `Tab` to toggle Edit Mode for supported objects. Entering a mode changes viewport appearance, header, toolbar, menus, and the shortcut map; Object Mode transforms the object while Edit Mode changes its components. Blender also supports multiple objects in Edit Mode, but cannot connect geometry across different objects. [Blender object modes](https://docs.blender.org/manual/en/latest/editors/3dview/modes.html)

For Pascal v1, the transferable behavior is explicit mode ownership, not multi-object editing. Tab and an Edit Mesh action should enter a sole selected block; Tab should exit when no modal command is active. Escape should first cancel the current command. The canvas, contextual HUD, shortcut routing, and component overlays must all derive from the same session.

### Component modes, visuals, and active element

Blender's `1`, `2`, and `3` modes have a precise visual vocabulary:

- Vertex mode shows vertices as points: unselected black, selected orange, active/last-selected white.
- Edge mode hides vertex points: unselected edges black, selected edges yellow/orange, active edge white.
- Face mode shades selected faces orange and gives the active face a white border.

Shift allows multiple component modes. Ascending mode conversion keeps only complete higher-order elements; descending conversion selects every constituent. Ctrl changes switching into expand/contract behavior. [Blender mesh selection](https://docs.blender.org/manual/en/latest/modeling/meshes/selecting/introduction.html)

Blender's overlays can additionally show face orientation, selected-face fill, face centers, indices, edge lengths/angles, face areas/angles, and normals; measurements update while components transform. [Blender viewport overlays](https://docs.blender.org/manual/en/latest/editors/3dview/display/overlays.html)

Pascal now tracks an active ID and ordered selected IDs, and mode switching normalizes one coherent topology selection instead of clearing it. That ordering contract must be preserved when Merge at First/Last and Active Element pivot are added.

### Occlusion and X-Ray

With X-Ray off, occluded geometry is not selectable. X-Ray enables through-selection; in Face mode, selection uses face-center dots rather than clicking anywhere on the filled surface. Blender notes that dense overlapping components can still cause region-selection misses and that a concave n-gon's center dot can fall somewhere visually misleading. [Blender mesh selection](https://docs.blender.org/manual/en/latest/modeling/meshes/selecting/introduction.html)

Pascal now exposes a visual X-Ray toggle and depth-tests component overlays by default. Full picking parity still requires:

- Default: depth-tested, frontmost component picking and visuals.
- X-Ray toggle: through-picking plus visually muted occluded components.
- Face mode in X-Ray: explicit face-center pick targets.
- Region selection: screen-space point/edge/face tests with a documented frontmost-versus-through policy.

### Transform gizmos versus modal `G`/`R`/`S`

Blender supports two input surfaces over one transform model. Object gizmos also apply to mesh components: red/green/blue axes constrain to one axis; Move and Scale include two-axis plane squares; white handles provide view-plane/free movement, view rotation/trackball behavior, or uniform scale. Gizmos can be shown or hidden independently. [Blender viewport gizmos](https://docs.blender.org/manual/en/latest/editors/3dview/display/gizmo.html)

`G`, `R`, and `S` start keyboard modal Move, Rotate, and Scale. Moving Edit Mode components changes their coordinates but does not move the object's origin. Pivot and transform orientation are independent state. [Move](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/move.html), [Rotate](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/rotate.html), [Scale](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/scale.html), [pivot points](https://docs.blender.org/manual/en/latest/editors/3dview/controls/pivot_point/index.html)

The first implementation now hides transform arrows while the Select tool is active and uses a smaller Move-only overlay. The complete compact, screen-size-stable transform overlay should add:

- Thin X/Y/Z stems, small terminal handles, two-axis plane squares, and a small neutral center/view-plane handle.
- The gizmo appears only when components are selected and never visually dominates the mesh.
- The constrained axis brightens during a command; the other axes fade.
- A small value readout near the pivot or contextual HUD shows live distance/angle/scale and typed input.
- `G`/`R`/`S` and pointer-drag gizmos invoke the same pure transform command and preview transaction.

This is a visual replacement, not a second transform implementation.

### Axis constraints, numeric input, and modal lifecycle

During Move/Rotate/Scale and extrusion, `X`, `Y`, or `Z` constrain to one axis; `Shift-X/Y/Z` constrain Move/Scale to the other two axes. Repeating an axis key cycles orientation spaces and then clears the constraint, while the constrained axis is shown brighter. [Blender axis locking](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/axis_locking.html)

Typing during a modal transform supplies an exact value. Blender displays the value in the viewport footer and supports decimal, negative, reciprocal, per-axis, unit, and expression input. The essential v1 subset is signed decimal values with the project unit system; multi-axis and expressions can follow. [Blender numeric input](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/numeric_input.html)

Ordinary modal transforms preview continuously, confirm with click/Return, and cancel back to their original state with right-click/Escape. After confirmation, Adjust Last Operation (`F9`) can reparameterize the result; a new edit after undo truncates redo history. [Blender operators](https://docs.blender.org/manual/en/latest/interface/operators.html), [Undo & Redo](https://docs.blender.org/manual/en/latest/interface/undo_redo.html)

The implementation rule is: every preview recomputes from an immutable pre-operation topology and parameter object. Pointer movement must never compound the prior preview.

### Snapping

Blender separates the **snap base** being moved (Closest, Center/pivot, Median, Active) from the **snap target** (increment/grid, vertex, edge, face, volume, edge center, edge perpendicular, and others). Increment snapping is relative to the starting position unless absolute grid snap is enabled. Face Project and Face Nearest can move vertices individually rather than transform the selection rigidly. [Blender snapping](https://docs.blender.org/manual/en/latest/editors/3dview/controls/snapping.html)

Pascal should copy this separation without copying Blender's modifier map. The repository already defines visible per-context snap modes, Shift-to-cycle, Ctrl-to-cycle grid step, and Alt force/free. Mesh commands must resolve through that path. Add component targets and snap-base policies behind the same mode UI rather than reading new hidden modifiers. [Pascal interaction scope](architecture/interaction-scope.md), [Pascal tools](architecture/tools.md)

### Proportional editing

Proportional Editing affects nearby unselected vertices with a falloff while a selected transform runs. Wheel/PageUp/PageDown adjusts the influence radius live. Connected Only measures distance through topology rather than Euclidean space; Projected from View ignores depth. [Blender proportional editing](https://docs.blender.org/manual/en/latest/editors/3dview/controls/proportional_editing.html)

This belongs in the shared transform engine as vertex weights and a radius overlay. It is not a brush and does not change topology.

## Operator behavior and Pascal implications

### Extrude Region and Individual Faces

Extrude duplicates selected geometry while keeping it connected. Region extrusion identifies the selection boundary, creates side faces only there, and moves the selected interior patch unchanged; faces initially move along their average normal and can be axis-constrained. Closed and open selections have different connectivity behavior. [Blender Extrude Region](https://docs.blender.org/manual/en/latest/modeling/meshes/tools/extrude_region.html)

Individual Faces extrudes each face separately rather than treating connected faces as one region. [Blender Extrude Individual Faces](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/extrude_individual_faces.html)

The current `extrude-face` command is a good Push/Pull seed, but the target needs:

- `extrude-region` over vertex/edge/face selections, with connected-region boundary extraction.
- `extrude-individual-faces` with separate caps and side walls.
- A modal distance preview using average/individual normals, axis constraints, typed input, and snapping.
- Selection/remapping that selects new caps and preserves surviving IDs.

Blender has a hazardous quirk where cancelling the movement portion of some face extrusions can leave coincident new topology. [Blender Extrude Faces](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/extrude_faces.html) Pascal should deliberately diverge: Escape cancels the entire uncommitted extrusion, matching the repository's preview/cancel convention and avoiding invisible duplicate faces.

### Inset Faces

Inset creates border faces around selected patches; pointer distance controls thickness, Ctrl adjusts depth, and the command can switch between connected regions and individual faces. Boundary, even/relative offset, edge rail, outset, selection side, and attribute interpolation alter topology or output data. Confirm applies the result; right-click/Escape cancels it. [Blender Inset Faces](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/inset_faces.html)

Pascal should first support planar connected face patches, thickness, optional depth, even offset, and outset. Each disconnected selected patch is a separate inset region inside one command. Preview must rebuild from the pre-inset snapshot whenever any parameter changes.

### Bevel

Bevel is a modal topology operator. Pointer movement controls width, Wheel controls segments, typed input is supported, Shift gives fine control, and options change width interpretation, edge/vertex affect, profile, overlap clamping, loop slide, miters, intersections, materials, and normals. Click/Return confirms; right-click/Escape cancels. [Blender Bevel](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/bevel.html)

For Pascal, v1 edge bevel should require exactly two incident faces, support width, segments, profile, and clamp overlap, and reject unsupported non-manifold junctions explicitly. It is an adjacency-driven topology command, not screen-space line thickening.

### Loop Cut and Slide

Loop Cut is explicitly two-stage. Hovering a perpendicular edge previews a yellow topology-derived loop; first click chooses the loop, then pointer movement slides the new loop. Right-click in stage one aborts, but right-click in stage two **commits a centered cut**. Wheel or typed input changes cut count; Even, Flipped, Clamp, smoothing, and UV correction remain parameters. [Blender Loop Cut and Slide](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/loopcut_slide.html)

Pascal needs quad-loop traversal and a staged modal state. It cannot substitute an arbitrary world plane cut. Loop/ring selection should land first because it proves the required adjacency traversal and pole/branch termination.

### Subdivide

Subdivide applies immediately to selected edges/faces, then exposes Number of Cuts, smoothing, n-gon policy, quad-corner pattern, and optional displacement in Adjust Last Operation. Results depend on the selected edge pattern and incident triangle/quad/n-gon topology; subdividing an n-gon's boundary does not necessarily split its face. [Blender Subdivide](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/subdivide.html)

Pascal needs deterministic pattern handlers and a replayable command record. A simple “split every face into four” implementation would not match Blender's selection semantics.

### Merge

Merge supports Center, Cursor, First, Last, per-connected-island Collapse, and By Distance. First/Last depends on selection order, while Collapse requires connected-component grouping. By Distance adds a threshold and optional unselected participation. [Blender Merge](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/merge.html)

The command result must choose survivors, resolve positions/attributes, remove degenerate edges/faces, and return a complete remap from removed IDs to survivors. This is why active element and selection order must precede Merge.

### Delete and Dissolve

Delete exposes explicit vertex, edge, face, only-edge-and-face, and only-face variants with different dependent-topology cleanup. Dissolve preserves the surrounding surface: vertex dissolve joins surrounding faces, edge dissolve requires exactly two neighboring faces, face dissolve merges connected patches, and Limited Dissolve removes sufficiently flat detail under an angle threshold. [Blender Deleting & Dissolving](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/delete.html)

Pascal should not expose one ambiguous `deleteSelected()` command. The UI may default based on component mode, but the pure command must encode the exact delete/dissolve variant and return removed/surviving selection mappings.

### Knife

Knife changes the cursor, lets successive clicks or a drag define visible cut paths, previews yellow segments and aqua points, supports multiple paths, measurements, midpoint/geometry snapping, angle/axis constraints, selected-only and visible-only/cut-through policies, internal segment undo, and one final apply or cancel. It is view-dependent and commits the resulting edge chains atomically. [Blender Knife Topology Tool](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/knife_topology_tool.html)

Pascal therefore needs a screen-space overlay plus a geometry kernel: raycast the path to faces, sort crossings, split edges/faces, reject unrepresentable paths, and commit once. Knife should come after stable picking, face splitting, adjacency, and command-local undo exist.

## Target Pascal architecture

### Persistent topology, not render triangles

The serialized node should remain one scene node with internal components. Vertices/edges/faces must not become scene nodes. The existing schema is a sound starting point, but a runtime adjacency index should be derived once per topology revision:

- Vertex → incident edges/faces.
- Edge → endpoint vertices and ordered incident faces.
- Face → ordered boundary edges/vertices.
- Connected components, boundary edges, and loop/ring traversal helpers.

Future face-corner records must carry UVs, split normals, and other per-corner attributes. Blender's editable BMesh is connectivity-aware, provides split/collapse/dissolve operators and custom-data layers, and explicitly refreshes tessellation after destructive edits. [Blender BMesh API](https://docs.blender.org/api/current/bmesh.html), [BMesh operators](https://docs.blender.org/api/current/bmesh.ops.html)

`BufferGeometry`, triangle ranges, normals, UVs, bounds, and floor-plan projection are derived caches. Never infer authoritative edges or persistent face identity back from triangulated render positions.

### Topology invariants and remapping

Keep the current checks and add, in dependency order:

1. Finite coordinates; distinct face-loop entries; nonzero edge length; no duplicate face boundary.
2. Nonzero-area, planar, simple face loops and deterministic triangulation success.
3. Consistent winding across shared edges and explicit normal direction.
4. Explicit manifold policy: whether loose vertices/edges and edges with 0, 1, 2, or more incident faces are supported by each command.
5. Attribute validity and interpolation once face-corner data exists.

Blender documents corresponding editable-mesh invariants: selected edges imply endpoint selection, selected faces imply their edges/vertices, hidden elements are unselected, duplicate edges/faces are invalid, and faces have at least three vertices. [Blender BMesh state](https://docs.blender.org/api/current/bmesh.html)

Every command result should include more than `topology` and one selection:

```ts
type MeshCommandResult = {
  topology: BlockTopology;
  selection: MeshComponentSelection;
  active: MeshComponentRef | null;
  remap: {
    retained: ReadonlySet<string>;
    created: ReadonlySet<string>;
    removed: ReadonlySet<string>;
    replacedBy: ReadonlyMap<string, string | readonly string[]>;
  };
  warnings: readonly MeshCommandWarning[];
};
```

The shape is illustrative. The contract matters: operators must report identity changes so selection, host references, material assignments, and future measurements can follow edits deterministically.

### Session and modal state

Move the current local React state into a dedicated editor-owned session controlled through semantic methods, not independent setters:

```ts
type MeshEditSession = {
  nodeId: BlockNodeId;
  enabledModes: ReadonlySet<"vertex" | "edge" | "face">;
  selected: {
    vertices: ReadonlySet<string>;
    edges: ReadonlySet<string>;
    faces: ReadonlySet<string>;
  };
  active: MeshComponentRef | null;
  selectionOrder: readonly MeshComponentRef[];
  xray: boolean;
  pivot: MeshPivotMode;
  orientation: MeshTransformOrientation;
  proportional: MeshProportionalSettings;
  operation: MeshModalOperation | null;
};
```

The existing global editor `Mode` already contains `'edit'` for property-boundary editing, so it cannot silently become mesh Edit Mode. The current `drafting/block-edit` scope also misnames a persistent editing session.

Recommended seam:

- `useMeshEditSession` owns the detailed session and immutable operation snapshot.
- Add an explicit `mesh-editing` summary to `InteractionScope` with `nodeId`, `phase` (`selecting` or `operating`), operator, and stage. This keeps selection gating, hot-set, overlays, HUD, and Escape routing on the interaction spine without putting large topology snapshots into it.
- One controller owns enter, switch mode, select, begin operation, preview, confirm, cancel, and exit so the stores cannot drift.
- Viewer selection retains the block node; component selection remains editor-only. `packages/viewer` stays unaware of Edit Mode. [Viewer isolation](architecture/viewer-isolation.md), [selection managers](architecture/selection-managers.md), [interaction scope](architecture/interaction-scope.md)

### Pure command and modal interfaces

Extend the existing pure `applyBlockCommand` model instead of embedding algorithms in `selection.tsx`:

```ts
type MeshCommand<P> = {
  kind: string;
  execute(input: {
    topology: BlockTopology;
    selection: MeshComponentSelection;
    active: MeshComponentRef | null;
    parameters: P;
  }): MeshCommandResult;
};

type MeshModalOperation<P> = {
  command: MeshCommand<P>;
  baseTopology: BlockTopology;
  baseSelection: MeshComponentSelection;
  baseActive: MeshComponentRef | null;
  parameters: P;
  constraint: MeshTransformConstraint;
  typedInput: string;
  stage: string;
};
```

Commands remain pure, deterministic, Three-free, React-free, and store-free. Gizmos, `G/R/S`, toolbar actions, numeric input, and future touch controls only translate user input into parameters. Each preview calls `execute` against `baseTopology`; it never uses the prior preview as input.

### Preview, confirm, cancel, history, and redo

Use the current axis-drag and PolygonEditor pattern for every operator:

1. `begin`: capture immutable topology/selection/active state and enter the operation scope.
2. `preview`: execute from that snapshot, publish `{ topology }` through `useLiveNodeOverrides`, update component overlays, and `markDirty`; do not call `useScene.updateNode`.
3. `confirm`: validate, clear the override, perform one `updateNode`, apply the returned selection/remap, and return to mesh-selection phase.
4. `cancel`: clear the override and return to the exact pre-operation topology/selection without history.
5. `unmount/blur/tool switch`: run the same cancellation path.

For Adjust Last Operation, retain `{ baseTopology, baseSelection, commandKind, parameters }` after commit. Parameter changes re-execute from the base and replace the last semantic history entry rather than append incremental edits. This requires explicit history integration and should not be faked with repeated `updateNode` calls. Blender exposes equivalent post-operation parameter editing through the lower-left panel and `F9`. [Blender Undo & Redo](https://docs.blender.org/manual/en/latest/interface/undo_redo.html)

### Package seams

| Concern                                                                      | Home                                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Serialized schema, validation shared by every consumer, migrations           | `packages/core/src/schema/nodes/block.ts`                                                                                |
| Kind-specific pure adjacency and command kernel                              | `packages/nodes/src/block/`, kept independent of React/stores/Three                                                      |
| Derived Three.js geometry and triangle-to-face metadata                      | `packages/nodes/src/block/geometry.ts` through `def.geometry`                                                            |
| Kind-owned selection/edit contribution                                       | `packages/nodes/src/block/selection.tsx`, progressively reduced to composition over shared editor controllers/components |
| Reusable mesh-edit session, modal input, compact gizmo, numeric HUD, picking | `packages/editor`, injected into Viewer as editor-only children/contributions                                                  |
| Read-only rendering/scene registration                                       | Existing generic viewer path; no edit-mode state in `packages/viewer`                                                          |

This follows the registry composition model and viewer isolation. [Node definitions](architecture/node-definitions.md), [viewer isolation](architecture/viewer-isolation.md), [Three.js layers](architecture/layers.md)

## Phased delivery plan

### Phase 0 — stabilize the existing slice

- Keep the current schema, placement, box, derived geometry, materials, floor-plan footprint, translation command, extrusion command, and one-undo axis preview.
- Add the missing topology degeneracy checks and command remap contract before adding more destructive operations.
- Add save/reload, duplicate/delete, floor-plan live-update, cancel/unmount, and history tests.
- Set an initial interactive budget, for example representative fixtures at 100, 1,000, and 10,000 components, and measure validation, triangulation, rebuild, and picking.

**Exit criteria:** current features survive reload and undo/redo; invalid topology never reaches rendering; repeated preview/cancel leaves no override or history entry.

### Phase 1 — Blender-like Edit Mode shell and selection

- Introduce the persistent mesh edit session and explicit interaction-scope summary.
- Support Edit button and Tab entry/exit, with modal Escape precedence.
- Replace always-visible spheres/cylinders with screen-stable Blender-like point/line/face overlays, selected orange and active white.
- Replace the large arrow trio with the compact transform overlay described above.
- Add active element, selection order, topology-aware `1`/`2`/`3` conversion, Shift mixed modes, Select All/None/Invert, box select, and X-Ray.
- Route picking through face-range metadata plus screen-space vertex/edge hit testing; keep editor visuals on `EDITOR_LAYER`.

**Exit criteria:** component selection is stable across camera angles and render rebuilds; occluded components cannot be picked unless X-Ray is on; active and selected visuals are unambiguous; entering/exiting never changes topology.

### Phase 2 — shared transform grammar

- Add one Move/Rotate/Scale engine invoked by compact gizmo and `G/R/S`.
- Add free/view-plane movement, axis and plane constraints, local/global/normal orientations, median and active pivots, signed decimal/unit input, confirm/cancel, and visible values.
- Integrate Pascal snap modes with component targets and explicit snap-base selection.
- Keep one live override and one history commit per gesture.

**Exit criteria:** equivalent gizmo and keyboard inputs produce byte-identical topology; numeric and pointer previews recompute from the same snapshot; cancel restores exact coordinates and selection.

### Phase 3 — architectural Push/Pull, region extrusion, and inset

- Convert the current immediate single-face extrusion into the modal engine.
- Add multi-face Extrude Region, Individual Faces, normal and axis constraints, exact distance, repeated cap extrusion, and full Escape rollback.
- Add planar region Inset with thickness, depth, outset, even offset, and disconnected patches.
- Preserve material slots and define interpolation for all created faces/components.

**Exit criteria:** the video's measured face Push/Pull flow works without a large arrow; connected regions have no internal duplicate side walls; repeated extrusion keeps stable IDs and valid winding.

### Phase 4 — cleanup and resolution operators

- Add explicit Delete variants, Dissolve Vertex/Edge/Face, Merge Center/First/Last/Collapse/By Distance, and Subdivide pattern cases.
- Add selection remap, connected-component utilities, n-gon tests, and last-operator replay for Subdivide parameters.
- Define command-by-command behavior for boundaries and non-manifold inputs.

**Exit criteria:** every removed component is represented in remap output; no dangling selection remains; delete and dissolve visibly differ; merge/subdivide replay deterministically.

### Phase 5 — bevel, loops, and knife

- Add loop/ring traversal and selection first.
- Add edge/vertex Bevel with width, segments, profile, and clamp overlap.
- Add staged Loop Cut & Slide with topology hover preview, cut count, centered right-click commit, and slide.
- Add Knife screen overlay, snapping/constraints, command-local undo, face/edge splitting, and one atomic commit.

**Exit criteria:** traversal stops predictably at unsupported junctions; bevel rejects or handles degeneracy without corrupting topology; Knife cancel is history-free and confirmed paths survive validation/triangulation.

### Phase 6 — proportional editing, attributes, and operator redo

- Add proportional falloffs, live radius, Connected Only graph distance, and Projected from View to the shared transform engine.
- Add face-corner UVs, custom/split normals, attribute interpolation, normal flip/recalculate, and material preservation across every operator.
- Add a real Adjust Last Operation surface and deterministic replacement of the most recent command.
- Revisit multi-object Edit Mode only after single-node semantics and performance are proven.

## Test strategy

### Pure topology tests

- Table-driven fixtures for triangle, quad, concave n-gon, disconnected patches, boundaries, holes when supported, and non-manifold junctions.
- Invariant checks after every command and randomized command sequences.
- Stable-ID/remap assertions: retained IDs stay retained, created IDs never collide, removed IDs never remain selected, replacement maps resolve.
- Determinism: same base topology + selection + parameters produces structurally identical output.
- Attribute/winding/normal assertions as those layers land.

### Transaction and state tests

- Enter/select/begin/preview/confirm/cancel/exit transition tests for the mesh session controller and interaction scope.
- Assert pointer-rate preview performs zero scene writes; confirm performs exactly one; cancel performs zero and clears overrides.
- Undo/redo restores topology, component selection policy, materials, and redo truncation correctly.
- Adjust Last Operation re-executes from its original base instead of compounding the prior result.

### Rendering and picking tests

- Triangle-to-face mapping for convex and concave faces.
- Depth-tested versus X-Ray picking, face-center targets, screen-space tolerances, and camera-scale stability.
- Geometry/floor-plan parity after live and committed edits.
- Visual regression captures for vertex/edge/face, hovered/selected/active, constrained axes, numeric HUD, proportional radius, loop preview, and knife paths.

### End-to-end acceptance tests

- Place a block, Tab into Edit Mode, select a face, `G Z 1.5`, confirm, undo, redo, and exit.
- Push/Pull a face to an exact height, cancel a second extrusion with no duplicate topology, then repeat and commit.
- Select through with X-Ray, switch component modes with topology-aware preservation, and merge at active/last.
- Inset, bevel, loop cut, dissolve, subdivide, and knife representative meshes as their phases land.
- Blur, Escape, selection changes, route changes, and unmount never strand interaction scope, cursor state, or live overrides.

## Risks and decisions

1. **Scope:** “exactly like Blender” is open-ended. Promise the documented phase behaviors, not the full mature Blender surface.
2. **Topology degeneracy:** Inset, bevel, dissolve, n-gon triangulation, and knife have hard numerical cases. Unsupported inputs must fail visibly and atomically.
3. **Performance:** `geometryKey` currently serializes full topology and previews rebuild the full mesh. Benchmark before raising mesh-size promises; coordinate-only preview may later update buffers incrementally while retaining one canonical preview state.
4. **Picking:** Always-on overlay hit volumes become noisy on dense meshes. Screen-space acceleration and depth policy are required, not optional polish.
5. **State:** The current local session can disappear on remount. Centralizing it must not create a second interaction truth beside `useInteractionScope`.
6. **2D/3D parity:** Mesh component editing can be an explicit 3D-only exception because depth, normals, and view-projected cuts are essential. The floor plan must still update live/committed projection; any future 2D component editor must share commands and snapping. [Pascal 2D/3D parity](architecture/tools.md)
7. **Licensing:** Blender is GPL-licensed. Its behavior and manuals can guide an independent implementation, but copying Blender source into this MIT repository requires license review. [Blender license](https://developer.blender.org/docs/license/)
