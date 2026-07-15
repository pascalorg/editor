# Measurements

*Persistent generic measurement annotations, semantic feature associations, and the shared 2D/3D drafting contract.*

Applies to: `packages/core/src/{lib/measurement-geometry.ts,schema/nodes/measurement.ts,registry/types.ts}`, `packages/nodes/src/{measurement/**,wall/measurement.ts,roof-segment/measurement.ts,shared/polygon-measurement.ts}`, `packages/editor/src/{store/use-measurement-draft.ts,components/editor-2d/floorplan-measurement-tool-layer.tsx}`.

Measurements are regular level children. Their geometry is resolved in level-local SI metres, while rendering and formatting are derived from live viewer preferences. Draft previews stay transient and a completed measurement enters scene history through one `createNode` call.

## Persistent data

`MeasurementNode.measurement` is a discriminated payload:

- `distance`: exactly two finite 3D anchors.
- `angle`: three anchors, with the middle anchor as the vertex.
- `area`: a planar polygon with at least three finite 3D points.
- `perimeter`: the closed length of a planar polygon with at least three anchors.
- `volume`: the same planar base plus a finite extrusion vector with a non-zero component along the base normal.

An anchor is either a free point tuple or `{ kind: 'feature', reference, fallback }`. The reference contains a scene node ID, a node-kind-owned semantic feature ID, and optional finite/string/boolean parameters such as normalized path position `t` and wall height. The fallback is not a cached value: it is the explicit detach/dangling presentation point used only when the reference cannot resolve.

Area is winding-independent. Volume is `abs(dot(areaVector, extrusion))`, so a valid oblique prism uses only the extrusion component normal to its base. Keep these calculations in `@pascal-app/core`; renderers and panels must not reimplement them.

Measurement nodes must remain in `AnyNode`, `LevelNode.children`, the built-in node registry, and hosted graph validation together. They are selectable, deletable, and duplicable, but `bake: strip` keeps analysis annotations out of baked model output.

## Semantic features and associativity

`NodeDefinition.measurement` is the generic extension point. It may expose:

- `features(node, ctx)` to enumerate stable, labelled tuple geometry for snapping and previews;
- `resolve(node, ctx, reference)` when a stored parameter changes how the feature is reconstructed;
- `match(node, ctx, point, maxDistance)` when the node kind knows more than a generic nearest-segment search, such as choosing the wall face nearest a surface hit.

These functions are pure and receive the same read-only `GeometryContext` used by registered geometry. They must not import Three.js, editor state, or `useScene`. Feature IDs describe semantic roles (`wall:face:left`, `wall:height`, `roof:ridge:0`); labels never act as identifiers.

The wall contribution samples the existing curved-wall centerline and resolves face hits with normalized `t` plus clamped height. The roof-segment contribution reuses `getRoofSegmentPlanLinework` and the existing roof surface-height calculation, then applies segment and parent-roof transforms. Slab, ceiling, zone, and site use one shared polygon contribution with stable `boundary` and `center` roles; continuous boundary anchors store normalized perimeter position rather than vertex indexes. Do not duplicate any of those topology implementations in measurement code.

`resolveMeasurementNode` derives current free-point geometry from the scene snapshot. Renderers subscribe to referenced nodes, their parents, and ephemeral node overrides; the floor-plan cache uses `def.floorplanDependencies` and the same override-merged resolver. A host edit therefore changes measurement geometry and value during the drag and after commit without writing the measurement node or adding history entries.

If the node kind or feature is missing, resolution uses the stored fallback and reports a dangling reference. Both renderers show the annotation in red with an `Unlinked` label, and the inspector offers an explicit detach action that converts the resolved/fallback geometry to free points. Deleting a host never silently deletes or freezes a measurement.

All scene clone paths remap feature node IDs when the referenced host is part of the same clone ID map. References to hosts outside the duplicated selection remain external. Any new duplication path must call the same pure remapper.

## Draft ownership and frames

`useMeasurementDraft` is the only transient draft store. The first committed point captures both an owner (`2d` or `3d`) and the selected level ID. Until commit or cancel:

- only the owner may add, close, or extrude the draft;
- either view may present the same draft while its selected level still matches;
- a level mismatch suppresses previews and resets the draft;
- commit rechecks the captured level and creates the node under that level only.

All stored draft points, hover points, normals, and guides use the captured level's local frame. A preview may transform those values for display, but must never reinterpret them in the live selected level's frame.

Pointer-move updates stay in `useMeasurementDraft`; they never write `useScene`. Completion calls `commitMeasurementDraft`, which parses one `MeasurementNode` and performs one undoable scene write.

Draft vertex editing uses the same rule. A pointer gesture captures an indexed point and its optional feature anchor, replaces both while dragging, and either retains or restores them on release/cancel. The gesture stays inside the measurement `drafting` scope and never writes scene history. A dragged polygon vertex uses both adjacent vertices as possible axis anchors.

Once a polygon has three points, each closed edge exposes a smaller midpoint handle. Crossing the normal drag threshold inserts that midpoint and immediately turns it into the active vertex; cancel removes the transient insertion, while release retains it. A click without drag is a no-op. The active vertex and its two connected edges receive stronger feedback, matching slab and ceiling polygon editing without importing their horizontal XZ geometry assumptions.

## Picking and snapping

The registered 3D tool raycasts visible geometry under registered scene roots and converts the winning world-space point and normal into the active level frame. A system-rendered mesh outside those roots must opt in with `userData.measurementSurface = true`; this is the contract used by collective instanced plant meshes. An editor-helper root nested under registered geometry must opt out with `userData.measurementSurface = false`, which is inherited by its descendants. Measurement activation clears object selection, and measurement/guide/scan nodes, invisible objects, zero-opacity or non-depth-tested materials, and `colorWrite: false` colliders are excluded. Instanced hits must include the intersected instance matrix when their normals are transformed.

Axis assistance starts from the previous vertex. X, Y, or Z becomes a snap only when the projected candidate is verified on the hit surface within the screen-space threshold. Otherwise the raw surface hit remains authoritative and the nearest axis is shown as a passive guide. A magnetic lock enters at 12 screen pixels and retains the same axis and anchor until 18 pixels; it must release immediately if that candidate no longer verifies on the surface.

Measurements also treat the active level's structural alignment anchors as proximity axes. In 3D this assistance is limited to near-horizontal hit surfaces and every acquired X/Z projection is recast onto the original surface before it can move the point. In both views a nearby scene axis may be advertised up to 32 screen pixels away, becomes magnetic at the ordinary 12-pixel acquisition threshold, and retains the exact source anchor through the 18-pixel release threshold. Keep this state in the measurement draft until the shared alignment-guide store has owner-aware sessions; publishing ownerless global guides would let the inactive pane overwrite the active measurement.

The 2D layer reads registered floor-plan SVG geometry and the same structural alignment anchors used by placement tools. It gives vertices priority over edges, bounds element and segment collection, de-duplicates proximity anchors in plan space, and applies X/Z assistance in plan space. Both views use the same draft transitions and commit path.

After ordinary surface/plan snapping, the winning registered node may refine the hit through `NodeDefinition.measurement.match`. A successful match stores the semantic feature anchor and uses its resolved point; unsupported nodes retain the ordinary free point. This keeps generic picking available to every rendered node without pretending that unstable mesh triangles are persistent topology.

When a semantic feature is under the pointer, both drafting views distinguish the reticle and show the feature label plus its intrinsic path length when applicable. This is presentation only: clicking still creates an ordinary persistent measurement anchor, and unsupported surfaces keep the same free-point workflow.

## Rendering and visibility

The persistent 3D renderer combines three visibility sources:

1. `MeasurementNode.visible` for a single annotation.
2. `useViewer.showMeasurements` for the project display preference.
3. Three.js ancestor visibility for level, building, and site presentation.

The ancestor check must also control the Drei `Html` value label because DOM portals do not inherit Three.js visibility. The 2D floor-plan definition applies the node and global flags before emitting semantic geometry.

Persistent 3D fills, strokes, and endpoints render on `OVERLAY_LAYER`. Keep them out of the scene depth/diffuse/normal MRT: area and volume fills are double-sided arbitrary-plane annotations, and a double-sided NodeMaterial in that MRT can invalidate the WebGPU render pipeline. The overlay camera layer remains raycastable, so this separation does not remove node selection.

Persistent and draft labels read `useViewer.unit` at render time. Node JSON always remains in metres; unit changes must not mutate scene data or create history entries.

Labels use a restrained hierarchy: distance shows one value offset from its segment; angle shows a degree value at its vertex; area, perimeter, and volume use `A`, `P`, and `V` aggregate labels at a triangulated interior anchor so concave polygons keep the label inside the fill. During polygon placement or vertex editing, at most one secondary pill reports the active edge length. The volume extrusion control owns both `H` and live `V` while it is open, so a duplicate aggregate label does not sit underneath it. Three-dimensional labels stay constant in screen size; two-dimensional aggregate labels explicitly counter-rotate the scene and remain horizontal.

Draft strokes use finite, non-indexed `BufferGeometry` with WebGPU node line materials. Do not use Drei's wide `Line` helper here: it creates WebGL `LineMaterial` and instanced geometry that the WebGPU post-processing pass cannot render.

The 3D hover reticle is a screen-sized, double-sided ring oriented to the resolved surface normal. Its short RGB axes stay in the level measurement frame, while a neutral stem communicates the surface normal. After the first point, full X/Y/Z guides pass through the active anchor; 2D mirrors this with an upright reticle and X/Z guides. Locked guides and reticles use the acquired axis color, while passive guides remain dashed and subdued. A scene-proximity guide uses a white halo beneath the axis color, an `Align X/Y/Z` label, and, in 2D, a source beacon so the relationship remains legible over dense geometry.

## Interaction completion

- Distance commits after point two.
- Angle commits after point three.
- Area and perimeter close from the first-point gesture, double-click, or Enter.
- Volume closes the base first, then commits an explicit signed extrusion along the base normal.
- Before closure, pressing and dragging an existing draft point repositions it through the same valid-surface and magnetic-snap path; tapping the first point still closes, while tapping another point is a no-op.
- Dragging an edge midpoint inserts a new point and continues the same surface-snapped gesture; cancel restores the original ring.
- Backspace removes the latest base point and reopens a closed base.
- Escape attempts the same validated completion as Enter. A valid area or perimeter commits, and a ready volume commits after extrusion; the draft resets while preserving its kind so the tool remains armed for another measurement. For volume, the first Escape after a valid base advances to extrusion. An incomplete draft is cleared without creating a node, and Escape is still consumed so measurement mode remains active.

Keep action-bar kind selection, the `M` shortcut, shortcut help, scene-tree presentation, inspector values, and Display visibility controls wired whenever the measurement kind is extended.
