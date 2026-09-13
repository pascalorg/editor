'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { type FloorplanToolContext, useInteractionScope } from '@pascal-app/editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_BURIAL_DEPTH, ServicePointNode, SYSTEM_COLOR, UtilityLineNode } from '../schema'
import { planAutoMeter } from '../service-point/auto-meter'
import { siteToLocalPlan } from '../site-frame'
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
  type SnapTarget,
  siteToPlan,
  snapPlanPoint,
} from '../tool-support'

type Vertex = {
  site: PlanPoint
  plan: PlanPoint
  elevation: number
  ref: string | null
  /** Alt was held for this click — the opt-out for snapping AND auto-meter. */
  altKey: boolean
}

/**
 * Draw a utility run: click each vertex, double-click (or Enter) to finish.
 *
 * System and routing come from `toolDefaults['utility-line']`, which the
 * Utilities panel seeds before activating the tool — the panel IS the tool
 * bar here (there is no plugin hook for adding controls to the host's
 * floating tool bar, so the choice lives beside the placement buttons).
 *
 * Endpoints snap to poles and service points within 2 m and record the
 * target's node id in `fromRef` / `toRef`. From then on that endpoint is
 * DERIVED, not stored: `endpoints.ts` reads it off the pole's crossarm or the
 * meter's anchor on every render, so moving either node moves the run. The
 * elevation written here only ever seeds an UNLINKED end. Underground
 * vertices are stored at `DEFAULT_BURIAL_DEPTH` (negative, a cover below
 * grade), the depth field the panel then edits.
 *
 * AUTO-METER RULE — also documented in the panel and the README:
 *   When the FINAL click of a POWER OVERHEAD run lands within
 *   `METER_SNAP_RADIUS` (1.5 m) of a wall and has not already snapped to a
 *   pole or service point, the run binds to the nearest existing
 *   `electric-meter` on that wall, and CREATES one at the projected `wallT`
 *   if there is none. That is what a service drop is: it terminates at the
 *   meter / weatherhead on the house, never on the ground beside it. Hold Alt
 *   on the final click to opt out — Alt already suppresses snapping and grid.
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
          altKey: event.altKey,
        }
      }
      return {
        site,
        plan: snappedPlan,
        elevation: routing === 'overhead' ? DEFAULT_OVERHEAD_HEIGHT : DEFAULT_BURIAL_DEPTH,
        ref: null,
        altKey: event.altKey,
      }
    }

    /**
     * The auto-meter rule (see the module note). Returns the node id the run
     * should end on, creating the meter when the wall has none — or null when
     * the rule does not apply, leaving the end unlinked.
     */
    const autoMeterFor = (last: Vertex, buildingId: AnyNodeId | null): string | null => {
      if (last.ref || last.altKey) return null
      if (!(routing === 'overhead' && system === 'power')) return null
      const { frame } = resolveToolFrame(sceneApi, activeLevelId)
      const nodes = sceneApi.nodes() as unknown as Record<string, Record<string, unknown>>
      const local = siteToLocalPlan(frame, last.site)
      const plan = planAutoMeter(nodes, local)
      if (plan.kind === 'none') return null
      if (plan.kind === 'bind') return plan.nodeId
      const meter = ServicePointNode.parse({
        name: 'Electric meter',
        serviceKind: 'electric-meter',
        wallId: plan.wallId,
        wallT: plan.wallT,
      })
      sceneApi.upsert(meter as unknown as AnyNode, buildingId ?? undefined)
      return meter.id
    }

    const commit = () => {
      const drawn = verticesRef.current
      if (drawn.length < 2) return
      const { buildingId } = resolveToolFrame(sceneApi, activeLevelId)
      const last = drawn[drawn.length - 1] as Vertex
      const toRef = last.ref ?? autoMeterFor(last, buildingId)
      const node = UtilityLineNode.parse({
        name: 'Utility line',
        system,
        routing,
        // Stored vertices are relative to GRADE — a positive height for an
        // overhead run, a negative cover for a buried one. Linked ends are
        // overwritten at read time by `resolveLineEndpoints`; what is stored
        // for them only matters when the referenced node goes away.
        path: drawn.map((v) => [v.site[0], v.elevation, v.site[1]]),
        fromRef: drawn[0]?.ref ?? null,
        toRef,
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
