import { refuse } from '../agent-tools/refusal'
import { addRoofElementTool } from '../agent-tools/roof-elements'
import { roofSegmentFrame } from '../lib/roof-frame'
import {
  getRoofSegmentCoveringSeat,
  pickRoofCoveringSeat,
  type RoofSurfaceResult,
  type RoofSurfaceSeat,
} from '../lib/roof-surface'
import {
  type AnyNode,
  buildRoofElementNode,
  type RoofElementKind,
  type RoofNode,
  type RoofSegmentNode,
} from '../schema'
import { levelIdOf } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

export type AddRoofElementInput = {
  kind: RoofElementKind
  id: string
  point: number[]
  rows?: number
  columns?: number
  name?: string
}
type Point = [number, number]

function host(nodes: SceneNodes, id: string): { roof: RoofNode; segment?: RoofSegmentNode } {
  const target = nodes[id]
  if (!target) refuse('node_not_found', `Node not found: ${id}.`, { id })
  if (target.type !== 'roof' && target.type !== 'roof-segment')
    refuse('roof_target_invalid', `Node ${id} is not a roof or roof segment.`, { id })
  const segment = target.type === 'roof-segment' ? target : undefined
  const roof = segment ? nodes[segment.parentId ?? ''] : target
  if (roof?.type !== 'roof' || (segment && !roof.children.includes(segment.id)))
    refuse('roof_parent_missing', `Roof segment ${id} has no reciprocal owning roof.`, {
      id,
      ...(segment ? { segmentId: segment.id } : {}),
    })
  for (const childId of roof.children) {
    const child = nodes[childId]
    if (child?.type === 'roof-segment' && child.parentId !== roof.id)
      refuse('roof_parent_missing', `Roof ${roof.id} lists a segment owned by another roof.`, {
        id,
      })
  }
  const levelId = levelIdOf(nodes, roof.id)
  if (!levelId || nodes[levelId]?.type !== 'level')
    refuse('roof_level_missing', `Roof ${roof.id} has no owning level.`, { id: roof.id })
  const seen = new Set<string>()
  let ancestor: AnyNode | undefined = nodes[levelId]
  while (ancestor && !seen.has(ancestor.id)) {
    seen.add(ancestor.id)
    if (ancestor.type === 'building') {
      const [x, y, z] = ancestor.rotation
      if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 1e-8 || Math.abs(z) > 1e-8)
        refuse(
          'roof_transform_unsupported',
          'Roof plan placement needs a horizontal building frame.',
          { id },
        )
    }
    ancestor = nodes[ancestor.parentId ?? '']
  }
  return { roof, segment }
}

function requireSeat(
  result: RoofSurfaceResult<RoofSurfaceSeat>,
  id: string,
  point: Point,
  segmentId?: string,
): RoofSurfaceSeat {
  if (result.status === 'supported') return result.value
  if (result.status === 'unmeasured')
    refuse('roof_surface_unmeasured', 'The physical roof covering is unresolved at this point.', {
      id,
      reason: result.reason,
      nodeIds: result.nodeIds,
    })
  if (result.reason === 'invalid-query')
    refuse('roof_point_invalid', 'The roof plan point must contain two finite coordinates [x, z].')
  if (result.reason === 'invalid-host')
    refuse('roof_parent_missing', 'The roof segment has no reciprocal owning roof.', {
      id,
      ...(segmentId ? { segmentId } : {}),
    })
  refuse('roof_point_outside_segment', `No physical roof covering exists at [${point}].`, {
    id,
    ...(segmentId ? { segmentId } : {}),
    point,
    reason: 'outside-surface',
  })
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

export const addRoofElement: AgentOperation<AddRoofElementInput> = (nodes, input) => {
  const schema = addRoofElementTool.input
  if (!schema.id.safeParse(input.id).success)
    refuse('roof_target_invalid', 'A roof or roof-segment id is required.', { id: input.id })
  const parsedPoint = schema.point.safeParse(input.point)
  if (!parsedPoint.success)
    refuse('roof_point_invalid', 'The roof plan point must contain two finite coordinates [x, z].')
  if (
    !schema.kind.safeParse(input.kind).success ||
    !schema.name.safeParse(input.name).success ||
    !schema.rows.safeParse(input.rows).success ||
    !schema.columns.safeParse(input.columns).success
  )
    refuse(
      'roof_element_options_invalid',
      'Choose a native accessory, a nonempty name and integer solar counts from 1 to 20.',
    )
  const point = parsedPoint.data as Point
  const { roof, segment } = host(nodes, input.id)
  const seat = requireSeat(
    segment
      ? getRoofSegmentCoveringSeat(
          roof,
          segment,
          roofSegmentFrame(roof, segment).toLocal(point),
          nodes,
        )
      : pickRoofCoveringSeat(roof, point, nodes),
    input.id,
    point,
    segment?.id,
  )
  const node = buildRoofElementNode(input.kind, seat.segment, seat.position, {
    name: input.name,
    rows: input.rows,
    columns: input.columns,
  })
  if (!node)
    refuse('roof_no_ridge_line', 'This segment has no native ridge line for a ridge vent.', {
      segmentId: seat.segment.id,
    })
  const localPoint: Point = [node.position[0], node.position[2]]
  const achieved = roofSegmentFrame(roof, seat.segment).toPlan(localPoint)
  if (node.type === 'ridge-vent')
    requireSeat(
      getRoofSegmentCoveringSeat(roof, seat.segment, localPoint, nodes),
      input.id,
      achieved,
      seat.segment.id,
    )
  return {
    result: {
      ok: true,
      id: node.id,
      kind: node.type,
      roofId: roof.id,
      segmentId: seat.segment.id,
      localPosition: node.position.map(round3),
      rotation: round3(node.rotation),
      planPoint: achieved.map(round3),
      message: `Added ${node.name} on roof segment ${seat.segment.id}`,
    },
    changes: { create: [{ node, parentId: seat.segment.id }] },
  }
}
