'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { type FloorplanToolContext, useInteractionScope } from '@pascal-app/editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clientToPlanPoint,
  collectSnapTargets,
  consumeEvent,
  DEFAULT_OVERHEAD_HEIGHT,
  nearestSnapTarget,
  type PlanPoint,
  planToSite,
  readLineDefaults,
  resolveToolFrame,
  siteToPlan,
  type SnapTarget,
  snapPlanPoint,
} from '../tool-support'
import { DEFAULT_BURIAL_DEPTH, SYSTEM_COLOR, UtilityLineNode } from '../schema'

type Vertex = { site: PlanPoint; plan: PlanPoint; elevation: number; ref: string | null }

/**
 * Draw a utility run: click each vertex, double-click (or Enter) to finish.
 *
 * System and routing come from `toolDefaults['utility-line']`, which the
 * Utilities panel seeds before activating the tool — the panel IS the tool
 * bar here (there is no plugin hook for adding controls to the host's
 * floating tool bar, so the choice lives beside the placement buttons).
 *
 * Endpoints snap to poles and service points within 2 m, and a snapped
 * endpoint records the target's node id in `fromRef` / `toRef` and takes its
 * attachment height, so an overhead drop lands on the crossarm rather than
 * at a guessed elevation. Underground vertices are stored at
 * `DEFAULT_BURIAL_DEPTH` (negative), the depth field the panel then edits.
 */
export default function FloorplanUtilityLineToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
  toolDefaults,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const verticesRef = useRef<Vertex[]>([])
  const [vertices, setVertices] = useState<Vertex[]>([])
  const [cursor, setCursor] = useState<PlanPoint | null>(null)

  const { system, routing } = useMemo(() => readLineDefaults(toolDefaults), [toolDefaults])
  const color = SYSTEM_COLOR[system]

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'utility-line' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'utility-line')
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const readVertex = (event: MouseEvent | PointerEvent): Vertex | null => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const { frame, planFrame } = resolveToolFrame(sceneApi, activeLevelId)
      const snappedPlan = snapPlanPoint(raw, event.altKey, gridSnapStep)
      const site = planToSite(planFrame, snappedPlan)
      const targets: SnapTarget[] = collectSnapTargets(sceneApi, frame)
      const target = event.altKey ? null : nearestSnapTarget(targets, site)
      if (target) {
        return {
          site: target.site,
          plan: siteToPlan(planFrame, target.site),
          elevation:
            routing === 'overhead' ? target.overheadHeight : Math.min(0, DEFAULT_BURIAL_DEPTH),
          ref: target.id,
        }
      }
      return {
        site,
        plan: snappedPlan,
        elevation: routing === 'overhead' ? DEFAULT_OVERHEAD_HEIGHT : DEFAULT_BURIAL_DEPTH,
        ref: null,
      }
    }

    const commit = () => {
      const drawn = verticesRef.current
      if (drawn.length < 2) return
      const { buildingId } = resolveToolFrame(sceneApi, activeLevelId)
      const node = UtilityLineNode.parse({
        name: 'Utility line',
        system,
        routing,
        path: drawn.map((v) => [v.site[0], v.elevation, v.site[1]]),
        fromRef: drawn[0]?.ref ?? null,
        toRef: drawn[drawn.length - 1]?.ref ?? null,
      })
      sceneApi.upsert(node as unknown as AnyNode, buildingId ?? undefined)
      selectNode(node.id as AnyNodeId)
      verticesRef.current = []
      setVertices([])
      finishTool()
    }

    const onPointerMove = (event: PointerEvent) => {
      const vertex = readVertex(event)
      if (vertex) setCursor(vertex.plan)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.detail > 1) return
      consumeEvent(event)
      const vertex = readVertex(event)
      if (!vertex) return
      const last = verticesRef.current[verticesRef.current.length - 1]
      // Ignore a repeat click on the vertex just placed.
      if (last && Math.hypot(vertex.site[0] - last.site[0], vertex.site[1] - last.site[1]) < 0.05) {
        return
      }
      verticesRef.current = [...verticesRef.current, vertex]
      setVertices(verticesRef.current)
    }
    const onDoubleClick = (event: MouseEvent) => {
      consumeEvent(event)
      // The dblclick lands after two clicks, so the final vertex is already in.
      commit()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
        return
      }
      if (event.key !== 'Escape') return
      if (verticesRef.current.length > 0) {
        verticesRef.current = verticesRef.current.slice(0, -1)
        setVertices(verticesRef.current)
      } else finishTool()
    }

    svg.addEventListener('pointermove', onPointerMove)
    svg.addEventListener('click', onClick, { capture: true })
    svg.addEventListener('dblclick', onDoubleClick, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      svg.removeEventListener('pointermove', onPointerMove)
      svg.removeEventListener('click', onClick, { capture: true } as EventListenerOptions)
      svg.removeEventListener('dblclick', onDoubleClick, { capture: true } as EventListenerOptions)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeLevelId, finishTool, gridSnapStep, routing, sceneApi, selectNode, system])

  const preview: PlanPoint[] = cursor
    ? [...vertices.map((v) => v.plan), cursor]
    : vertices.map((v) => v.plan)

  return (
    <g pointerEvents="none" ref={groupRef}>
      {preview.length >= 2 ? (
        <polyline
          fill="none"
          points={preview.map((p) => `${p[0]},${p[1]}`).join(' ')}
          stroke={color}
          strokeDasharray={routing === 'underground' ? '0.6 0.35' : undefined}
          strokeWidth={0.11}
        />
      ) : null}
      {vertices.map((vertex) => (
        <circle
          cx={vertex.plan[0]}
          cy={vertex.plan[1]}
          fill={vertex.ref ? '#ffffff' : color}
          key={`${vertex.plan[0]}:${vertex.plan[1]}`}
          r={vertex.ref ? 0.16 : 0.1}
          stroke={color}
          strokeWidth={0.05}
        />
      ))}
    </g>
  )
}
