'use client'

import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  collectAlignmentAnchors,
  type EventSuffix,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  type NodeEvent,
  nodeRegistry,
  type PortConnectivity,
  resolveAlignment,
  resolveConnectivityUpdates,
  resolveFacingIndicator,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { commitFreshPlacementSubtree } from '../../../lib/fresh-planar-placement'
import { stripPlacementMetadataFlags } from '../../../lib/placement-metadata'
import { resolvePlanarCursorPosition } from '../../../lib/planar-cursor-placement'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { resolveSnapFlags } from '../../../lib/snapping-mode'
import useAlignmentGuides from '../../../store/use-alignment-guides'
import useEditor, { getActiveSnappingMode, isMagneticSnapActive } from '../../../store/use-editor'
import useFacingPose from '../../../store/use-facing-pose'
import { swallowNextClick } from '../../editor/node-arrow-handles'
import { CursorSphere } from '../shared/cursor-sphere'
import { DragBoundingBox } from '../shared/drag-bounding-box'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import { useFreshPlacementVisibility } from '../shared/fresh-placement-visibility'
import { PlacementBox } from '../shared/placement-box'

/** Snap a world-plan coordinate to the editor's active grid step (0.5 / 0.25
 *  / 0.1 / 0.05), read live so changing the step mid-drag takes effect. */
const snapToGridStep = (value: number) => {
  if (!resolveSnapFlags(getActiveSnappingMode()).grid) return value
  const step = useEditor.getState().gridSnapStep
  return Math.round(value / step) * step
}

/** 45° steps, matching the GLB item placement rotation. */
const ROTATION_STEP = Math.PI / 4

/** Default magnetic radius (meters, XZ) for `movable.portSnap`. */
const PORT_SNAP_RADIUS_M = 0.5

/**
 * Magnetic port snap for a dragged node: if one of the node's own ports
 * (read live from `def.ports`) lands within `radius` of a matching scene
 * port at the candidate XZ, return the node XZ that mates them exactly.
 *
 * Pure core: ports come through `nodeRegistry` so this stays layer-clean.
 * Ports are level-local meters — the same frame as the cursor's
 * `localPosition`, so no extra transform is needed. The dragged node's
 * ports move rigidly with its position, so a port at candidate `(x,z)`
 * sits at `portStored + (candidate - nodeStored)`. We pick the closest
 * (own-port, target-port) pair and shift the node so they coincide in XZ.
 */
function resolvePortSnap(
  node: AnyNode,
  candidate: [number, number],
  config: { systems?: readonly string[]; radius?: number },
): [number, number] | null {
  const nodePos = (node as { position?: [number, number, number] }).position
  if (!nodePos) return null
  const ownPorts = nodeRegistry.get(node.type)?.ports?.(node)
  if (!ownPorts || ownPorts.length === 0) return null

  const radius = config.radius ?? PORT_SNAP_RADIUS_M
  const radiusSq = radius * radius
  const { systems } = config
  const dragDx = candidate[0] - nodePos[0]
  const dragDz = candidate[1] - nodePos[2]

  const nodes = useScene.getState().nodes
  let bestDistSq = radiusSq
  let snap: [number, number] | null = null

  for (const node2 of Object.values(nodes)) {
    if (!node2 || node2.id === node.id) continue
    const targets = nodeRegistry.get(node2.type)?.ports?.(node2)
    if (!targets) continue
    for (const target of targets) {
      if (systems && target.system !== undefined && !systems.includes(target.system)) continue
      for (const own of ownPorts) {
        // Own port at the candidate position = stored port + drag delta.
        const ownX = own.position[0] + dragDx
        const ownZ = own.position[2] + dragDz
        const dx = target.position[0] - ownX
        const dz = target.position[2] - ownZ
        const distSq = dx * dx + dz * dz
        if (distSq <= bestDistSq) {
          bestDistSq = distSq
          // Shift the node so this own port lands on the target (XZ only).
          snap = [candidate[0] + dx, candidate[1] + dz]
        }
      }
    }
  }
  return snap
}

/** Figma-style alignment-snap threshold (meters), matching the 2D
 *  floor-plan overlay's `ALIGNMENT_THRESHOLD_M`. 8 cm gives a magnetic pull
 *  without fighting grid snap. Fixed for v1 — no zoom-scaling in 3D. */
const ALIGNMENT_THRESHOLD_M = 0.08

/**
 * Generic move tool for any registry-backed kind.
 *
 * Imperative-only motion during drag:
 * - On every `grid:move` we mutate `sceneRegistry.nodes.get(id).position`
 *   directly. The node's store data is unchanged → the renderer doesn't
 *   re-render → R3F doesn't reapply `position={node.position}` → the
 *   imperative mutation sticks. Movement is smooth, framerate-locked,
 *   and React-free.
 *
 * Store update happens only on commit (single undoable action).
 *
 * Cancel imperatively snaps the mesh back to its original position and
 * resumes history without ever having touched the store mid-drag.
 *
 * **Commit triggers**: the tool listens for `grid:click` *and* the
 * common node click events (shelf / item / slab / ceiling / wall /
 * fence / column / roof / stair). A click on the grid plane fires
 * `grid:click`; a click on the moved node itself (or any other 3D
 * geometry the ray happens to land on) fires the corresponding node
 * click event. Without the node-click listeners, clicking on the
 * cursor's own mesh during a move would silently drop the commit —
 * the user perceives "click did nothing" because the click hit the
 * vertical face of e.g. a shelf instead of the grid plane below it.
 *
 * The latest cursor position from `grid:move` is stored in a ref so
 * any of these click variants commit at the same spot the cursor was
 * indicating.
 */
type ClickTriggerEvent = GridEvent | NodeEvent<AnyNode>

const CLICK_TRIGGER_KINDS = [
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
] as const

export function MoveRegistryNodeTool({ node }: { node: AnyNode }) {
  const originalPosition: [number, number, number] = useMemo(
    () =>
      'position' in node && Array.isArray((node as { position?: unknown }).position)
        ? ((node as { position: [number, number, number] }).position ?? [0, 0, 0])
        : [0, 0, 0],
    [node],
  )
  /**
   * Y-axis rotation of the node at move-start. Captured so the
   * imperative drag preview (and the `useLiveTransforms` mirror) keeps
   * the original orientation — otherwise hardcoding `rotation: 0` in
   * `useLiveTransforms.set` would override `node.rotation[1]` during
   * the drag, the shelf would visually un-rotate to 0, then snap back
   * to its true rotation on commit (when the live transform clears).
   * The user reads that snap as "reverts to a weird position".
   */
  const originalRotationY: number = useMemo(() => {
    if ('rotation' in node) {
      const r = (node as { rotation?: unknown }).rotation
      if (typeof r === 'number') return r
      if (Array.isArray(r)) return (r as [number, number, number])[1] ?? 0
    }
    return 0
  }, [node])
  const [cursorPosition, setCursorPosition] = useState<[number, number, number]>(originalPosition)
  const previousSnapRef = useRef<[number, number] | null>(null)
  /**
   * The latest snapped cursor position from `grid:move`. We commit at
   * THIS position regardless of which event variant fires the click —
   * a `grid:click` carries the same coords, but a node-click (e.g.
   * `shelf:click`) carries the hit point on the clicked node's mesh,
   * which can be slightly off-cursor when the user clicks the vertical
   * face of the moved node itself. Reading from the ref keeps the
   * commit position consistent with the visible cursor.
   */
  const lastCursorRef = useRef<[number, number, number]>(originalPosition)
  const dragAnchorRef = useRef<[number, number] | null>(null)
  /**
   * Becomes true on the first `grid:move` after this move arms. Commits are
   * ignored until then so a click that *armed* this move (e.g. the trailing
   * `click` event of the click that just committed the previous copy, when a
   * preset placement immediately re-arms the next one) can't auto-drop a
   * second copy at the spot. Every real placement moves the cursor into
   * position before the drop click, so this never blocks a legitimate commit.
   */
  const hasMovedRef = useRef(false)
  // Live Y-rotation during the drag, seeded from the node's current rotation
  // and bumped by R/T. Applied imperatively + mirrored to `useLiveTransforms`,
  // and committed to the scene on drop.
  const rotationRef = useRef(originalRotationY)
  // Snapshot of which ducts / fittings are mated to this node's ports at
  // drag-start (duct fittings only). Drives the "connected ductwork follows"
  // behaviour: connected nodes preview through `useLiveNodeOverrides` during
  // the drag and commit alongside the moved node on drop. Null for kinds with
  // no ports, so every other movable kind is unaffected.
  const connectivityRef = useRef<PortConnectivity | null>(null)
  // Node ids this drag has pushed live overrides onto — cleared on
  // commit / cancel / unmount so a follow-on drag starts clean.
  const overriddenIdsRef = useRef<AnyNodeId[]>([])

  // Colliding floor kinds (item / shelf / column) show the same green/red
  // footprint box GLB items use (instead of the vertical-arrow cursor) and
  // refuse an invalid drop unless Alt forces it. The gate + footprint both come
  // from the kind's declarative `floorPlaced` capability, so opting a new kind
  // in is just `collides: true` — no change here.
  const collides = nodeRegistry.get(node.type)?.capabilities?.floorPlaced?.collides === true
  const boxDimensions = useMemo(
    () =>
      collides
        ? (nodeRegistry.get(node.type)?.capabilities?.floorPlaced?.footprint?.(node)?.dimensions ??
          null)
        : null,
    [collides, node],
  )
  const [valid, setValid] = useState(true)
  const [cursorRotationY, setCursorRotationY] = useState(originalRotationY)
  const { isFreshPlacement, previewVisible, revealFreshPlacement, useAbsoluteCursorPlacement } =
    useFreshPlacementVisibility({ node })
  // Kinds that declare `movable.cursorAttached` (duct fittings) pin to the
  // cursor instead of preserving the grab offset — small connector-like
  // nodes read an offset drag as "lagging behind the mouse".
  const cursorAttached = nodeRegistry.get(node.type)?.capabilities?.movable?.cursorAttached === true
  // Kinds that declare `movable.portSnap` (duct terminals) magnetically
  // mate one of their own ports onto a nearby scene port while dragging —
  // a register collar drops onto a duct run end. Reads `def.ports` through
  // the core registry, so it stays layer-clean (no @pascal-app/nodes import).
  const portSnapConfig = nodeRegistry.get(node.type)?.capabilities?.movable?.portSnap ?? null
  // Mirrors of `valid` / Alt for the event handlers inside the effect, which
  // can't read React state without stale closures.
  const validRef = useRef(true)
  const altRef = useRef(false)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
    dragAnchorRef.current = null
    hasMovedRef.current = false
    rotationRef.current = originalRotationY
    altRef.current = false
    validRef.current = true
    // Re-sync the box transform to the (possibly new) node. `node` changes
    // without this component remounting whenever a positioned preset re-arms a
    // fresh clone after a drop, or the user picks a different catalog tile —
    // and `useState` only honours its initial value, so without this the box
    // would keep the previous clone's rotation/position until the next R/T.
    setCursorRotationY(originalRotationY)
    lastCursorRef.current = originalPosition
    let committed = false
    const isNew = isFreshPlacement

    const baseRotation = (node as { rotation?: unknown }).rotation
    const toCommitRotation = (y: number): number | [number, number, number] =>
      Array.isArray(baseRotation)
        ? [(baseRotation[0] as number) ?? 0, y, (baseRotation[2] as number) ?? 0]
        : y

    const getVisualPosition = (
      position: [number, number, number],
      rotationY = rotationRef.current,
    ): [number, number, number] => {
      return getFloorStackPreviewPosition({
        node,
        position,
        rotation: toCommitRotation(rotationY),
      })
    }
    const markMovedNodeDirty = () => {
      if (useScene.getState().nodes[node.id]) {
        useScene.getState().markDirty(node.id as AnyNodeId)
      }
    }

    // Connectivity follow (duct fittings): the moved node with its live drag
    // transform, so `def.ports` recomputes for `resolveConnectivityUpdates`.
    // Uses the logical (un-stacked) position + Y rotation that commit writes,
    // not the floor-lifted visual position.
    const buildPreviewNode = (position: [number, number, number], rotationY: number): AnyNode =>
      ({
        ...(node as Record<string, unknown>),
        position,
        rotation: toCommitRotation(rotationY),
      }) as AnyNode

    // Resolve the patches that keep connected ductwork attached and preview
    // them through `useLiveNodeOverrides` (transient — no history churn;
    // GeometrySystem merges overrides via getEffectiveNode). Each connected
    // node is re-dirtied so its geometry rebuilds against the new override.
    const previewConnectivity = (position: [number, number, number], rotationY: number) => {
      const connectivity = connectivityRef.current
      if (!connectivity) return
      const updates = resolveConnectivityUpdates(
        connectivity,
        buildPreviewNode(position, rotationY),
      )
      if (updates.length === 0) return
      useLiveNodeOverrides
        .getState()
        .setMany(updates.map((u) => [u.id, u.data as Record<string, unknown>] as const))
      overriddenIdsRef.current = updates.map((u) => u.id)
      for (const u of updates) {
        if (useScene.getState().nodes[u.id]) useScene.getState().markDirty(u.id)
      }
    }

    const clearConnectivityOverrides = () => {
      for (const id of overriddenIdsRef.current) {
        useLiveNodeOverrides.getState().clear(id)
        if (useScene.getState().nodes[id]) useScene.getState().markDirty(id)
      }
    }

    setCursorPosition(getVisualPosition(originalPosition, originalRotationY))

    // Re-run the floor-collision check at the live cursor + rotation and push
    // the result to the box colour. Alt (free place) forces a valid (green)
    // override so the user can drop on top of an existing item on purpose. Only
    // shelves show the box, so this no-ops for every other movable kind.
    const recomputeValidity = () => {
      if (!boxDimensions) return
      if (altRef.current) {
        validRef.current = true
        setValid(true)
        return
      }
      const levelId = useViewer.getState().selection.levelId ?? node.parentId
      if (!levelId) {
        validRef.current = true
        setValid(true)
        return
      }
      const [x, y, z] = lastCursorRef.current
      const { valid: placeable } = spatialGridManager.canPlaceOnFloor(
        levelId,
        [x, y, z],
        boxDimensions,
        [0, rotationRef.current, 0],
        [node.id],
      )
      validRef.current = placeable
      setValid(placeable)
    }
    recomputeValidity()

    // Disable raycast on the moved node's meshes for the duration of
    // the drag. As the shelf follows the cursor, the cursor ray would
    // otherwise hit the moved mesh first → only `${kind}:move` fires →
    // `grid:move` stops updating `lastCursorRef` → clicks would commit
    // at the stale (initial) position. With raycast disabled, the ray
    // passes through the moved mesh and continues to the grid plane,
    // so `grid:move` keeps firing and the cursor tracks correctly.
    // We restore the original raycast on cleanup.
    const mesh = sceneRegistry.nodes.get(node.id)
    const restoreRaycasts: Array<() => void> = []
    if (mesh) {
      mesh.traverse((child) => {
        const original = child.raycast
        child.raycast = () => {}
        restoreRaycasts.push(() => {
          child.raycast = original
        })
      })
    }

    // Static alignment candidates — anchors of every OTHER alignable object
    // (items, walls, fences, slabs, ceilings, columns) ON THE SAME LEVEL,
    // gathered once at drag start (the scene graph is stable during an
    // imperative move). Level-scoped so a node directly below on another
    // floor doesn't snap (alignment is XZ-only). Coords are building-local,
    // the same frame as `event.localPosition` and the rendered cursor, so
    // the guide dots line up with the cursor.
    const alignmentCandidates = collectAlignmentAnchors(
      useScene.getState().nodes,
      node.id,
      useViewer.getState().selection.levelId ?? node.parentId,
    )

    // Connectivity snapshot (existing port-bearing nodes only — fresh
    // placements aren't connected to anything yet). Records which ducts /
    // fittings are mated to this node's ports so they can follow the drag.
    connectivityRef.current = null
    overriddenIdsRef.current = []
    if (!isNew && nodeRegistry.get(node.type)?.ports) {
      const snapshot = analyzePortConnectivity(node, useScene.getState().nodes)
      if (snapshot.connections.length > 0) connectivityRef.current = snapshot
    }

    const onGridMove = (event: GridEvent) => {
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      revealFreshPlacement()

      const resolved = resolvePlanarCursorPosition({
        cursor: [rawX, rawZ],
        original: [originalPosition[0], originalPosition[2]],
        anchor: dragAnchorRef.current,
        mode: useAbsoluteCursorPlacement || cursorAttached ? 'absolute' : 'relative',
        // Snap follows the mode (raw in Off via snapToGridStep); Alt = force only.
        snap: snapToGridStep,
      })
      dragAnchorRef.current = resolved.anchor
      let [x, z] = resolved.point

      // Figma-style alignment snap layered on top of grid snap: when the
      // moving item's edge lines up (on X or Z) with another item's edge,
      // snap and publish a guide. The guide connects to the nearest real
      // corner of the candidate (resolver tie-break), so the dot always sits
      // on an actual point. Alignment ("lines") follows the snapping mode only —
      // Alt is force-place (forces a valid drop), it does not bypass snapping.
      const bypass = !isMagneticSnapActive()
      if (!bypass && alignmentCandidates.length > 0) {
        const result = resolveAlignment({
          moving: movingFootprintAnchors(node, x, z, rotationRef.current),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          x += result.snap.dx
          z += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      // Magnetic port snap (duct terminals): mate a collar onto a nearby
      // duct run end. Takes precedence over grid / alignment snap; Alt
      // bypasses. Only kinds that opted in via `movable.portSnap`.
      if (!bypass && portSnapConfig) {
        // Build the preview node at the ORIGINAL position but with the LIVE
        // rotation so `def.ports` reflects any mid-drag R/T rotation. Without
        // this the snap solver mates the pre-rotation collar and commit then
        // writes the rotated node offset from the port it visually snapped to.
        const snapNode = buildPreviewNode(originalPosition, rotationRef.current)
        const mated = resolvePortSnap(snapNode, [x, z], portSnapConfig)
        if (mated) {
          x = mated[0]
          z = mated[1]
          useAlignmentGuides.getState().clear()
        }
      }

      const position: [number, number, number] = [x, originalPosition[1], z]
      const visualPosition = getVisualPosition(position)
      hasMovedRef.current = true
      setCursorPosition(visualPosition)
      lastCursorRef.current = position
      recomputeValidity()

      // Pure imperative: move the mesh via its registered Object3D ref.
      sceneRegistry.nodes.get(node.id)?.position.set(...visualPosition)
      // Publish to `useLiveTransforms` so the 2D floor plan can mirror
      // the drag in real-time (the floor-plan layer subscribes to this
      // store and overrides the node's rendered position when an entry
      // is set). Without this the 2D representation stays at the
      // committed scene position until the move ends.
      //
      // For position-based kinds (shelf, item, column, spawn) we write
      // the absolute world plan position here. Polygon-based kinds
      // (slab / ceiling / fence) follow a different delta contract —
      // their floor-plan move-targets handle the override themselves.
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: rotationRef.current,
      })
      markMovedNodeDirty()
      // Carry connected ductwork along (preview only — committed on drop).
      previewConnectivity(position, rotationRef.current)

      const prev = previousSnapRef.current
      if (!prev || prev[0] !== x || prev[1] !== z) {
        sfxEmitter.emit('sfx:grid-snap')
        previousSnapRef.current = [x, z]
      }
    }

    /** Commit the move at the latest cursor position. Shared by every
     *  click variant — grid plane, the moved node itself, or any other
     *  3D surface the user happens to click on during the move.
     *
     *  Order is deliberate: write scene FIRST, then clear
     *  `useLiveTransforms`. If we cleared the live transform first,
     *  `ParametricNodeRenderer` would re-render with
     *  `position = liveTransform?.position ?? node.position` → undefined
     *  → original `node.position` (the scene write hasn't happened yet),
     *  briefly snapping the mesh back to its starting spot before the
     *  next render lands the new position. Writing scene first means
     *  every render shows either the live drag position (liveTransform
     *  still set) or the new committed position (liveTransform cleared
     *  AND scene updated) — never the original.
     */
    const commitAtCursor = (event: ClickTriggerEvent) => {
      // One physical click can reach here twice: node clicks (`slab:click`,
      // `item:click`, …) are synthesized on *pointerup* (`use-node-events`),
      // while `grid:click` rides the browser's native *click* event from a
      // canvas DOM listener (`use-grid-events`) that deliberately ignores
      // stopPropagation — and this effect stays subscribed until React
      // re-renders after `exitMoveMode`. Without this guard the second pass
      // finds the fresh draft already deleted and takes the orphan re-create
      // path below, minting a hidden ghost copy and replaying the SFX.
      if (committed) return
      // Ignore a commit that fires before the cursor has moved into place —
      // it's the stray trailing click of whatever armed this move, not a
      // deliberate drop. Prevents preset re-arm from double-placing.
      if (!hasMovedRef.current) return
      // Refuse a drop on an invalid (red) footprint, matching the GLB item
      // tool — unless Alt (free place) is held to force placement. Other kinds
      // carry no validity box (`validRef` stays true), so they're never blocked.
      if (!validRef.current && !altRef.current) return
      const position: [number, number, number] = [...lastCursorRef.current]

      const rotation = toCommitRotation(rotationRef.current)
      const visualPosition = getVisualPosition(position)
      let committedId = node.id as AnyNodeId

      if (useScene.getState().nodes[node.id]) {
        const data = {
          position,
          rotation,
          ...(isNew
            ? {
                metadata: stripPlacementMetadataFlags(node.metadata),
                visible: true,
              }
            : null),
        } as Partial<AnyNode>

        if (isNew) {
          const finalId = commitFreshPlacementSubtree(node.id as AnyNodeId, data)
          if (finalId) {
            committed = true
            committedId = finalId
          }
        } else {
          // Fold the connected-ductwork follow-updates into the SAME
          // batch as the moved node so the whole thing is one undo step.
          const connectivityUpdates = connectivityRef.current
            ? resolveConnectivityUpdates(
                connectivityRef.current,
                buildPreviewNode(position, rotationRef.current),
              ).filter((u) => useScene.getState().nodes[u.id])
            : []
          useScene.temporal.getState().resume()
          useScene
            .getState()
            .updateNodes([{ id: node.id as AnyNodeId, data }, ...connectivityUpdates])
          useScene.temporal.getState().pause()
          committed = true
        }
      } else if (node.parentId) {
        // Orphan re-create path: re-parse via the registry's schema.
        const def = nodeRegistry.get(node.type)
        if (def) {
          const reparsed = def.schema.parse({
            ...(node as Record<string, unknown>),
            id: undefined,
            metadata: {},
            position,
            rotation,
          })
          useScene.temporal.getState().resume()
          useScene.getState().createNode(reparsed as AnyNode, node.parentId as AnyNodeId)
          useScene.temporal.getState().pause()
          committed = true
        }
      }

      // Clear after the scene write so React reconciles against the new
      // canonical position, then restamp the lifted presentation Y for the
      // current frame.
      useLiveTransforms.getState().clear(node.id)
      // Connected ductwork is now committed to the store — drop its live
      // overrides so the renderers read the canonical path/position.
      clearConnectivityOverrides()
      const mesh = sceneRegistry.nodes.get(node.id)
      if (mesh) {
        mesh.position.set(...visualPosition)
        mesh.rotation.y = rotationRef.current
      }

      useAlignmentGuides.getState().clear()
      if (isNew && committed) {
        useViewer.getState().setSelection({ selectedIds: [committedId] })
      }

      sfxEmitter.emit('sfx:item-place')
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()

      // Stop further propagation so other listeners (e.g. a selection
      // change on the clicked node) don't fire during the commit click.
      const native = (event as { nativeEvent?: unknown }).nativeEvent
      if (
        native &&
        typeof (native as { stopPropagation?: () => void }).stopPropagation === 'function'
      ) {
        ;(native as { stopPropagation: () => void }).stopPropagation()
      }
      const direct = (event as { stopPropagation?: () => void }).stopPropagation
      if (typeof direct === 'function') direct.call(event)
    }

    // R / T rotate the dragged node about Y in 45° steps — matching the GLB
    // item placement keys (and the "Rotate" hints the move HUD shows). Applied
    // imperatively + mirrored to the live transform; committed on drop.
    const onKeyDown = (e: KeyboardEvent) => {
      // Hold Alt (free place) to force placement on an invalid (red) footprint,
      // matching the GLB item tool. Recolour the box to green while held.
      if (e.key === 'Alt') {
        altRef.current = true
        recomputeValidity()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      let delta = 0
      if (e.key === 'r' || e.key === 'R') delta = ROTATION_STEP
      else if (e.key === 't' || e.key === 'T') delta = -ROTATION_STEP
      else return
      e.preventDefault()
      sfxEmitter.emit('sfx:item-rotate')
      rotationRef.current += delta
      setCursorRotationY(rotationRef.current)
      const position = lastCursorRef.current
      const visualPosition = getVisualPosition(position)
      setCursorPosition(visualPosition)
      const m = sceneRegistry.nodes.get(node.id)
      if (m) {
        m.position.set(...visualPosition)
        m.rotation.y = rotationRef.current
      }
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: rotationRef.current,
      })
      markMovedNodeDirty()
      // Rotating the fitting swings its collars — connected ducts follow.
      previewConnectivity(position, rotationRef.current)
      // Rotation changes the footprint's collision span — re-check validity.
      recomputeValidity()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altRef.current = false
        recomputeValidity()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', commitAtCursor)

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!useEditor.getState().placementDragMode) return
      if (event.button !== 0) return
      swallowNextClick()
      if (!hasMovedRef.current) {
        exitMoveMode()
        return
      }
      commitAtCursor({
        nativeEvent: event,
        stopPropagation: () => event.stopPropagation(),
      } as unknown as ClickTriggerEvent)
    }
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    // Listen on every common kind's click event too. mitt's typing keeps
    // `${kind}:click` as a fixed union so the cast is safe at runtime —
    // we're just routing them through the shared commit path.
    type SuffixedKey<K extends string> = `${K}:${EventSuffix}`
    type ClickKey = SuffixedKey<(typeof CLICK_TRIGGER_KINDS)[number]>
    for (const kind of CLICK_TRIGGER_KINDS) {
      const key = `${kind}:click` as ClickKey
      emitter.on(key, commitAtCursor as never)
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(node.id)
      clearConnectivityOverrides()
      if (isNew) {
        useScene.getState().deleteNode(node.id as AnyNodeId)
      } else {
        const m = sceneRegistry.nodes.get(node.id)
        if (m) {
          m.position.set(...getVisualPosition(originalPosition, originalRotationY))
          m.rotation.y = originalRotationY
        }
        markMovedNodeDirty()
      }
      useAlignmentGuides.getState().clear()
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }
    emitter.on('tool:cancel', onCancel)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', commitAtCursor)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
      for (const kind of CLICK_TRIGGER_KINDS) {
        const key = `${kind}:click` as ClickKey
        emitter.off(key, commitAtCursor as never)
      }
      emitter.off('tool:cancel', onCancel)
      // Restore the moved meshes' raycast so they're hoverable / selectable
      // again after the drag ends.
      for (const restore of restoreRaycasts) restore()
      // Drop any alignment guides this drag published — covers Esc / mid-drag
      // unmount / commit paths uniformly.
      useAlignmentGuides.getState().clear()
      const finalisedBy2D = useEditor.getState().movingNodeOrigin === '2d'
      if (!(committed || isNew || finalisedBy2D)) {
        useLiveTransforms.getState().clear(node.id)
        clearConnectivityOverrides()
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(...getVisualPosition(originalPosition, originalRotationY))
        markMovedNodeDirty()
      }
      useScene.temporal.getState().resume()
    }
  }, [
    boxDimensions,
    cursorAttached,
    portSnapConfig,
    exitMoveMode,
    isFreshPlacement,
    node,
    originalPosition,
    originalRotationY,
    revealFreshPlacement,
    useAbsoluteCursorPlacement,
  ])

  // Snapshot the scene once at drag-start — bounds depend on `node` (locked
  // for the lifetime of this tool) and any sibling state the kind reads. If a
  // future kind needs live sibling state mid-drag, switch to a subscribed
  // selector; for v1 (elevator shaft height from level set) start-time is
  // correct and avoids subscribing the whole `nodes` map.
  const dragBounds = useMemo(
    () =>
      nodeRegistry.get(node.type)?.capabilities?.dragBounds?.(node, useScene.getState().nodes) ??
      null,
    [node],
  )

  // Forward-facing triangle for the footprint-box branch (item / shelf / column
  // — anything that renders `<PlacementBox>`). Published to the editor-side
  // overlay; the `<DragBoundingBox>` branch (e.g. stair, which has no centred
  // footprint) publishes its own. The box is centred on `cursorPosition`, so
  // the footprint centre is the origin. Clears on unmount.
  const facing = resolveFacingIndicator(node.type)
  useEffect(() => {
    if (!previewVisible || !facing || !boxDimensions) return
    useFacingPose.getState().set({
      position: cursorPosition,
      rotationY: cursorRotationY,
      depth: boxDimensions[2],
      reversed: facing.reversed,
    })
  }, [previewVisible, facing, boxDimensions, cursorPosition, cursorRotationY])
  useEffect(() => () => useFacingPose.getState().clear(), [])

  if (!previewVisible) return null

  if (boxDimensions) {
    return (
      <PlacementBox
        dimensions={boxDimensions}
        position={cursorPosition}
        rotationY={cursorRotationY}
        valid={valid}
      />
    )
  }

  return (
    <>
      <CursorSphere color="#a78bfa" height={2.5} position={cursorPosition} />
      <DragBoundingBox
        centerY={dragBounds?.centerY}
        nodeId={node.id}
        position={cursorPosition}
        rotationY={cursorRotationY}
        size={dragBounds?.size}
      />
    </>
  )
}
