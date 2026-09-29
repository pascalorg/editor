import { floorPlateAtGroundContact, footprintLift } from '../../lib/floor-foundation-datum'
import {
  levelConstructionDisplacements,
  upperStoreyFootprints,
} from '../../lib/floor-foundation-stack'
import { roundFloorElevation } from '../../lib/room-floor-feasibility'
import type { SlabNode } from '../../schema'
import { getAuthoredLevelElevations, getLevelElevations } from '../../services/storey'
import type { StructureNodes, StructurePlan } from './shared'

export function rebaseFloorReference(
  nodes: StructureNodes,
  input: { slabId?: string; slabIds?: string[]; referenceFloorElevation: number | null },
): StructurePlan {
  if (!!input.slabId === !!input.slabIds?.length)
    throw new Error('Supply slabId or a non-empty slabIds array.')
  const plates = [...new Set(input.slabIds ?? [input.slabId!])].map((id) => {
    const plate = nodes[id]
    if (plate?.type !== 'slab' || plate.plateRole !== 'base')
      throw new Error(`Base plate not found: ${id}`)
    return plate
  })
  const reference = input.referenceFloorElevation
  if (reference !== null && !Number.isFinite(reference))
    throw new Error('The floor reference must be a finite level-local elevation.')
  const nextPlates = plates.map(
    (plate): SlabNode => ({
      ...plate,
      referenceFloorElevation: reference ?? undefined,
      ...(floorPlateAtGroundContact(nodes, plate) && plate.floorHeight === undefined
        ? { floorHeight: plate.elevation }
        : {}),
    }),
  )
  let draft: StructureNodes = {
    ...nodes,
    ...Object.fromEntries(nextPlates.map((plate) => [plate.id, plate])),
  }
  const supports = upperStoreyFootprints(nodes)
  const beforeDisplacement = levelConstructionDisplacements(nodes, supports)
  const afterDisplacement = levelConstructionDisplacements(draft, supports)
  for (const [levelId, owners] of supports) {
    const shifts = owners.map((owner) => {
      const nextOwner = draft[owner.id] as SlabNode
      return (
        (afterDisplacement.get(owner.parentId!) ?? 0) +
        footprintLift(draft, nextOwner) -
        (beforeDisplacement.get(owner.parentId!) ?? 0) -
        footprintLift(nodes, owner)
      )
    })
    if (shifts.some((shift) => Math.abs(shift - shifts[0]!) > 1e-6))
      return {
        changes: [],
        conflicts: [
          {
            code: 'floor-reference-shared-storey',
            nodeIds: [levelId, ...owners.map((owner) => owner.id)],
            message:
              'This storey spans floor references that would move by different amounts. Rebase the supporting footprints together.',
          },
        ],
      }
  }
  const before = getLevelElevations(nodes)
  const ordered = [...getAuthoredLevelElevations(nodes)].sort((a, b) => a[1].ordinal - b[1].ordinal)
  for (const [levelId] of ordered) {
    const level = draft[levelId]
    if (level?.type !== 'level') continue
    const delta =
      (before.get(levelId)?.baseY ?? 0) - (getLevelElevations(draft).get(levelId)?.baseY ?? 0)
    if (Math.abs(delta) <= 1e-6) continue
    draft = {
      ...draft,
      [levelId]: {
        ...level,
        baseElevation: roundFloorElevation((level.baseElevation ?? 0) + delta),
      },
    }
  }
  const changes: StructurePlan['changes'] = [
    ...nextPlates.map((nextPlate, index) => ({
      op: 'update' as const,
      id: nextPlate.id,
      data: {
        referenceFloorElevation: nextPlate.referenceFloorElevation,
        ...(nextPlate.floorHeight !== plates[index]!.floorHeight
          ? { floorHeight: nextPlate.floorHeight }
          : {}),
      },
    })),
    ...ordered.flatMap(([levelId]) => {
      const old = nodes[levelId]
      const next = draft[levelId]
      return old?.type === 'level' &&
        next?.type === 'level' &&
        old.baseElevation !== next.baseElevation
        ? [{ op: 'update' as const, id: old.id, data: { baseElevation: next.baseElevation } }]
        : []
    }),
  ]
  return { changes }
}
