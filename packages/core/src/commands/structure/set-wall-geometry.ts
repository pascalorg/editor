import { type AnyNodeId, WallNode } from '../../schema'
import { planWallJustification } from '../../systems/wall/wall-frame'
import { getPlannedLinkedWallUpdates, planWallMoveJunctions } from '../../systems/wall/wall-move'
import { WALL_MIN_LENGTH } from '../../systems/wall/wall-topology'
import { planAttachedWallChanges } from './attached-walls'
import {
  applyToScratch,
  conflict,
  diffStructure,
  type Point,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
} from './shared'
import { retypeOutlineBridges, trimWallOverlaps } from './wall-overlap'

export function setWallGeometry(
  nodes: StructureNodes,
  input: {
    wallId: string
    start?: Point
    end?: Point
    thickness?: number
    justification?: 'a' | 'b' | null
    mintId: StructureMintId
  },
): StructurePlan {
  const original = nodes[input.wallId]
  if (original?.type !== 'wall') throw Error('Select a wall.')
  let scratch = { ...nodes }
  if (input.justification !== undefined)
    scratch = applyToScratch(scratch, {
      create: [],
      delete: [],
      update: planWallJustification(nodes, original.id, input.justification ?? undefined),
    })
  const wall = scratch[original.id] as WallNode
  const start = input.start ?? wall.start,
    end = input.end ?? wall.end
  const next = WallNode.parse({
    ...wall,
    start,
    end,
    ...(input.thickness !== undefined ? { thickness: input.thickness } : {}),
  })
  if (
    !(
      [...start, ...end].every(Number.isFinite) &&
      Math.hypot(end[0] - start[0], end[1] - start[1]) >= 0.05 &&
      (next.thickness ?? 0.1) > 0
    )
  )
    throw Error('Invalid wall geometry.')
  if (input.start || input.end) {
    const linked = Object.values(scratch).filter(
      (n): n is WallNode => n.type === 'wall' && n.parentId === wall.parentId && n.id !== wall.id,
    )
    const plan = planWallMoveJunctions(linked, wall.start, wall.end, start, end)
    const consumed = plan.wallsToDelete.map((n) => n.id)
    const hosted = Object.values(scratch).filter((n) =>
      consumed.includes(n.parentId as WallNode['id']),
    )
    if (hosted.length)
      return conflict(
        'hosted-openings',
        hosted.map((n) => n.id),
        'Moving this junction would remove a wall with hosted objects.',
      )
    const linkedUpdates = getPlannedLinkedWallUpdates(plan, wall.start, wall.end, start, end)
    // A jog shorter than a wall can be (the wall landed on the line it left)
    // is no wall: the walls already meet there.
    const bridges = plan.bridgePlans.flatMap((bridge) => {
      const to = bridge.movedEndpoint === 'start' ? start : end
      return Math.hypot(to[0] - bridge.originalPoint[0], to[1] - bridge.originalPoint[1]) <
        WALL_MIN_LENGTH
        ? []
        : [
            {
              node: WallNode.parse({
                ...bridge.wall,
                id: input.mintId('wall'),
                children: [],
                start: bridge.originalPoint,
                end: to,
              }),
              parentId: wall.parentId as AnyNodeId,
            },
          ]
    })
    scratch = applyToScratch(scratch, {
      update: linkedUpdates.map(({ id, ...data }) => ({ id, data })),
      delete: consumed,
      create: bridges,
    })
    scratch[wall.id] = next
    // Walls T'd into it stay on it, stretched along their own line.
    const attached = planAttachedWallChanges(
      scratch,
      wall.id,
      wall.start,
      wall.end,
      start,
      end,
      new Set([...consumed, ...linkedUpdates.map(({ id }) => id)]),
    )
    scratch = applyToScratch(scratch, { update: attached, delete: [], create: [] })
    // The moved wall, the walls it stretched and its jogs take over any
    // stretch of a parallel wall they now run along; jogs left on the outline
    // are outside walls.
    const bridgeIds = bridges.map(({ node }) => node.id)
    retypeOutlineBridges(scratch, wall.id, bridgeIds)
    const blocked = trimWallOverlaps(
      scratch,
      [
        wall.id,
        ...linkedUpdates.map(({ id }) => id).filter((id) => scratch[id]),
        ...attached.flatMap(({ id }) => (scratch[id]?.type === 'wall' ? [id] : [])),
        ...bridgeIds,
      ],
      () => input.mintId('wall'),
    )
    if (blocked) return conflict(blocked.code, blocked.nodeIds, blocked.message)
    return { changes: diffStructure(nodes, scratch) }
  }
  scratch[wall.id] = next
  return { changes: diffStructure(nodes, scratch) }
}
