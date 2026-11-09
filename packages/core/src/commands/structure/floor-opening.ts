import { adjacentLevelId, floorOpeningTargets } from '../../lib/floor-opening-intent'
import { area, intersection, type Ring, union } from '../../lib/polygon-boolean'
import { type AnyNode, type AnyNodeId, FloorOpeningNode } from '../../schema'
import type { StructureNodes, StructurePlan } from './shared'

export type CutFloorOpeningInput = {
  levelId?: string
  zoneId?: string
  levelIds?: string[]
  polygon?: Ring
  rect?: { x: number; z: number; width: number; depth: number }
  drawnOn?: 'floor' | 'ceiling'
  cutsPrimary?: boolean
  cutsAdjacent?: boolean
  source?: string
  ownerId?: string
  mintId: (kind: 'floor-opening') => string
}

export type FloorOpeningHint = {
  code: 'manual-ceiling'
  openingId: string
  surfaceIds: string[]
  message: string
}

function surfaceFootprint(node: { polygon: Ring; holes?: Ring[] }) {
  return { outer: node.polygon, holes: node.holes ?? [] }
}

export function floorOpeningHints(
  nodes: StructureNodes,
  opening: FloorOpeningNode,
): FloorOpeningHint[] {
  const ceilingTargets = floorOpeningTargets(nodes, opening).filter(
    (target) => target.surface === 'ceiling',
  )
  const surfaceIds = Object.values(nodes)
    .filter(
      (node) =>
        node.type === 'ceiling' &&
        node.boundary !== 'auto' &&
        ceilingTargets.some((target) => target.levelId === node.parentId) &&
        area(intersection(opening.polygon, surfaceFootprint(node))) > 1e-6,
    )
    .map((node) => node.id)
    .sort()
  return surfaceIds.length
    ? [
        {
          code: 'manual-ceiling',
          openingId: opening.id,
          surfaceIds,
          message: 'The adjacent ceiling is manual. Cut it in Edit ceiling.',
        },
      ]
    : []
}

function adjacentSurfaceExists(
  nodes: StructureNodes,
  levelId: string,
  drawnOn: 'floor' | 'ceiling',
  polygon: Ring,
) {
  const adjacent = adjacentLevelId(nodes, levelId, drawnOn === 'floor' ? -1 : 1)
  if (!adjacent) return false
  return Object.values(nodes).some(
    (node) =>
      node.parentId === adjacent &&
      (drawnOn === 'floor' ? node.type === 'ceiling' : node.type === 'slab') &&
      (node.type === 'ceiling' || node.type === 'slab') &&
      area(intersection(polygon, surfaceFootprint(node))) > 1e-6,
  )
}

export function cutFloorOpening(
  nodes: StructureNodes,
  input: CutFloorOpeningInput,
): StructurePlan & { openingIds: string[]; hints: FloorOpeningHint[] } {
  const zone = input.zoneId ? nodes[input.zoneId] : undefined
  if (input.zoneId && (zone?.type !== 'zone' || zone.spaceRole !== 'room'))
    throw Error(`Room not found: ${input.zoneId}`)
  const levelIds = [...new Set(input.levelIds ?? [input.levelId ?? zone?.parentId ?? ''])]
  if (!levelIds.length || levelIds.some((id) => nodes[id]?.type !== 'level'))
    throw Error('Specify an existing levelId or room zoneId.')
  if (zone && input.levelId && zone.parentId !== input.levelId)
    throw Error('The room is not on the specified level.')
  const polygon =
    input.polygon ??
    (input.rect
      ? ([
          [input.rect.x, input.rect.z],
          [input.rect.x + input.rect.width, input.rect.z],
          [input.rect.x + input.rect.width, input.rect.z + input.rect.depth],
          [input.rect.x, input.rect.z + input.rect.depth],
        ] as Ring)
      : undefined)
  if (!polygon || polygon.length < 3 || !polygon.every((point) => point.every(Number.isFinite)))
    throw Error('Supply a finite polygon with at least three vertices, or a rect.')
  if (area(union([polygon])) <= 1e-6) throw Error('The opening polygon has no area.')
  const drawnOn = input.drawnOn ?? 'floor'
  if (zone?.type === 'zone' && zone.floor?.support === 'open' && drawnOn !== 'floor')
    throw Error('A mezzanine hatch must be drawn on its floor.')
  const openings = levelIds.map((levelId) => {
    const hostZoneId =
      zone?.type === 'zone' && zone.floor?.support === 'open' && zone.parentId === levelId
        ? zone.id
        : undefined
    const id = input.mintId('floor-opening')
    if (nodes[id]) throw Error(`Duplicate opening id: ${id}`)
    return FloorOpeningNode.parse({
      id,
      parentId: levelId,
      name: 'Floor opening',
      polygon,
      ...(hostZoneId ? { hostZoneId } : {}),
      source: input.source ?? 'manual',
      ownerId: input.ownerId,
      drawnOn,
      cutsPrimary: input.cutsPrimary ?? true,
      cutsAdjacent:
        hostZoneId !== undefined
          ? false
          : (input.cutsAdjacent ?? adjacentSurfaceExists(nodes, levelId, drawnOn, polygon)),
    })
  })
  const levelUpdates = levelIds.map((levelId) => {
    const level = nodes[levelId] as Extract<AnyNode, { type: 'level' }>
    return {
      op: 'update' as const,
      id: level.id,
      data: {
        children: [
          ...level.children,
          ...openings
            .filter((opening) => opening.parentId === levelId)
            .map((opening) => opening.id),
        ],
      },
    }
  })
  return {
    changes: [...openings.map((node) => ({ op: 'create' as const, node })), ...levelUpdates],
    openingIds: openings.map((opening) => opening.id),
    hints: openings.flatMap((opening) => floorOpeningHints(nodes, opening)),
  }
}

export function removeFloorOpening(
  nodes: StructureNodes,
  id: string,
): StructurePlan & { openingId: string } {
  const opening = nodes[id]
  if (opening?.type !== 'floor-opening') throw Error(`Floor opening not found: ${id}`)
  const level = opening.parentId ? nodes[opening.parentId] : undefined
  return {
    openingId: id,
    changes: [
      { op: 'delete', id: opening.id as AnyNodeId },
      ...(level?.type === 'level'
        ? [
            {
              op: 'update' as const,
              id: level.id,
              data: { children: level.children.filter((child) => child !== id) },
            },
          ]
        : []),
    ],
  }
}
