'use client'
import { emitter, useScene, type WallFeatureNode } from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useFloorplanRender,
  useInteractionScope,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { wallFeaturePlanPoint } from './floorplan'
import { wallFeaturePlanHit, wallFeaturePlanSnap } from './floorplan-interaction'
import { createWallFeaturePlacementSession } from './placement'

export default function WallFeatureFloorplanTool(props: FloorplanToolContext) {
  const node = useInteractionScope((state) =>
    state.scope.kind === 'placing' &&
    state.scope.view === '2d' &&
    state.scope.node.type === 'wall-feature'
      ? state.scope.node
      : null,
  )
  return node ? <PlanPlacement key={node.id} node={node} {...props} /> : null
}
function PlanPlacement({
  node,
  sceneApi,
  activeLevelId,
  selectNode,
  finishTool,
}: FloorplanToolContext & { node: WallFeatureNode }) {
  const group = useRef<SVGGElement>(null)
  const context = useFloorplanRender()
  const [failure, setFailure] = useState<{ point: [number, number]; message: string } | null>(null)
  useEffect(() => {
    const svg = group.current?.ownerSVGElement
    if (!svg || !activeLevelId) return
    if (useInteractionScope.getState().scope.kind === 'idle')
      useInteractionScope.getState().begin({
        kind: 'placing',
        node,
        nodeId: node.id,
        nodeType: node.type,
        view: '2d',
        driver: 'registry-tool',
        pressDrag: false,
      })
    const session = createWallFeaturePlacementSession(node, sceneApi)
    let down: [number, number] | null = null,
      ended = false,
      last: PointerEvent | null = null,
      frame: number | null = null
    const owns = () => {
      const s = useInteractionScope.getState().scope
      return s.kind === 'placing' && s.nodeId === node.id && s.view === '2d'
    }
    const clear = () => {
      session.cancel()
      usePlacementPreview.getState().clear()
      setFailure(null)
    }
    const cancel = () => {
      if (ended) return
      ended = true
      clear()
      markToolCancelConsumed()
      if (owns()) {
        useInteractionScope.getState().end()
        finishTool()
      }
    }
    const claim = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const update = (event: PointerEvent) => {
      if (ended || !owns()) return
      last = event
      const matrix = group.current?.getScreenCTM()
      if (!matrix) return
      const raw = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const point: [number, number] = [raw.x, raw.y]
      const hit = wallFeaturePlanHit(sceneApi.nodes(), node, point, activeLevelId, node.parentId)
      const proposal = session.update(hit, wallFeaturePlanSnap(event.altKey))
      if (!proposal?.placement) {
        usePlacementPreview.getState().clear()
        setFailure({ point, message: proposal?.error ?? 'Point at the selected wall face.' })
        return
      }
      setFailure(null)
      const p = proposal.placement
      const a = wallFeaturePlanPoint(p, p.bounds.u0, p.mountOffset),
        b = wallFeaturePlanPoint(p, p.bounds.u1, p.mountOffset)
      const c = wallFeaturePlanPoint(p, p.u, p.mountOffset),
        d = wallFeaturePlanPoint(p, p.u, p.surfaceOffset)
      const dimension = (
        id: string,
        start: [number, number],
        end: [number, number],
        value: number,
      ) => ({
        id,
        start: [start[0], p.bottom, start[1]] as [number, number, number],
        end: [end[0], p.bottom, end[1]] as [number, number, number],
        offsetNormal: [p.normal[0], p.normal[2]] as [number, number],
        offsetDistance: 0.2,
        value,
        renderIn3d: false,
        renderInFloorplan: true,
      })
      usePlacementPreview
        .getState()
        .set(
          proposal.node,
          sceneApi.get(proposal.node.parentId as Parameters<typeof sceneApi.get>[0]) ?? null,
          [
            dimension('feature:width', a, b, node.width),
            dimension('feature:depth', c, d, node.depth),
          ],
        )
    }
    const queue = (e: PointerEvent) => {
      if (e.buttons & 6) return
      last = e
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (last) update(last)
      })
    }
    const press = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return
      claim(e)
      down = [e.clientX, e.clientY]
    }
    const release = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      claim(e)
      const click = Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5
      down = null
      if (!click) return
      update(e)
      try {
        const id = session.commit()
        if (!id) return
        ended = true
        usePlacementPreview.getState().clear()
        selectNode(id)
        triggerSFX('sfx:item-place')
        useInteractionScope.getState().endIf((s) => s.kind === 'placing' && s.nodeId === node.id)
        finishTool()
      } catch {
        cancel()
      }
    }
    const refresh = (e: KeyboardEvent) => {
      if (last && (e.key === 'Shift' || e.key === 'Alt'))
        update({ clientX: last.clientX, clientY: last.clientY, altKey: e.altKey } as PointerEvent)
    }
    const stop = useScene.subscribe((state) => {
      if (state.readOnly || !state.nodes[node.parentId as Parameters<typeof sceneApi.get>[0]])
        cancel()
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
      clear()
      stop()
      svg.removeEventListener('pointermove', queue)
      svg.removeEventListener('pointerdown', press, true)
      svg.removeEventListener('pointerup', release, true)
      window.removeEventListener('keyup', refresh)
      window.removeEventListener('keydown', refresh)
      emitter.off('tool:cancel', cancel)
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'placing' && s.nodeId === node.id && s.view === '2d')
    }
  }, [node, sceneApi, activeLevelId, selectNode, finishTool])
  if (!context) return null
  return (
    <g ref={group} pointerEvents="none">
      {failure && (
        <g transform={`translate(${failure.point[0]} ${failure.point[1]})`}>
          <circle r={context.unitsPerPixel * 5} fill="#ef4444" />
          <text
            x={context.unitsPerPixel * 10}
            fontSize={context.unitsPerPixel * 12}
            fill="#ef4444"
            transform={`rotate(${-context.sceneRotationDeg})`}
          >
            {failure.message}
          </text>
        </g>
      )}
    </g>
  )
}
