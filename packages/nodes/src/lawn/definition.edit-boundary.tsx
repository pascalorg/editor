'use client'

import { emitter, type LawnNode, resolveSiteGround, useScene } from '@pascal-app/core'
import {
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
import { createLawnOutlineSession } from './definition.edit-session'
import { snapLawnPoint } from './placement'

type BoundaryRuntime = {
  gesture: ReturnType<typeof beginGesture> | null
  session: ReturnType<typeof createLawnOutlineSession> | null
  generation: number
  mounted: boolean
}

function startLawnBoundary(
  id: LawnNode['id'],
  runtime: BoundaryRuntime,
  epoch: number,
  invalidate: () => void,
) {
  if (epoch !== runtime.generation) return
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'lawn') return
  runtime.session = createLawnOutlineSession(node)
  runtime.gesture = beginGesture({
    kind: 'lawn-outline',
    scope: boundaryReshapeScope(node.id),
    onCancel: () => {
      runtime.session?.clear()
      runtime.session = null
      runtime.generation++
      if (runtime.mounted) invalidate()
    },
    stale: () => useScene.getState().nodes[node.id]?.type !== 'lawn',
  })
  runtime.gesture.trackOverride(node.id)
}

function previewLawnBoundary(
  runtime: BoundaryRuntime,
  epoch: number,
  polygon: ReadonlyArray<readonly [number, number]> | null,
) {
  if (epoch !== runtime.generation) return
  if (polygon) runtime.session?.preview(polygon.map(([x, z]) => [x, z]))
  else runtime.session?.clear()
}

function commitLawnBoundary(
  id: LawnNode['id'],
  runtime: BoundaryRuntime,
  epoch: number,
  polygon: [number, number][],
) {
  if (epoch !== runtime.generation) return
  const current = useScene.getState().nodes[id]
  if (current?.type !== 'lawn') return
  const edit = runtime.session ?? createLawnOutlineSession(current)
  edit.preview(polygon)
  if (runtime.gesture?.active) runtime.gesture.finish(edit.commit)
  else edit.commit()
  runtime.session = null
}

function installBoundaryLifecycle(
  runtime: BoundaryRuntime,
  cancel: () => void,
  invalidate: () => void,
) {
  runtime.mounted = true
  invalidate()
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isTypingTarget(event.target) || !runtime.gesture?.active) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  window.addEventListener('keydown', key, true)
  window.addEventListener('pointercancel', cancel, true)
  emitter.on('tool:cancel', cancel)
  return () => {
    runtime.mounted = false
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('pointercancel', cancel, true)
    emitter.off('tool:cancel', cancel)
    runtime.gesture?.cancel('unmount')
    runtime.session?.clear()
    runtime.generation++
  }
}

function useLawnBoundaryEditing(id: LawnNode['id']) {
  const runtime = useRef<BoundaryRuntime>({
    gesture: null,
    session: null,
    generation: 0,
    mounted: false,
  })
  const [epoch, setEpoch] = useState(0)
  const invalidate = useCallback(() => setEpoch(runtime.current.generation), [])
  const cancel = useCallback(() => {
    if (!runtime.current.gesture?.active) return
    markToolCancelConsumed()
    runtime.current.gesture.cancel()
  }, [])
  useEffect(
    () => installBoundaryLifecycle(runtime.current, cancel, invalidate),
    [cancel, invalidate],
  )
  return {
    epoch,
    start: () => startLawnBoundary(id, runtime.current, epoch, invalidate),
    preview: (polygon: ReadonlyArray<readonly [number, number]> | null) =>
      previewLawnBoundary(runtime.current, epoch, polygon),
    commit: (polygon: [number, number][]) =>
      commitLawnBoundary(id, runtime.current, epoch, polygon),
  }
}

function LawnBoundaryEditor({ lawn }: { lawn: LawnNode }) {
  const scene = useThree((state) => state.scene)
  const edit = useLawnBoundaryEditing(lawn.id)
  const ground = resolveSiteGround(lawn.parentId ?? undefined, useScene.getState().nodes)
  const first = lawn.outline[0]
  // The editor stands on the lawn's ground; `surfaceHeight` is a rise above the editor's own base,
  // not an elevation (given one, every handle became a post from the world datum up to the ground).
  return createPortal(
    <group
      position={[0, first ? ground.heightAt(first[0], first[1]) : 0, 0]}
      userData={{ pascalExport: 'strip' }}
    >
      <PolygonEditor
        key={edit.epoch}
        polygon={lawn.outline}
        minVertices={3}
        allowEdgeMove
        color="#617c36"
        onDragStart={edit.start}
        onPolygonPreview={edit.preview}
        onPolygonChange={edit.commit}
        resolvePlanPoint={({ rawPoint, nativeEvent }) =>
          snapLawnPoint(rawPoint, nativeEvent?.altKey)
        }
        surfaceHeight={0.04}
      />
    </group>,
    scene,
  )
}

export default function LawnSelectionAffordance({ node, readOnly }: SelectionAffordanceProps) {
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
  const live = useScene((state) => state.nodes[node.id])
  if (readOnly || live?.type !== 'lawn' || mode !== 'select' || view === '2d' || !allowed)
    return null
  return <LawnBoundaryEditor lawn={live} />
}
