# Measurements

*Persistent distance, area, and prism-volume data plus the shared 2D/3D drafting contract.*

Applies to: `packages/core/src/{lib/measurement-geometry.ts,schema/nodes/measurement.ts}`, `packages/nodes/src/measurement/**`, `packages/editor/src/{store/use-measurement-draft.ts,components/editor-2d/floorplan-measurement-tool-layer.tsx}`.

Measurements are regular level children. Their geometry is stored in level-local SI metres, while rendering and formatting are derived from live viewer preferences. Draft previews stay transient and a completed measurement enters scene history through one `createNode` call.

## Persistent data

`MeasurementNode.measurement` is a discriminated payload:

- `distance`: exactly two finite 3D points.
- `area`: a planar polygon with at least three finite 3D points.
- `volume`: the same planar base plus a finite extrusion vector with a non-zero component along the base normal.

Area is winding-independent. Volume is `abs(dot(areaVector, extrusion))`, so a valid oblique prism uses only the extrusion component normal to its base. Keep these calculations in `@pascal-app/core`; renderers and panels must not reimplement them.

Measurement nodes must remain in `AnyNode`, `LevelNode.children`, the built-in node registry, and hosted graph validation together. They are selectable, deletable, and duplicable, but `bake: strip` keeps analysis annotations out of baked model output.

## Draft ownership and frames

`useMeasurementDraft` is the only transient draft store. The first committed point captures both an owner (`2d` or `3d`) and the selected level ID. Until commit or cancel:

- only the owner may add, close, or extrude the draft;
- either view may present the same draft while its selected level still matches;
- a level mismatch suppresses previews and resets the draft;
- commit rechecks the captured level and creates the node under that level only.

All stored draft points, hover points, normals, and guides use the captured level's local frame. A preview may transform those values for display, but must never reinterpret them in the live selected level's frame.

Pointer-move updates stay in `useMeasurementDraft`; they never write `useScene`. Completion calls `commitMeasurementDraft`, which parses one `MeasurementNode` and performs one undoable scene write.

Draft vertex editing uses the same rule. A pointer gesture captures an indexed point and its original tuple, replaces only that tuple while dragging, and either retains or restores it on release/cancel. The gesture stays inside the measurement `drafting` scope and never writes scene history. A dragged polygon vertex uses both adjacent vertices as possible axis anchors.

Once a polygon has three points, each closed edge exposes a smaller midpoint handle. Crossing the normal drag threshold inserts that midpoint and immediately turns it into the active vertex; cancel removes the transient insertion, while release retains it. A click without drag is a no-op. The active vertex and its two connected edges receive stronger feedback, matching slab and ceiling polygon editing without importing their horizontal XZ geometry assumptions.

## Picking and snapping

The registered 3D tool raycasts visible geometry under registered scene roots and converts the winning world-space point and normal into the active level frame. A system-rendered mesh outside those roots must opt in with `userData.measurementSurface = true`; this is the contract used by collective instanced plant meshes. An editor-helper root nested under registered geometry must opt out with `userData.measurementSurface = false`, which is inherited by its descendants. Measurement activation clears object selection, and measurement/guide/scan nodes, invisible objects, zero-opacity or non-depth-tested materials, and `colorWrite: false` colliders are excluded. Instanced hits must include the intersected instance matrix when their normals are transformed.

Axis assistance starts from the previous vertex. X, Y, or Z becomes a snap only when the projected candidate is verified on the hit surface within the screen-space threshold. Otherwise the raw surface hit remains authoritative and the nearest axis is shown as a passive guide. A magnetic lock enters at 12 screen pixels and retains the same axis and anchor until 18 pixels; it must release immediately if that candidate no longer verifies on the surface.

The 2D layer reads registered floor-plan SVG geometry. It gives vertices priority over edges, bounds element and segment collection, and applies X/Z assistance in plan space. Both views use the same draft transitions and commit path.

## Rendering and visibility

The persistent 3D renderer combines three visibility sources:

1. `MeasurementNode.visible` for a single annotation.
2. `useViewer.showMeasurements` for the project display preference.
3. Three.js ancestor visibility for level, building, and site presentation.

The ancestor check must also control the Drei `Html` value label because DOM portals do not inherit Three.js visibility. The 2D floor-plan definition applies the node and global flags before emitting semantic geometry.

Persistent 3D fills, strokes, and endpoints render on `OVERLAY_LAYER`. Keep them out of the scene depth/diffuse/normal MRT: area and volume fills are double-sided arbitrary-plane annotations, and a double-sided NodeMaterial in that MRT can invalidate the WebGPU render pipeline. The overlay camera layer remains raycastable, so this separation does not remove node selection.

Persistent and draft labels read `useViewer.unit` at render time. Node JSON always remains in metres; unit changes must not mutate scene data or create history entries.

Labels use a restrained hierarchy: distance shows one value offset from its segment; area and volume use `A` and `V` aggregate pills at a triangulated interior anchor so concave polygons keep the label inside the fill. During polygon placement or vertex editing, at most one secondary pill reports the active edge length. The volume extrusion control owns both `H` and live `V` while it is open, so a duplicate aggregate label does not sit underneath it. Three-dimensional labels stay constant in screen size; two-dimensional aggregate labels explicitly counter-rotate the scene and remain horizontal.

Draft strokes use finite, non-indexed `BufferGeometry` with WebGPU node line materials. Do not use Drei's wide `Line` helper here: it creates WebGL `LineMaterial` and instanced geometry that the WebGPU post-processing pass cannot render.

The 3D hover reticle is a screen-sized, double-sided ring oriented to the resolved surface normal. Its short RGB axes stay in the level measurement frame, while a neutral stem communicates the surface normal. After the first point, full X/Y/Z guides pass through the active anchor; 2D mirrors this with an upright reticle and X/Z guides. Locked guides and reticles use the acquired axis color, while passive guides remain dashed and subdued.

## Interaction completion

- Distance commits after point two.
- Area closes from the first-point gesture, double-click, or Enter.
- Volume closes the base first, then commits an explicit signed extrusion along the base normal.
- Before closure, pressing and dragging an existing draft point repositions it through the same valid-surface and magnetic-snap path; tapping the first point still closes, while tapping another point is a no-op.
- Dragging an edge midpoint inserts a new point and continues the same surface-snapped gesture; cancel restores the original ring.
- Backspace removes the latest base point and reopens a closed base.
- Escape clears the draft through the shared drafting interaction scope.

Keep action-bar kind selection, the `M` shortcut, shortcut help, scene-tree presentation, inspector values, and Display visibility controls wired whenever the measurement kind is extended.
