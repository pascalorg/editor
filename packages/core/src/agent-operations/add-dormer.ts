import { z } from 'zod'
import { addDormerTool } from '../agent-tools/dormers'
import { refuse } from '../agent-tools/refusal'
import { type DormerCreationPlan, planDormerCreation } from '../lib/dormer-placement'
import { containsPoint } from '../lib/polygon-boolean'
import { roofSegmentFrame } from '../lib/roof-frame'
import { pickRoofCoveringSeat } from '../lib/roof-surface'
import { isSiteFlatwork } from '../lib/site-flatwork'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, RoofNode, RoofSegmentNode, SlabNode, ZoneNode } from '../schema'
import { finishSurface, requireMaterialRef } from './material-refs'
import type { AgentOperation, SceneNodes } from './types'

const inputSchema = z.object(addDormerTool.input)
export type AddDormerInput = z.output<typeof inputSchema>
type Point = [number, number]

/** Resolve ownership and the coordinate frame before asking any geometry reader. */
function host(nodes: SceneNodes, input: AddDormerInput) {
  if (!input.segmentId && !input.roofId)
    refuse('roof_host_required', 'Name segmentId, or roofId with a level-plan point at.')
  const segment = input.segmentId ? nodes[input.segmentId] : undefined
  if (input.segmentId && segment?.type !== 'roof-segment')
    refuse('invalid_roof_host', 'segmentId must name an existing roof segment.', {
      segmentId: input.segmentId,
    })
  const roof = input.roofId ? nodes[input.roofId] : nodes[segment?.parentId ?? '']
  if (
    roof?.type !== 'roof' ||
    (segment && (segment.parentId !== roof.id || !roof.children.includes(segment.id)))
  )
    refuse('invalid_roof_host', 'The segment and roof must name one reciprocal owning host.', {
      roofId: input.roofId,
      segmentId: input.segmentId,
    })
  for (const id of roof.children) {
    const child = nodes[id]
    if (child?.type === 'roof-segment' && child.parentId !== roof.id)
      refuse('invalid_roof_host', 'A listed roof segment belongs to another roof.', {
        roofId: roof.id,
        segmentId: id,
      })
  }
  const level = nodes[roof.parentId ?? '']
  if (level?.type !== 'level')
    refuse('invalid_roof_host', 'The owning roof must stand on a level.', { roofId: roof.id })
  const seen = new Set<string>()
  let ancestor: AnyNode | undefined = level
  while (ancestor) {
    if (seen.has(ancestor.id))
      refuse('invalid_roof_host', 'The roof ancestry contains a cycle.', { roofId: roof.id })
    seen.add(ancestor.id)
    if (ancestor.type === 'building') {
      const [x, y, z] = ancestor.rotation
      if (
        ![...ancestor.position, x, y, z].every(Number.isFinite) ||
        Math.abs(x) > 1e-8 ||
        Math.abs(z) > 1e-8
      )
        refuse('invalid_roof_host', 'Dormer placement needs a horizontal building frame.', {
          roofId: roof.id,
          reason: 'unsupported-transform',
        })
    }
    ancestor = nodes[ancestor.parentId ?? '']
  }
  return {
    roof,
    segment: segment as RoofSegmentNode | undefined,
    level,
  }
}

function selectSegment(nodes: SceneNodes, roof: RoofNode, at: Point): RoofSegmentNode {
  const seat = pickRoofCoveringSeat(roof, at, nodes)
  if (seat.status === 'supported') return seat.value.segment
  if (seat.status === 'unmeasured')
    refuse('dormer_geometry_unmeasured', 'The physical roof covering is unresolved here.', {
      roofId: roof.id,
      reason: seat.reason,
      nodeIds: seat.nodeIds,
    })
  refuse('not_on_slope', 'No physical roof slope lies under the requested plan point.', {
    roofId: roof.id,
    at,
    reason: seat.reason,
  })
}

/** Room and floor facts are independent: neither is evidence that the other exists. */
function atticFacts(
  nodes: SceneNodes,
  roof: RoofNode,
  segment: RoofSegmentNode,
  levelId: string,
  plan: DormerCreationPlan,
) {
  const unknown = { atticRoomId: null, windowSillAboveAtticFloorM: null }
  if (nodes[levelId]?.metadata?.attic !== true || plan.exposure.status === 'unmeasured')
    return unknown
  // Exposure already resolves the actual child face-local u/v/normal offset through dormer yaw.
  const centre = roofSegmentFrame(roof, segment).localToLevel(plan.exposure.position)
  const point: Point = [centre[0], centre[2]]
  const room = queryNodes<ZoneNode>(nodes, { type: 'zone', parentId: levelId }).find(
    (zone) =>
      zone.visible !== false && containsPoint([{ outer: zone.polygon, holes: zone.holes }], point),
  )
  let floor: SlabNode | undefined
  for (const slab of queryNodes<SlabNode>(nodes, { type: 'slab', parentId: levelId })) {
    if (
      slab.visible === false ||
      slab.recessed ||
      isSiteFlatwork(slab) ||
      !Number.isFinite(slab.elevation) ||
      !containsPoint([{ outer: slab.polygon, holes: slab.holes }], point)
    )
      continue
    if (!floor || slab.elevation > floor.elevation) floor = slab
  }
  return {
    atticRoomId: room?.id ?? null,
    // Both operands are level-local: building elevation and the level's base cancel exactly.
    windowSillAboveAtticFloorM: floor
      ? Math.round((centre[1] - plan.window.height / 2 - floor.elevation) * 100) / 100
      : null,
  }
}

export const addDormer: AgentOperation<AddDormerInput> = (nodes, input, context) => {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success)
    refuse(
      'invalid_dormer',
      'Supply valid dormer dimensions, profile and finite plan coordinates.',
      {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    )
  const asked = parsed.data
  const { roof, segment: namedSegment, level } = host(nodes, asked)
  if (!namedSegment && !asked.at)
    refuse('position_required', 'With roofId, supply at: a level-plan point [x, z].', {
      roofId: roof.id,
    })
  const segment = namedSegment ?? selectSegment(nodes, roof, asked.at as Point)
  const centre = asked.at
    ? roofSegmentFrame(roof, segment).toLocal(asked.at as Point)
    : ([0, segment.depth / 4] as Point)
  const preset = (value: string | undefined, field: string, role?: string) =>
    value === undefined
      ? undefined
      : requireMaterialRef(value, field, finishSurface('dormer', role), {
          materials: context.materials,
        })
  const planned = planDormerCreation(nodes, segment, centre, {
    name: asked.name,
    width: asked.width,
    depth: asked.depth,
    roofType: asked.roofType,
    roofHeight: asked.roofHeight,
    shedHighSide: asked.shedHighSide,
    height: asked.wallHeight,
    windowWidth: asked.windowWidth,
    windowHeight: asked.windowHeight,
    flashing: asked.flashing,
    windowShape: asked.windowShape,
    windowArchHeight: asked.windowArchHeight,
    windowColumns: asked.windowColumns,
    windowRows: asked.windowRows,
    windowSill: asked.windowSill,
    materialPreset: preset(asked.materialPreset, 'materialPreset'),
    topMaterialPreset: preset(asked.topMaterialPreset, 'topMaterialPreset', 'top'),
    sideMaterialPreset: preset(asked.sideMaterialPreset, 'sideMaterialPreset', 'side'),
    wallMaterialPreset: preset(asked.wallMaterialPreset, 'wallMaterialPreset', 'wall'),
  })
  if (!planned.ok)
    refuse(planned.code, planned.message, {
      ...planned.details,
      reason: planned.reason,
      ...(planned.nodeIds ? { nodeIds: planned.nodeIds } : {}),
    })
  const { dormer, window, placement } = planned.value
  return {
    result: {
      dormerId: dormer.id,
      windowId: window.id,
      roofId: roof.id,
      segmentId: segment.id,
      footprint: placement.planFootprint,
      ...atticFacts(nodes, roof, segment, level.id, planned.value),
      message: `Seated ${dormer.name} with its window on roof segment ${segment.id}.`,
    },
    changes: {
      create: [
        { node: dormer, parentId: segment.id },
        { node: window, parentId: dormer.id },
      ],
    },
  }
}
