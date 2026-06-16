'use client'

import '../../../three-types'

import {
  type AnyNode,
  type AnyNodeId,
  type EventSuffix,
  emitter,
  type GridEvent,
  getSelectableKinds,
  type NodeEvent,
  nodeRegistry,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lastGridMoveRef } from '../../../hooks/use-grid-events'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2

function getMetadataRecord(node: AnyNode): Record<string, unknown> {
  return typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function stripPlacementMetadata(node: AnyNode) {
  const metadata = { ...getMetadataRecord(node) }
  delete metadata.isNew
  delete metadata.isTransient
  return metadata
}

function isNewPlacementNode(node: AnyNode): boolean {
  const metadata = getMetadataRecord(node)
  return metadata.isNew === true
}

function patchRotation(node: AnyNode, rotationY: number): Partial<AnyNode> {
  if (!('rotation' in node)) return {}

  const rotation = (node as { rotation?: unknown }).rotation
  if (typeof rotation === 'number') {
    return { rotation: rotationY } as Partial<AnyNode>
  }
  if (Array.isArray(rotation)) {
    return {
      rotation: [rotation[0] ?? 0, rotationY, rotation[2] ?? 0],
    } as Partial<AnyNode>
  }
  return {}
}

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

const BASE_CLICK_TRIGGER_KINDS = [
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
  'box',
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
  const currentRotationYRef = useRef(originalRotationY)
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

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    previousSnapRef.current = null
    currentRotationYRef.current = originalRotationY
    let committed = false
    const isNewPlacement = isNewPlacementNode(node)

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

    const onGridMove = (event: GridEvent) => {
      const x = roundToHalf(event.localPosition[0])
      const z = roundToHalf(event.localPosition[2])
      const y = originalPosition[1]
      setCursorPosition([x, y, z])
      lastCursorRef.current = [x, y, z]

      // Pure imperative: move the mesh via its registered Object3D ref.
      sceneRegistry.nodes.get(node.id)?.position.set(x, y, z)
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
        position: [x, y, z],
        rotation: currentRotationYRef.current,
      })

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
    const commitAtCursor = (event?: ClickTriggerEvent | PointerEvent) => {
      if (committed) return
      const position: [number, number, number] = [...lastCursorRef.current]

      if (useScene.getState().nodes[node.id]) {
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(node.id, {
          position,
          metadata: stripPlacementMetadata(node),
          ...patchRotation(node, currentRotationYRef.current),
        } as Partial<AnyNode>)
        useScene.temporal.getState().pause()
        committed = true
      } else if (node.parentId) {
        // Orphan re-create path: re-parse via the registry's schema.
        const def = nodeRegistry.get(node.type)
        if (def) {
          const reparsed = def.schema.parse({
            ...(node as Record<string, unknown>),
            id: undefined,
            metadata: {},
            position,
            ...patchRotation(node, currentRotationYRef.current),
          })
          useScene.temporal.getState().resume()
          useScene.getState().createNode(reparsed as AnyNode, node.parentId as AnyNodeId)
          useScene.temporal.getState().pause()
          committed = true
        }
      }

      // Keep mesh.position aligned with the just-committed scene position
      // so the next R3F frame paints at the right spot even if React's
      // reconciliation lags by a tick.
      const mesh = sceneRegistry.nodes.get(node.id)
      if (mesh) mesh.position.set(position[0], position[1], position[2])

      // Now safe to clear — node.position is already the new value, so
      // `ParametricNodeRenderer`'s next render lands at `[x, 0, z]`.
      useLiveTransforms.getState().clear(node.id)

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      exitMoveMode()

      // Stop further propagation so other listeners (e.g. a selection
      // change on the clicked node) don't fire during the commit click.
      const native = event ? (event as { nativeEvent?: unknown }).nativeEvent : undefined
      if (
        native &&
        typeof (native as { stopPropagation?: () => void }).stopPropagation === 'function'
      ) {
        ;(native as { stopPropagation: () => void }).stopPropagation()
      }
      const direct = event ? (event as { stopPropagation?: () => void }).stopPropagation : undefined
      if (typeof direct === 'function') direct.call(event)
    }

    if (lastGridMoveRef.localPosition) {
      onGridMove({ localPosition: lastGridMoveRef.localPosition } as GridEvent)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      commitAtCursor(event)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      let rotationDelta = 0
      if ((event.key === 'r' || event.key === 'R') && !event.metaKey && !event.ctrlKey) {
        rotationDelta = Math.PI / 2
      } else if ((event.key === 't' || event.key === 'T') && !event.metaKey && !event.ctrlKey) {
        rotationDelta = -Math.PI / 2
      }

      if (rotationDelta === 0) return

      event.preventDefault()
      currentRotationYRef.current += rotationDelta
      sceneRegistry.nodes.get(node.id)?.rotation.set(0, currentRotationYRef.current, 0)
      useLiveTransforms.getState().set(node.id, {
        position: [...lastCursorRef.current],
        rotation: currentRotationYRef.current,
      })
      sfxEmitter.emit('sfx:item-rotate')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', commitAtCursor)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)

    // Listen on every common + registry-selectable kind's click event too.
    // The registry part keeps newly added primitives from needing another
    // hardcoded event list just to complete a generic move drag.
    const clickTriggerKinds = Array.from(
      new Set<string>([...BASE_CLICK_TRIGGER_KINDS, ...getSelectableKinds()]),
    )
    for (const kind of clickTriggerKinds) {
      const key = `${kind}:click` as `${string}:${EventSuffix}`
      emitter.on(key as never, commitAtCursor as never)
    }

    const onCancel = () => {
      sceneRegistry.nodes
        .get(node.id)
        ?.position.set(originalPosition[0], originalPosition[1], originalPosition[2])
      useLiveTransforms.getState().clear(node.id)
      if (isNewPlacement) {
        useScene.getState().deleteNode(node.id as AnyNodeId)
      }
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', commitAtCursor)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      for (const kind of clickTriggerKinds) {
        const key = `${kind}:click` as `${string}:${EventSuffix}`
        emitter.off(key as never, commitAtCursor as never)
      }
      emitter.off('tool:cancel', onCancel)
      // Restore the moved meshes' raycast so they're hoverable / selectable
      // again after the drag ends.
      for (const restore of restoreRaycasts) restore()
      if (!committed) {
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(originalPosition[0], originalPosition[1], originalPosition[2])
        useLiveTransforms.getState().clear(node.id)
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node, originalPosition, originalRotationY])

  return <CursorSphere color="#a78bfa" height={2.5} position={cursorPosition} />
}
