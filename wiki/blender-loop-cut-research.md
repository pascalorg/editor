# Blender Loop Cut and Slide Research

## Purpose and conclusion

This brief records Blender's Loop Cut and Slide behavior for the Pascal custom-mesh implementation. Behavior claims use only first-party Blender documentation and the official Blender source mirror. The source links are pinned to commit `1663a95e78e36c5a792c63fc10bcd4e1d09b7585`; the research was completed on 2026-08-10.

The important architectural fact is that Blender does not implement this as one opaque action. `MESH_OT_loopcut_slide` is a macro that runs topology insertion (`MESH_OT_loopcut`) and then the existing edge-slide transform (`TRANSFORM_OT_edge_slide`). [Blender mesh operator registration](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/mesh_ops.cc#L217-L228), [Blender operator API](https://docs.blender.org/api/current/bpy.ops.mesh.html#bpy.ops.mesh.loopcut_slide)

Pascal should preserve the same conceptual split:

1. Resolve and preview a valid quad edge ring without mutating topology.
2. Insert a centered loop into an operation-local draft.
3. Slide that draft from the immutable pre-cut topology.
4. Commit the final topology once, or restore the original topology on Pascal cancellation.

## Blender interaction contract

### Stage 1: choose the face loop

Loop Cut and Slide is available in Mesh Edit Mode through **Edge → Loop Cut and Slide** with `Ctrl-R`. After activation, the pointer chooses an edge perpendicular to the desired cut direction. Blender previews the resulting cut across the face loop. `LMB` accepts that ring and advances to slide; `RMB` aborts before inserting geometry. [Blender Loop Cut and Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/loopcut_slide.html)

The implementation finds the nearest visible edit-mesh edge under the pointer and refreshes its edge-ring preselection on mouse movement. The preview is not a selection side effect. [Blender loop-cut targeting](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L322-L366), [Blender modal update](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L552-L717)

Blender draws this preview using the theme's primary gizmo color, a one-pixel line, alpha blending, and disabled depth testing. The manuals call it yellow in the operator and magenta in the toolbar tool, so the transferable behavior is a thin, theme-aware, always-legible preview rather than a hard-coded color. [Blender edge-ring preview rendering](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_preselect_edgering.cc#L151-L203), [Blender Loop Cut tool manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/tools/loop.html)

### Ring traversal and eligible topology

Loop Cut traverses an **edge ring**, not an edge loop. Starting from the hovered edge, it crosses each quad to the opposite edge and continues in both directions. The loop preview is formed perpendicular to the crossed ring edges. Blender invokes the edge-ring walker with the `BMW_DELIMIT_EDGE_RING_NGONS` delimiter. [Blender loop-cut ring selection](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L99-L154)

With that delimiter, the walker:

- traverses only four-sided faces;
- steps from a face edge to its opposite edge;
- walks outward in both directions from the starting edge;
- accepts boundary and manifold edges while traversing;
- stops at non-quads, hidden faces, already visited edges, and non-manifold ambiguity.

These rules are explicit in the official BMesh walker. The manual presents triangles and n-gons as poles where the face loop terminates. [Blender BMesh edge-ring walker](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/bmesh/intern/bmesh_walkers_impl.cc#L1399-L1578), [Blender Loop Cut tool manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/tools/loop.html)

Blender contains a rare fallback that can subdivide only the hovered edge when no quad ring is available; its source notes that edge slide then breaks for that case. This is not a good Pascal MVP behavior because it looks like a valid loop preview but cannot provide the promised slide interaction. [Blender single-edge fallback](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L158-L224)

### Preview and number of cuts

For `N` cuts, Blender places preview points at fractions `i / (N + 1)` along every crossed ring edge and connects corresponding points across each quad. This yields uniformly spaced parallel previews without mutating the mesh. Vertex ordering is corrected as the ring is traversed so neighboring preview segments do not cross. [Blender edge-ring preview construction](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_preselect_edgering.cc#L205-L347)

During stage 1, the wheel, numeric input, and `PageUp`/`PageDown` change the number of cuts. `Alt-Wheel` changes smoothness, although the manual warns that smoothness is not previewed at this stage. [Blender Loop Cut and Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/loopcut_slide.html), [Blender loop-cut modal controls](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L560-L697)

### Stage 2: slide the inserted loop

After the first confirmation, pointer movement slides the new loop. `LMB` confirms its current location. `RMB` keeps the cut but resets it to the center; it is not an undo of the whole loop cut. [Blender Loop Cut and Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/loopcut_slide.html)

The ordinary slide is proportional: every new vertex uses the same factor along its crossed edge, regardless of that edge's absolute length. A negative or positive factor moves the loop toward the two opposite neighboring loops. [Blender Edge Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/edge_slide.html)

The slide options are:

| Option       | Blender behavior                                                                                                    | Shortcut                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Factor       | Relative slide position between the two neighboring loops.                                                          | Pointer or numeric input |
| Even         | Keeps an even absolute distance from one adjacent loop rather than using the same percentage on every crossed edge. | `E`                      |
| Flipped      | In Even mode, changes which adjacent loop provides the reference side.                                              | `F`                      |
| Clamp        | Keeps the result inside the surrounding edge extents. Disabling it permits movement outside the face-loop boundary. | `C` or `Alt`             |
| Control edge | Changes the edge whose length/reference drives Even mode.                                                           | `Alt-Wheel`              |

The manual defines these semantics, and Blender's transform operator exposes `value`, `use_even`, `flipped`, `use_clamp`, mirror editing, geometry snapping, and UV correction as distinct properties. [Blender Edge Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/edge_slide.html), [Blender edge-slide operator source](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/transform/transform_ops.cc#L1215-L1253)

Edge Slide participates in Blender's transform snapping. Transform operations use the current scene snap settings, and `Ctrl` temporarily inverts snapping by default. Therefore Blender does not define one special Loop Cut snap target; it inherits the active transform snap configuration. [Blender transform modal map](https://docs.blender.org/manual/en/5.0/modeling/transform/modal_map.html), [Blender edge-slide application](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/transform/transform_mode_edge_slide.cc#L781-L850)

### Confirmation and cancellation details

| State           | Confirm                            | Cancel/reset                         |
| --------------- | ---------------------------------- | ------------------------------------ |
| Choosing a ring | `LMB` or Enter advances to slide.  | `RMB` or Escape exits without a cut. |
| Sliding         | `LMB` confirms the current factor. | `RMB` keeps the cut centered.        |

Stage-1 behavior is explicit in Blender's modal source. Stage-2 right-click behavior is explicit in the manual. [Blender loop-cut modal handling](https://github.com/blender/blender/blob/1663a95e78e36c5a792c63fc10bcd4e1d09b7585/source/blender/editors/mesh/editmesh_loopcut.cc#L572-L609), [Blender Loop Cut and Slide manual](https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/edge/loopcut_slide.html)

Pascal should deliberately provide an additional unambiguous full-operation cancel during stage 2: Escape restores the immutable pre-cut topology. This is a product inference, not a claim about Blender, and it matches Pascal's existing preview/cancel and single-undo conventions.

## Safe Pascal MVP

The current `CustomMeshTopology` stores stable-ID vertices, undirected edges, and ordered face vertex loops, but validation does not establish manifoldness, face planarity, or geometric self-intersection. The MVP should therefore be narrower than Blender's complete BMesh behavior.

### Supported topology

- Accept one hovered edge only when it resolves to one deterministic open or closed ring of quads.
- Require each traversed edge to have no more than two incident faces.
- Stop at boundaries and non-quad faces.
- Reject a non-manifold starting edge, branching traversal, repeated face, missing opposite edge, degenerate edge, or any preview that cannot preserve face winding.
- Show no valid cut preview for an unsupported target; do not partially subdivide only the hovered edge.

This is an implementation inference based on Blender's quad-ring traversal and Pascal's stricter need to preserve a simple persistent topology.

### Operation state

Use an explicit modal state machine:

```text
inactive
  -> hovering { edgeId, orderedRing, cutCount }
  -> sliding { baseTopology, draftRing, factor }
  -> commit | cancel
```

- `hovering` is read-only and changes as the pointer crosses eligible edges.
- First `LMB` snapshots the original topology and creates only an operation-local centered draft.
- Pointer movement always recomputes from that snapshot; it never compounds the prior preview.
- Second `LMB` writes one scene update and one undo entry.
- Stage-1 `RMB`/Escape and stage-2 Escape clear preview state without a scene update.
- Stage-2 `RMB` commits the centered draft, matching Blender's visible behavior.
- Whole-node dragging and component transforms remain disabled while this operator owns the mesh-editing interaction scope.

### Pure topology rewrite

Represent the resolved ring as ordered crossed edges plus ordered quad faces and consistent per-face orientation. For one centered cut:

1. Insert one stable-ID vertex on every crossed edge.
2. Replace each crossed edge with two edge segments.
3. Connect the new vertices across every traversed quad.
4. Replace every traversed quad with two winding-preserving quads that retain its material slot.
5. Reuse each inserted vertex and edge between neighboring faces.
6. Reconnect the last segment to the first for a closed ring; terminate at boundary edges for an open ring.
7. Validate the completed draft before exposing or committing it.

For `N` centered cuts, interpolate at `i / (N + 1)`, split each crossed edge into `N + 1` segments, and replace each crossed quad with `N + 1` ordered quads. Multi-cut should follow the single-cut implementation because its ID remapping, selection, and slide constraints increase failure modes.

### MVP interaction and visual treatment

- Add a persistent Loop Cut tool to the existing floating Edit Mode UI and `Ctrl-R` shortcut routing.
- Hover the existing generous edge hit targets; render only the exact prospective loop as a thin project-theme line.
- Default to one cut. Let the wheel change count with a conservative Pascal cap, such as 32, to prevent accidental topology explosions.
- Start slide at the center and support proportional factor with mandatory clamp.
- Snap the factor predictably through Pascal's existing interaction/snap model; do not introduce a second hidden modifier convention solely for this node.
- Display the cut count in stage 1 and the slide factor in stage 2.
- Select the newly created edge loop after commit.

### Parity deferred until the kernel is proven

Implement these only after single-cut traversal, winding, preview cancellation, and undo are correct on skewed geometry:

1. Multi-cut sliding.
2. Even distance, control-edge choice, and Flip.
3. Unclamped slide; it can create self-intersection that the current validator cannot detect.
4. Smoothness and falloff.
5. UV correction and mirror editing, once custom-mesh topology stores the required attributes and symmetry contract.
6. Blender's single-edge fallback on non-quad topology.

## Acceptance matrix

| Case                                            | Expected result                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Default box, hover a vertical edge              | Preview one closed horizontal loop across the four side quads.                                          |
| Default box, hover a top/bottom edge            | Preview the perpendicular closed ring selected by that edge.                                            |
| Extruded or inset shape containing n-gon poles  | Preview traverses deterministic quads and stops before the non-quad.                                    |
| Skewed quads                                    | Preview segments preserve correspondence and do not cross; proportional slide remains on crossed edges. |
| Open quad strip                                 | Preview terminates at both boundaries and commit creates an open new loop.                              |
| Triangle, isolated edge, or non-manifold branch | No valid preview and no mutation.                                                                       |
| Wheel in stage 1                                | Parallel previews update uniformly; topology remains unchanged.                                         |
| First-stage Escape/RMB                          | Preview disappears; topology and history are unchanged.                                                 |
| Stage-2 pointer movement                        | Live draft updates from the original topology without accumulating error.                               |
| Stage-2 Escape                                  | Pascal restores the original topology and adds no history entry.                                        |
| Stage-2 RMB                                     | One centered cut is committed.                                                                          |
| Stage-2 LMB                                     | Current clamped factor is committed in one undoable update.                                             |
| Rotate/move whole node while tool is active     | Node drag does not start.                                                                               |

Unit tests should separately cover ring discovery, orientation, open/closed termination, ID uniqueness, material retention, one-cut and multi-cut rewrites, invalid-topology rejection, factor clamping, and validation of every result. Interaction tests should cover hover-without-mutation, both confirmation stages, both cancellation stages, scroll count, selection of created edges, and exactly one history update.
