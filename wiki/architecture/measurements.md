# Measurements

*Persistent generic measurement annotations, semantic feature associations, and the shared 2D/3D drafting contract.*

Applies to: `packages/core/src/{lib/measurement-geometry.ts,lib/zone-quantities.ts,schema/nodes/measurement.ts,registry/types.ts}`, `packages/nodes/src/{measurement/**,wall/measurement.ts,roof-segment/measurement.ts,shared/polygon-measurement.ts,shared/quick-measurement.ts,zone/quantities-panel.tsx}`, `packages/editor/src/{store/use-measurement-draft.ts,components/editor-2d/floorplan-measurement-tool-layer.tsx,components/editor-2d/floorplan-quick-measure-layer.tsx}`.

Measurements are regular level children. Their geometry is resolved in level-local SI metres, while rendering and formatting are derived from live viewer preferences. Draft previews stay transient and a completed measurement enters scene history through one `createNode` call.

## Current implementation

- Distance, angle, area, perimeter, and prism-volume measurements are persistent `measurement` nodes in the ordinary scene graph.
- Free anchors and stable semantic anchors coexist. Wall, roof-segment, slab, ceiling, zone, and site contributions resolve current geometry so associated values update with their hosts without rewriting the measurement.
- Selected measurements edit through in-scene endpoints or polygon vertices in 2D and 3D. Measurements do not mount the generic floating action menu or parametric inspector.
- Escape validates and finishes the current measurement, then preserves the selected kind so another measurement can begin immediately. An Area with at least three placed points commits; if those points do not enclose a valid planar area, they stay visible with the validation error instead of being discarded. Fewer than three placed points still cancel the draft.
- Three-dimensional drafting uses full-scene surface raycasts, intent-aware polygon surface selection, surface-verified magnetic axes, structural proximity axes, and hollow surface-normal intersection rings. Persistent annotation geometry stays on the overlay layer so it cannot black out the WebGPU scene pass.
- Committed distance endpoints render as depth-tested, screen-sized contact rings aligned to each resolved anchor normal. Semantic wall-face anchors therefore remain flush to the edited host instead of becoming camera-facing or floating markers.
- Smart measure is a transient 2D/3D measurement lens. Hovering resolves registry-owned wall, slab, and zone reports into one editor-viewport HUD and a live surface marker; clicking pins the report and leaves a stronger in-view anchor until another surface replaces it or Smart exits. It never creates nodes, changes selection, or writes history.
- A selected zone exposes a derived blueprint report with footprint/perimeter, edge dimensions, gross wall surface, matching floor surface, and flat-room volume only when current scene evidence proves each value.
- Actual value labels use the outlined annotation treatment. The 3D tool omits cursor-following feature, active-segment, and axis-name pills; the 2D tool still presents semantic and active-segment labels while that parity decision remains open.

## Smart inspection and zone quantities

`NodeDefinition.quickMeasure` is the node-owned extension point for fast inspection. A report contains a title, subtitle, scene-local anchor, compact metric rows, and an optional qualification note. Wall reports expose centerline length, effective height, gross face area before openings, and thickness. Slab reports expose hole-subtracted surface, outside perimeter, and thickness. Zone reports expose footprint and perimeter and explicitly say that the room envelope is not proven.

Smart mode is not a persistent measurement kind. Selecting it does not overwrite the last creatable kind used by `M`; leaving it creates no scene or history entry. The 3D tool reuses the bounded surface-query session and shows a surface-normal contact ring. The 2D layer uses the registry floor-plan hit target and maps the pointer into scene coordinates for the matching contact marker. Both views publish to one editor-owned report HUD fixed at the top center of the combined viewport. In split mode the pane under active inspection owns that single HUD; in 2D-only or 3D-only mode the matching source is selected directly. Camera, pan, zoom, scene rotation, and the split divider never move the data. A click captures only transient tool state: hover may temporarily inspect another surface, pointer exit falls back to the pinned report, and a later click replaces the pin.

Smart pointer handling is latest-event-wins. One shared animation-frame scheduler drops intermediate raw events, limits surface queries to one every 30 milliseconds, and ignores movement below one screen pixel. On the same target node, 2D and 3D update only the live marker transform imperatively; React state and report-card reconciliation occur only when the target identity changes or the user pins a result. The 2D layer clears hover only when the pointer leaves the root SVG, not when it crosses child paths. The shared editor HUD remains pointer-transparent so mounting or switching the report cannot force a false canvas exit.

Zone visuals intentionally unmount outside zone presentation, so a 3D Smart floor hit cannot depend only on a zone mesh. When the visible hit is an upward/downward slab face, Smart checks active-level zone polygons in level-local plan space and resolves the smallest containing zone. It never replaces a wall hit. When zone geometry is mounted, a nearly coplanar zone may also win over its slab within the bounded surface tolerance.

`deriveZoneQuantityReport` is a pure, conservative Core report. Footprint area, perimeter, and individual edge lengths are always available. Enclosed-room classification requires the zone to be substantially covered by detected spaces that are themselves contained by the zone, or complete wall coverage of the closed zone boundary within the modeling tolerance. Every overlapping detected space contributes its ordered indoor-facing boundary-face spans clipped to the zone: an exterior wall contributes only its room-facing side, an internal separator contributes both room-facing sides, and a semantic sub-zone never invents a wall along an open boundary. Wall surface may therefore be available even when the zone remains classified as a footprint. Floor and ceiling evidence may combine multiple surfaces only when their union covers at least 95% of the zone and their elevations or heights agree; contained holes subtract, crossing holes remain unavailable. Flat volume uses the proven floor area and positive clear height without requiring a fabricated wall enclosure. Missing or conflicting evidence returns a user-facing unavailable reason rather than a plausible estimate.

The zone parametric inspector derives this report from the current zone polygon and scene nodes, then renders a compact top-view SVG with every edge dimension plus wall, floor, and volume rows. None of these values are persisted in `ZoneNode.metadata`, represented by hidden measurement nodes, or written during rendering. Net wall-opening subtraction, normalized persisted span parameters, and sloped upper surfaces remain future topology work.

An exact room-footprint zone may be procedural. Space detection retains the wall IDs traversed by the proving half-edge cycle; the zone stores those IDs in `boundaryWallIds` with `autoFromWalls`. Its 2D/3D geometry, Smart report, semantic features, and quantity report resolve the current polygon from those effective walls, including per-wall live overrides. Pointer movement does not write the scene. The wall commit refreshes the stored polygon as a fallback while scene history is paused. Moving or editing the zone itself clears the association, so a deliberate manual boundary cannot be snapped back by room reconciliation. Site/lawn zones that do not exactly match a detected enclosure remain manual.

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

The wall contribution samples the existing curved-wall centerline and resolves face hits with normalized `t` plus clamped height. Exact plan-level wall corners bind to `wall:start` or `wall:end` before the thickness-aware face matcher runs. Curved walls additionally publish `wall:curve:center`, allowing radius, center-mark, chord, arc-length, and angular construction dimensions to bind their complete defining geometry and follow later curve edits. Arc-length and angular drafting use four explicit clicks: first arc/ray point, center/vertex, second arc/ray point, then label-line position; their anchors persist in point-center-point order. The roof-segment contribution reuses `getRoofSegmentPlanLinework` and the existing roof surface-height calculation, then applies segment and parent-roof transforms. Slab, ceiling, zone, and site use one shared polygon contribution with stable `vertex:<index>`, `boundary`, and `center` roles. An exact corner uses the point feature so it remains a corner when the polygon changes shape; continuous boundary anchors store normalized perimeter position. Do not duplicate any of those topology implementations in measurement code.

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

## Committed editing

A sole-selected committed measurement exposes its existing endpoints or vertices directly in the active view. Distance and angle expose their point tuples; area and perimeter expose their full rings; volume exposes only its base ring because the top vertices remain derived from the extrusion vector. These handles are selection affordances, not a second tool mode, and they disappear when the measurement is not selected. Committed editing does not insert midpoint vertices.

Dragging one handle refreshes every semantic fallback from the current resolved geometry, then replaces only the moved anchor. Untouched semantic anchors keep their references. A 3D drag uses the same visible-surface resolver, adjacent-vertex axes, proximity anchors, and semantic feature matching as drafting; it re-associates when the final constrained point still lies on the matched feature. The 2D affordance uses the shared wall, grid, and structural alignment pipeline and can re-associate to the wall feature that won the magnetic snap. Otherwise the moved anchor becomes a free point.

Area, perimeter, and volume edits stay on the measurement's original arbitrary plane. A 3D hit is projected back onto that plane; a 2D plan edit solves the missing height from the plane equation, including sloped planes, and projects the plan point onto a vertical plane when height cannot be solved uniquely. Distance and angle keep the moved point's existing height in 2D.

Both committed edit paths preview through `useLiveNodeOverrides`. Pointer release clears the preview and performs one tracked `updateNode`; pointer cancel, Escape, blur, unmount, or an invalid schema result clears the override without a scene write. The persistent renderer consumes its own live override so geometry and values move in sync during the gesture.

Measurements set `presentation.actionMenu: false` and do not register `parametrics`. Both generic 2D and 3D action menus honor the registry flag, while the generic inspector manager returns no floating panel for a kind without parametrics. Direct geometry handles are the primary selected-node interaction; selection, keyboard deletion/duplication, inline tree naming and visibility, and scene persistence remain on their ordinary node contracts.

## Picking and snapping

Measurement snapping is always magnetic. The construction snapping-mode chip (`grid` / `lines` / `angles` / `off`) governs construction tools; measurement anchors exist to bind real geometry, so the drafting and committed-edit paths in both views apply wall, semantic-feature, and axis magnetism unconditionally and never consult `isMagneticSnapActive()`. Holding Alt is the temporary bypass in both views: axis pull, wall magnetism, and the 2D projected-geometry pull all release, and a semantic feature binds only at the contact tolerance (0.012 m) rather than by attraction. Free measurement points never quantize to the construction grid — the drafting layer and the committed 2D affordance both route the fallback through the raw pointer. The one mode-driven reader left is the volume extrusion height, which quantizes to the grid step in `grid` mode. In 2D, a discrete wall snap (endpoint, midpoint, or crossing) outranks the locked axis pull: while such a point is acquired, axis assistance stays passive so the lock cannot drag the point off the corner.

The registered 3D tool raycasts visible geometry under registered scene roots and converts the winning world-space point and normal into the active level frame. A system-rendered mesh outside those roots must opt in with `userData.measurementSurface = true`; this is the contract used by collective instanced plant meshes. An editor-helper root nested under registered geometry must opt out with `userData.measurementSurface = false`, which is inherited by its descendants. Measurement activation clears object selection, and measurement/guide/scan nodes, invisible objects, zero-opacity or non-depth-tested materials, and `colorWrite: false` colliders are excluded. Instanced hits must include the intersected instance matrix when their normals are transformed.

Area, perimeter, and volume drafting treat the first surface as a hard reference plane. Before the first point, a horizontal slab, ceiling, or site surface may outrank a wall that occludes it by no more than 0.45 metres along the pointer ray, which makes floor corners stable without turning a mid-wall hover into a floor pick. The first committed contact then supplies the plane for every later vertex and draft edit. Pointer queries accept only hits on that plane, even through a nearer occluder; when the pointer ray has no matching surface hit, no candidate is offered. Alt still releases magnetic axes and feature attraction, but never releases the captured polygon plane. The shared draft store projects accepted points and feature fallbacks onto the plane as a final invariant. Distance and angle remain nearest-surface tools.

Axis assistance starts from the previous vertex. X, Y, or Z becomes a snap only when the projected candidate is verified on the hit surface within the screen-space threshold. Otherwise the raw surface hit remains authoritative and the nearest axis is shown as a passive guide. A magnetic lock enters at 16 screen pixels and retains the same axis and anchor until 24 pixels; it must release immediately if that candidate no longer verifies on the surface.

The 3D preview also raycasts in both directions along each level-local axis and marks the visible eligible surfaces those axes cross. These targets are guidance, not stored anchors or independent snap candidates: pointer placement still has to acquire and verify the ordinary surface-preserving axis candidate. Intersection queries therefore use the same registered-root, visibility, helper-exclusion, and system-surface contract as pointer picking, and are bounded per axis direction.

The live 3D tool owns one `MeasurementSurfaceQuerySession`. The session reuses dedicated pointer, verification, and axis raycasters; caches the eligible root/owner context by `sceneRegistry.revision`; and periodically refreshes explicit unregistered `measurementSurface` opt-ins. Pointer resolution, surface verification, and axis-intersection collection therefore share one eligibility contract without rebuilding registered roots for every pointer event. Tool unmount disposes the session by invalidating its cached context.

Measurements also treat the active level's structural alignment anchors as proximity axes. In 3D this assistance is limited to near-horizontal hit surfaces and every acquired X/Z projection is recast onto the original surface before it can move the point. In both views a nearby scene axis may be advertised up to 40 screen pixels away, becomes magnetic at the ordinary 16-pixel acquisition threshold, and retains the exact source anchor through the 24-pixel release threshold. Keep this state in the measurement draft until the shared alignment-guide store has owner-aware sessions; publishing ownerless global guides would let the inactive pane overwrite the active measurement.

The 2D layer reads registered floor-plan SVG geometry and the same structural alignment anchors used by placement tools. It gives vertices priority over edges, acquires registered corners within 16 screen pixels, bounds element and segment collection, de-duplicates proximity anchors in plan space, and applies X/Z assistance in plan space. Before axis assistance it also runs the shared slab/ceiling surface-plan snap pipeline: magnetic wall endpoints, midpoints, crossings, and edges publish the common wall highlight and snap beacon, and the winning wall ID becomes the semantic association target. Both views use the same draft transitions and commit path.

After ordinary surface/plan snapping, the winning registered node may refine the hit through `NodeDefinition.measurement.match`. A successful match stores the semantic feature anchor and uses its resolved point; unsupported nodes retain the ordinary free point. This keeps generic picking available to every rendered node without pretending that unstable mesh triangles are persistent topology.

When a semantic feature is under the pointer, both drafting views may distinguish the reticle. The 3D view does not add a cursor-following text pill; the 2D view currently retains its semantic label. This is presentation only: clicking still creates an ordinary persistent measurement anchor, and unsupported surfaces keep the same free-point workflow.

## Rendering and visibility

The persistent 3D renderer combines three visibility sources:

1. `MeasurementNode.visible` for a single annotation.
2. `useViewer.showMeasurements` for the project display preference.
3. Three.js ancestor visibility for level, building, and site presentation.

The ancestor check must also control the Drei `Html` value label because DOM portals do not inherit Three.js visibility. The 2D floor-plan definition applies the node and global flags before emitting semantic geometry.

Persistent 3D fills, strokes, and endpoints render on `OVERLAY_LAYER`. Keep them out of the scene depth/diffuse/normal MRT: area and volume fills are double-sided arbitrary-plane annotations, and a double-sided NodeMaterial in that MRT can invalidate the WebGPU render pipeline. The overlay camera layer remains raycastable, so this separation does not remove node selection.

Persistent and draft labels read `useViewer.unit` at render time. Node JSON always remains in metres; unit changes must not mutate scene data or create history entries. In 3D, resting linked measurements remain near-black and active measurements use the indigo product accent. In 2D, linked measurement geometry stays indigo at rest as an analysis-layer cue distinct from physical floor-plan geometry, with active measurements using the brighter accent; dangling measurements remain red. Keep each view's hierarchy consistent across geometry, endpoints, and fills while retaining enough label contrast over the scene.

Labels use a restrained hierarchy: distance shows one value offset from its segment; angle draws the smaller-angle arc between its two rays and places the degree value at that arc; area, perimeter, and volume use `A`, `P`, and `V` aggregate labels at a triangulated interior anchor so concave polygons keep the label inside the fill. In 3D, cursor-following feature, active-edge, and axis-name pills are omitted so the guide geometry carries transient feedback. The 2D draft layer still shows a semantic hover label, active-edge length, and axis/proximity label. The volume extrusion control owns both `H` and live `V` while it is open, so a duplicate aggregate label does not sit underneath it. Three-dimensional labels stay constant in screen size; two-dimensional aggregate labels explicitly counter-rotate the scene and remain horizontal.

Draft strokes use finite, non-indexed `BufferGeometry` with WebGPU node line materials. Do not use Drei's wide `Line` helper here: it creates WebGL `LineMaterial` and instanced geometry that the WebGPU post-processing pass cannot render.

The 3D hover reticle is a screen-sized, double-sided ring oriented to the resolved surface normal. Its short RGB axes stay in the level measurement frame, while a neutral stem communicates the surface normal. After the first point, full X/Y/Z guides pass through the active anchor; 2D mirrors this with an upright reticle and X/Z guides. The candidate axis brightens and thickens, then becomes solid when magnetically locked. A locked distance and its reticle adopt that axis color, and the 2D endpoint gains a concentric lock beacon; inactive axes remain dashed but visible. The 3D axis/surface targets are screen-sized hollow rings oriented to each raycast hit normal, with depth-tested polygon offset keeping them in contact with the crossed face. A white halo sits beneath the axis color and strengthens with the same candidate/locked state. A scene-proximity guide uses the same halo treatment without an axis-name pill and, in 2D, a source beacon so the relationship remains legible over dense geometry.

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
