'use client'

import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type EventSuffix,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  type NodeEvent,
  nodeRegistry,
  resolveAlignment,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useAlignmentGuides } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { commitFreshPlacementSubtree } from '../../../lib/fresh-planar-placement'
import { stripPlacementMetadataFlags } from '../../../lib/placement-metadata'
import { resolvePlanarCursorPosition } from '../../../lib/planar-cursor-placement'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'
import { getFloorStackPreviewPosition } from '../shared/floor-stack-preview'
import { useFreshPlacementVisibility } from '../shared/fresh-placement-visibility'
import { PlacementBox } from '../shared/placement-box'

/** Snap a world-plan coordinate to the editor's active grid step (0.5 / 0.25
 *  / 0.1 / 0.05), read live so changing the step mid-drag takes effect. */
const snapToGridStep = (value: number) => {
  const step = useEditor.getState().gridSnapStep
  return Math.round(value / step) * step
}

/** 90° steps, matching the GLB item placement rotation. */
const ROTATION_STEP = Math.PI / 2

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

  // Shelf placement shows the same green/red footprint box GLB items use
  // (instead of the vertical-arrow cursor) and refuses an invalid drop unless
  // Shift forces it. The footprint comes from the kind's `floorPlaced`
  // capability so this stays generic if we ever opt other kinds in.
  const isShelf = node.type === 'shelf'
  const boxDimensions = useMemo(
    () =>
      isShelf
        ? (nodeRegistry.get(node.type)?.capabilities?.floorPlaced?.footprint?.(node)?.dimensions ??
          null)
        : null,
    [isShelf, node],
  )
  const [valid, setValid] = useState(true)
  const [cursorRotationY, setCursorRotationY] = useState(originalRotationY)
  const { isFreshPlacement, previewVisible, revealFreshPlacement, useAbsoluteCursorPlacement } =
    useFreshPlacementVisibility({ node })
  // Mirrors of `valid` / Shift for the event handlers inside the effect, which
  // can't read React state without stale closures.
  const validRef = useRef(true)
  const shiftRef = useRef(false)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
    dragAnchorRef.current = null
    hasMovedRef.current = false
    rotationRef.current = originalRotationY
    shiftRef.current = false
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

    setCursorPosition(getVisualPosition(originalPosition, originalRotationY))

    // Re-run the floor-collision check at the live cursor + rotation and push
    // the result to the box colour. Shift forces a valid (green) override so
    // the user can drop on top of an existing item on purpose. Only shelves
    // show the box, so this no-ops for every other movable kind.
    const recomputeValidity = () => {
      if (!boxDimensions) return
      if (shiftRef.current) {
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

    const onGridMove = (event: GridEvent) => {
      const rawX = event.localPosition[0]
      const rawZ = event.localPosition[2]
      revealFreshPlacement()

      const resolved = resolvePlanarCursorPosition({
        cursor: [rawX, rawZ],
        original: [originalPosition[0], originalPosition[2]],
        anchor: dragAnchorRef.current,
        mode: useAbsoluteCursorPlacement ? 'absolute' : 'relative',
        snap: snapToGridStep,
      })
      dragAnchorRef.current = resolved.anchor
      let [x, z] = resolved.point

      // Figma-style alignment snap layered on top of grid snap: when the
      // moving item's edge lines up (on X or Z) with another item's edge,
      // snap and publish a guide. The guide connects to the nearest real
      // corner of the candidate (resolver tie-break), so the dot always sits
      // on an actual point. Alt bypasses.
      const bypass = event.nativeEvent?.altKey === true
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
      // Ignore a commit that fires before the cursor has moved into place —
      // it's the stray trailing click of whatever armed this move, not a
      // deliberate drop. Prevents preset re-arm from double-placing.
      if (!hasMovedRef.current) return
      // Refuse a drop on an invalid (red) footprint, matching the GLB item
      // tool — unless Shift is held to force placement. Other kinds carry no
      // validity box (`validRef` stays true), so they're never blocked.
      if (!validRef.current && !shiftRef.current) return
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
          useScene.temporal.getState().resume()
          useScene.getState().updateNode(node.id, data)
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

    // R / T rotate the dragged node about Y in 90° steps — matching the GLB
    // item placement keys (and the "Rotate" hints the move HUD shows). Applied
    // imperatively + mirrored to the live transform; committed on drop.
    const onKeyDown = (e: KeyboardEvent) => {
      // Hold Shift to force placement on an invalid (red) footprint, matching
      // the GLB item tool. Recolour the box to green while held.
      if (e.key === 'Shift') {
        shiftRef.current = true
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
      // Rotation changes the footprint's collision span — re-check validity.
      recomputeValidity()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftRef.current = false
        recomputeValidity()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', commitAtCursor)

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
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(...getVisualPosition(originalPosition, originalRotationY))
        markMovedNodeDirty()
      }
      useScene.temporal.getState().resume()
    }
  }, [
    boxDimensions,
    exitMoveMode,
    isFreshPlacement,
    node,
    originalPosition,
    originalRotationY,
    revealFreshPlacement,
    useAbsoluteCursorPlacement,
  ])

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

  return <CursorSphere color="#a78bfa" height={2.5} position={cursorPosition} />
}
