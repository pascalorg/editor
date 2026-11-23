'use client'

import {
  type AnyNodeId,
  emitter,
  FLAT_GROUND_Y,
  ROCK_EMBED,
  type RockNode,
  rockSpan,
  terrainFieldOf,
  useLiveNodeOverrides,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import {
  BOUNDARY_OUTLINE_COLOR,
  beginGesture,
  boundaryReshapeScope,
  isTypingTarget,
  markToolCancelConsumed,
  PolygonEditor,
  type SelectionAffordanceProps,
  useEditor,
  useInteractionScope,
  visibleScene,
} from '@pascal-app/editor'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRockPolygonSession } from './edit-session'
import { snapRockPlacementPoint } from './placement'

/** The handles' rise above the ground the rock stands on. */
const ROCK_EDIT_RISE = 0.02

/** Live preview and cancellation stay kind-owned; the shared editor only supplies the handles. */
export function RockBoundaryEditor({ rockId }: { rockId: RockNode['id'] }) {
  const rock = useScene((state) => {
    const node = state.nodes[rockId]
    return node?.type === 'rock' ? node : null
  })
  const site = useScene((state) =>
    rock?.parentId ? state.nodes[rock.parentId as AnyNodeId] : undefined,
  )
  useLiveTerrain((state) => (rock?.parentId ? state.fieldOf(rock.parentId) : undefined))
  const scene = useThree((state) => state.scene)
  const gesture = useRef<ReturnType<typeof beginGesture> | null>(null)
  const session = useRef<ReturnType<typeof createRockPolygonSession> | null>(null)
  const currentEpoch = useRef(0)
  const [epoch, setEpoch] = useState(0)
  const mounted = useRef(false)
  const clear = useCallback(() => {
    useLiveNodeOverrides.getState().clear(rockId)
    useScene.getState().markDirty(rockId)
  }, [rockId])
  const cancel = useCallback(() => {
    if (!gesture.current?.active) return
    markToolCancelConsumed()
    gesture.current.cancel()
  }, [])
  const start = useCallback(() => {
    if (!mounted.current || epoch !== currentEpoch.current) return
    const node = useScene.getState().nodes[rockId]
    if (node?.type !== 'rock') return
    session.current = createRockPolygonSession(node)
    gesture.current = beginGesture({
      kind: 'rock-boundary',
      scope: boundaryReshapeScope(rockId),
      onCancel: () => {
        // Invalidate this editor's callbacks synchronously, including late release events.
        // The next keyed editor gets fresh callbacks; no effect resets an old cancellation.
        currentEpoch.current++
        session.current = null
        clear()
        // PolygonEditor owns an internal preview; remounting drops it without a write.
        if (mounted.current) setEpoch(currentEpoch.current)
      },
      stale: () => useScene.getState().nodes[rockId]?.type !== 'rock',
    })
    gesture.current.trackOverride(rockId)
  }, [rockId, clear, epoch])
  const preview = useCallback(
    (polygon: ReadonlyArray<readonly [number, number]> | null) => {
      if (!mounted.current || epoch !== currentEpoch.current) return
      if (!polygon) return clear()
      session.current?.preview(polygon.map(([x, z]) => [x, z]))
    },
    [clear, epoch],
  )
  const commit = useCallback(
    (polygon: [number, number][]) => {
      if (!mounted.current || epoch !== currentEpoch.current) return
      const node = useScene.getState().nodes[rockId]
      if (node?.type !== 'rock') return
      // Double-click deletion has no drag lifecycle, but still validates and commits once.
      const edit = session.current ?? createRockPolygonSession(node)
      edit.preview(polygon)
      if (gesture.current?.active) gesture.current.finish(edit.commit)
      else edit.commit()
      session.current = null
    },
    [rockId, epoch],
  )
  useEffect(() => {
    mounted.current = true
    // Effect replay or a changed node can reuse this component after cleanup revoked
    // its callbacks. Give the mounted editor the current generation again.
    setEpoch(currentEpoch.current)
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return
      if (!gesture.current?.active) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    // Installed before a drag begins: suppress the shared editor's pointercancel commit.
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
    emitter.on('tool:cancel', cancel)
    return () => {
      mounted.current = false
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
      emitter.off('tool:cancel', cancel)
      currentEpoch.current++
      gesture.current?.cancel('unmount')
      clear()
    }
  }, [cancel, clear])
  if (!rock) return null
  const ground =
    rockSpan(
      rock,
      site?.type === 'site' ? terrainFieldOf(site) : null,
      site?.type === 'site' ? FLAT_GROUND_Y : 0,
    ).footY + ROCK_EMBED
  // The editor stands on the rock's ground. Its `surfaceHeight` is the rise of the edited surface
  // above the editor's own base, not an elevation: given the ground's elevation, every handle
  // became a post from the world datum up to the ground.
  return createPortal(
    <group position={[0, ground, 0]} userData={{ pascalExport: 'strip' }}>
      <PolygonEditor
        allowEdgeMove
        allowPolygonMove
        color={BOUNDARY_OUTLINE_COLOR}
        key={epoch}
        minVertices={3}
        onDragStart={start}
        onPolygonChange={commit}
        onPolygonPreview={preview}
        polygon={rock.polygon}
        resolvePlanPoint={({ rawPoint, nativeEvent }) =>
          snapRockPlacementPoint(rawPoint, nativeEvent?.altKey)
        }
        surfaceHeight={ROCK_EDIT_RISE}
      />
    </group>,
    scene,
  )
}

/** Selection is the main registry's generic mounting seam, unlike the old boundary-edit slot. */
export default function RockSelectionAffordance({ node, readOnly }: SelectionAffordanceProps) {
  const mode = useEditor((state) => state.mode)
  const view = useEditor(visibleScene)
  const allowed = useInteractionScope(
    ({ scope }) =>
      scope.kind === 'idle' ||
      (scope.kind === 'reshaping' &&
        scope.nodeId === node.id &&
        scope.reshape === 'boundary' &&
        scope.driver === 'tool'),
  )
  if (readOnly || node.type !== 'rock' || mode !== 'select' || view === '2d' || !allowed)
    return null
  return <RockBoundaryEditor rockId={node.id} />
}
