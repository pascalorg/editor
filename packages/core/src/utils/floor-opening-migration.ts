import { adjacentLevelId } from '../lib/floor-opening-intent'
import { area, intersection, type Ring, union } from '../lib/polygon-boolean'
import type { AnyNode, CeilingNode, SlabNode } from '../schema'
import { FloorOpeningNode } from '../schema/nodes/floor-opening'

function polygonKey(polygon: Ring) {
  return polygon.map(([x, z]) => [Math.round(x * 10_000), Math.round(z * 10_000)])
}

function openingId(levelId: string, hostZoneId: string | undefined, polygon: Ring) {
  const seed = JSON.stringify([levelId, hostZoneId ?? '', polygonKey(polygon)])
  let hash = 0xcbf2_9ce4_8422_2325n
  for (const byte of new TextEncoder().encode(seed))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100_0000_01b3n)
  return `floor-opening_${hash.toString(36).padStart(16, '0')}`
}

function matchingCeilingHole(nodes: Record<string, unknown>, levelId: string, polygon: Ring) {
  const below = adjacentLevelId(nodes as Record<string, AnyNode>, levelId, -1)
  if (!below) return false
  const size = area([{ outer: polygon, holes: [] }])
  if (size < 1e-4) return false
  return Object.values(nodes).some((value) => {
    const ceiling = value as CeilingNode
    return (
      ceiling.type === 'ceiling' &&
      ceiling.parentId === below &&
      (ceiling.boundary === 'auto' || ceiling.autoFromWalls) &&
      ceiling.holes?.some(
        (hole) =>
          Math.abs(area(intersection(polygon, hole)) - size) < 1e-4 &&
          Math.abs(area([{ outer: hole, holes: [] }]) - size) < 1e-4,
      )
    )
  })
}

export function migrateFloorOpeningNodes(sourceNodes: Record<string, unknown>) {
  let nodes: Record<string, unknown> = sourceNodes
  const groups = new Map<
    string,
    {
      levelId: string
      hostZoneId?: string
      ownerId?: string
      cuts: Array<{ plateId: string; polygon: Ring }>
    }
  >()
  let adoptedHoles = 0
  let dedupes = 0
  let unions = 0
  for (const value of Object.values(sourceNodes)) {
    const slab = value as SlabNode
    if (
      slab.type !== 'slab' ||
      !(slab.boundary === 'auto' || slab.autoFromWalls) ||
      (slab.recessed === true && slab.autoFromWalls && !slab.boundary) ||
      !slab.parentId ||
      !Array.isArray(slab.holes)
    )
      continue
    const kept = slab.holes.flatMap((hole, index) => {
      const metadata = slab.holeMetadata?.[index]
      if ((metadata?.source ?? 'manual') !== 'manual') return [{ hole, metadata }]
      if (area([{ outer: hole, holes: [] }]) < 1e-4) return []
      const hostZoneId =
        slab.support === 'open' && slab.zoneIds?.length === 1 ? slab.zoneIds[0] : undefined
      const managed = (slab.metadata as Record<string, unknown> | undefined)?.poolManagedOpenings
      const pool = Array.isArray(managed)
        ? (managed.find((entry) => {
            const candidate = entry as { poolId?: unknown; holeIndex?: unknown; polygon?: unknown }
            return (
              typeof candidate.poolId === 'string' &&
              (candidate.holeIndex === index ||
                JSON.stringify(candidate.polygon) === JSON.stringify(hole))
            )
          }) as { poolId: string } | undefined)
        : undefined
      const ownerId = pool?.poolId
      const key = JSON.stringify([slab.parentId, hostZoneId ?? '', ownerId ?? ''])
      const group = groups.get(key) ?? {
        levelId: slab.parentId!,
        hostZoneId,
        ownerId,
        cuts: [],
      }
      group.cuts.push({ plateId: slab.id, polygon: hole })
      groups.set(key, group)
      adoptedHoles++
      return []
    })
    if (kept.length === slab.holes.length) continue
    if (nodes === sourceNodes) nodes = { ...sourceNodes }
    nodes[slab.id] = {
      ...slab,
      holes: kept.map(({ hole }) => hole),
      holeMetadata: kept.map(({ metadata }) => metadata ?? { source: 'manual' }),
    }
  }
  let created = 0
  for (const group of [...groups.values()].sort((a, b) =>
    JSON.stringify([a.levelId, a.hostZoneId, a.ownerId]).localeCompare(
      JSON.stringify([b.levelId, b.hostZoneId, b.ownerId]),
    ),
  )) {
    const unique = [
      ...new Map(
        group.cuts.map(({ polygon }) => [JSON.stringify(polygonKey(polygon)), polygon]),
      ).values(),
    ]
    const parts = union(unique)
    dedupes += group.cuts.length - unique.length
    unions += unique.length - parts.length
    for (const part of parts) {
      if (area([part]) < 1e-4) continue
      const id = openingId(group.levelId, group.hostZoneId, part.outer)
      const legacyPlateCuts: Record<string, Ring[]> = {}
      for (const cut of group.cuts) {
        if (area(intersection(cut.polygon, part)) < 1e-6) continue
        const stored = legacyPlateCuts[cut.plateId] ?? []
        if (!stored.some((ring) => JSON.stringify(ring) === JSON.stringify(cut.polygon)))
          stored.push(cut.polygon)
        legacyPlateCuts[cut.plateId] = stored
      }
      const existing = nodes[id] as FloorOpeningNode | undefined
      if (existing?.type === 'floor-opening') {
        if (nodes === sourceNodes) nodes = { ...sourceNodes }
        nodes[id] = {
          ...existing,
          legacyPlateCuts: { ...existing.legacyPlateCuts, ...legacyPlateCuts },
          ...(group.ownerId ? { source: 'plugin:pool', ownerId: group.ownerId } : {}),
        }
        continue
      }
      if (nodes === sourceNodes) nodes = { ...sourceNodes }
      nodes[id] = FloorOpeningNode.parse({
        id,
        parentId: group.levelId,
        name: 'Floor opening',
        polygon: part.outer,
        ...(group.hostZoneId ? { hostZoneId: group.hostZoneId } : {}),
        legacyPlateCuts,
        source: group.ownerId ? 'plugin:pool' : 'manual',
        ownerId: group.ownerId,
        drawnOn: 'floor',
        cutsPrimary: true,
        cutsAdjacent:
          !group.ownerId &&
          !group.hostZoneId &&
          matchingCeilingHole(sourceNodes, group.levelId, part.outer),
      })
      const level = nodes[group.levelId] as AnyNode | undefined
      if (level?.type === 'level' && !level.children.includes(id as never))
        nodes[group.levelId] = { ...level, children: [...level.children, id as never] }
      created++
    }
  }
  return { nodes, changed: nodes !== sourceNodes, adoptedHoles, created, dedupes, unions }
}
