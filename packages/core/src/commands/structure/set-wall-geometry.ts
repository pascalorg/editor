import { type AnyNodeId, WallNode } from '../../schema'
import { planWallJustification } from '../../systems/wall/wall-frame'
import { getPlannedLinkedWallUpdates, planWallMoveJunctions } from '../../systems/wall/wall-move'
import {
  applyToScratch,
  conflict,
  diffStructure,
  type Point,
  type StructureMintId,
  type StructureNodes,
  type StructurePlan,
} from './shared'

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
    scratch = applyToScratch(scratch, {
      update: getPlannedLinkedWallUpdates(plan, wall.start, wall.end, start, end).map(
        ({ id, ...data }) => ({ id, data }),
      ),
      delete: consumed,
      create: plan.bridgePlans.map((bridge) => ({
        node: WallNode.parse({
          ...bridge.wall,
          id: input.mintId('wall'),
          children: [],
          start: bridge.originalPoint,
          end: bridge.movedEndpoint === 'start' ? start : end,
        }),
        parentId: wall.parentId as AnyNodeId,
      })),
    })
  }
  scratch[wall.id] = next
  return { changes: diffStructure(nodes, scratch) }
}
