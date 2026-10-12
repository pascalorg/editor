'use client'
import { emitter, type SlabFeatureNode, useScene } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useFloorplanRender,
  useInteractionScope,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { createSlabFeaturePlacementSession } from './placement'

export default function SlabFeatureFloorplanTool(props: FloorplanToolContext) {
  const node = useInteractionScope((s) =>
    s.scope.kind === 'placing' && s.scope.view === '2d' && s.scope.node.type === 'slab-feature'
      ? s.scope.node
      : null,
  )
  return node ? <Placement key={node.id} node={node} {...props} /> : null
}
function Placement({
  node,
  sceneApi,
  selectNode,
  finishTool,
}: FloorplanToolContext & { node: SlabFeatureNode }) {
  const ref = useRef<SVGGElement>(null),
    context = useFloorplanRender()
  const [failure, setFailure] = useState<{ point: [number, number]; message: string } | null>(null)
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement
    if (!svg) return
    const session = createSlabFeaturePlacementSession(node, sceneApi)
    let ended = false,
      frame: number | null = null,
      last: PointerEvent | null = null,
      down: [number, number] | null = null
    const owns = () => {
      const s = useInteractionScope.getState().scope
      return s.kind === 'placing' && s.nodeId === node.id && s.view === '2d'
    }
    const update = (event: PointerEvent) => {
      if (ended || !owns()) return
      const matrix = ref.current?.getScreenCTM()
      if (!matrix) return
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()),
        point: [number, number] = [raw.x, raw.y]
      const proposal = session.update(point, event.altKey)
      usePlacementPreview.getState().set(proposal?.placement ? proposal.node : null)
      setFailure(
        proposal?.placement
          ? null
          : { point, message: proposal?.error ?? 'Point inside the selected slab.' },
      )
    }
    const cancel = () => {
      if (ended) return
      ended = true
      session.cancel()
      markToolCancelConsumed()
      if (owns()) {
        useInteractionScope.getState().end()
        finishTool()
      }
    }
    const claim = (event: PointerEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const queue = (event: PointerEvent) => {
      if (event.buttons & 6) return
      last = event
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (last) update(last)
      })
    }
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || !owns()) return
      claim(event)
      down = [event.clientX, event.clientY]
    }
    const release = (event: PointerEvent) => {
      if (event.button !== 0 || !down || !owns()) return
      claim(event)
      const clicked = Math.hypot(event.clientX - down[0], event.clientY - down[1]) < 5
      down = null
      if (!clicked) return
      update(event)
      try {
        const id = session.commit()
        if (!id) return
        ended = true
        selectNode(id)
        triggerSFX('sfx:item-place')
        useInteractionScope.getState().endIf((s) => s.kind === 'placing' && s.nodeId === node.id)
        finishTool()
      } catch (err) {
        setFailure({
          point: [0, 0],
          message: err instanceof Error ? err.message : 'Invalid placement.',
        })
      }
    }
    const refresh = (event: KeyboardEvent) => {
      if (last && (event.key === 'Alt' || event.key === 'Shift'))
        update({
          clientX: last.clientX,
          clientY: last.clientY,
          altKey: event.altKey,
        } as PointerEvent)
    }
    const stop = useScene.subscribe((s) => {
      if (s.readOnly || !s.nodes[node.parentId as keyof typeof s.nodes]) cancel()
    })
    svg.addEventListener('pointermove', queue)
    svg.addEventListener('pointerdown', press, true)
    svg.addEventListener('pointerup', release, true)
    window.addEventListener('keyup', refresh)
    window.addEventListener('keydown', refresh)
    emitter.on('tool:cancel', cancel)
    return () => {
      ended = true
      if (frame !== null) cancelAnimationFrame(frame)
      session.cancel()
      stop()
      svg.removeEventListener('pointermove', queue)
      svg.removeEventListener('pointerdown', press, true)
      svg.removeEventListener('pointerup', release, true)
      window.removeEventListener('keyup', refresh)
      window.removeEventListener('keydown', refresh)
      emitter.off('tool:cancel', cancel)
    }
  }, [node, sceneApi, selectNode, finishTool])
  return (
    <g ref={ref} pointerEvents="none">
      {failure && context && (
        <text
          x={failure.point[0]}
          y={failure.point[1]}
          fontSize={context.unitsPerPixel * 12}
          fill="#ef4444"
        >
          {failure.message}
        </text>
      )}
    </g>
  )
}
