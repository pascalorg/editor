import { canonicalOpeningRing } from '../lib/canonical-opening-ring'
import { area, type Ring, union } from '../lib/polygon-boolean'
import type { AnyNode, CeilingNode, SlabNode, StairNode, StairSegmentNode } from '../schema'
import { FloorOpeningNode } from '../schema/nodes/floor-opening'
import { syncAutoElevatorOpenings } from '../systems/elevator/elevator-opening-sync'
import { ensureMissingSlabOpenings } from '../systems/slab/ensure-slab-openings'
import { computeSegmentTransforms, rotateXZ } from '../systems/stair/stair-footprint'
import { syncAutoStairOpenings } from '../systems/stair/stair-opening-sync'
import { resolveStairTotalRise, syncStairRises } from '../systems/stair/stair-rise-query'
import { loadMapMigration, loadMigration } from './load-migration'

// Saved implicit openings used this geometry. Materializing them must not redesign a floor on load.
function legacyStairOpening(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  target: number,
  offset: number,
): Ring[] {
  if (stair.slabOpeningMode !== 'destination') return []
  const world = ([x, z]: [number, number]): [number, number] => {
    const [rx, rz] = rotateXZ(x, z, stair.rotation ?? 0)
    return [rx + stair.position[0], rz + stair.position[2]]
  }
  if (stair.stairType === 'spiral') {
    const radius =
      Math.max(0.05, stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4) + offset
    return [
      Array.from({ length: 48 }, (_, i) =>
        world([Math.cos((i * Math.PI) / 24) * radius, Math.sin((i * Math.PI) / 24) * radius]),
      ),
    ]
  }
  if (stair.stairType === 'curved') {
    const inner = Math.max(0.01, (stair.innerRadius ?? 0.9) - offset),
      outer = (stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4) + offset
    const total = stair.sweepAngle ?? Math.PI / 2
    const sweep =
      Math.sign(total || 1) *
      Math.min(
        Math.abs(total),
        Math.abs(total) * Math.max(0.8, 1 / Math.max(stair.stepCount ?? 1, 1)) +
          (offset / Math.max(inner, 0.1)) * 2,
      )
    const count = Math.max(
      10,
      Math.min(
        32,
        Math.ceil(Math.abs(sweep) / (Math.PI / 24) + Math.max(stair.stepCount ?? 1, 1) * 0.5),
      ),
    )
    const arc = (radius: number) =>
      Array.from({ length: count + 1 }, (_, i) => {
        const angle = total / 2 - sweep + (sweep * i) / count
        return world([Math.cos(angle) * radius, Math.sin(angle) * radius])
      })
    return [[...arc(outer), ...arc(inner).reverse()]]
  }
  const segments = stair.children
    .map((id) => nodes[id])
    .filter(
      (node): node is StairSegmentNode => node?.type === 'stair-segment' && node.visible !== false,
    )
  const transforms = computeSegmentTransforms(segments)
  const threshold = Math.max(
    (resolveStairTotalRise(stair, nodes) / Math.max(stair.stepCount ?? 10, 1)) * 2,
    0.35,
  )
  const slice = (index: number, start: number): Ring => {
    const segment = segments[index]!,
      transform = transforms[index]!
    const length = Math.max(segment.length - start, 0.0001)
    return [
      [-segment.width / 2, start],
      [segment.width / 2, start],
      [segment.width / 2, start + length],
      [-segment.width / 2, start + length],
    ].map(([x, z]) => {
      const [rx, rz] = rotateXZ(x!, z!, transform.rotation)
      return [rx + transform.position[0], rz + transform.position[2]]
    })
  }
  const rectangles: Ring[] = []
  for (const [index, segment] of segments.entries()) {
    const top =
      transforms[index]!.position[1] + (segment.segmentType === 'stair' ? segment.height : 0)
    if (Math.abs(target - top) > threshold) continue
    const depth =
      segment.segmentType === 'landing'
        ? segment.length
        : Math.min(
            segment.length,
            Math.max(
              Math.max(
                0.2,
                segment.length / Math.max(segment.stepCount || stair.stepCount || 10, 1),
              ) * 10,
              segment.length * 0.8,
              3,
            ),
          )
    const polygon = slice(index, Math.max(0, segment.length - depth))
    const minX = Math.min(...polygon.map(([x]) => x)) - (offset > 1e-6 ? offset : 0),
      maxX = Math.max(...polygon.map(([x]) => x)) + (offset > 1e-6 ? offset : 0)
    const minZ = Math.min(...polygon.map(([, z]) => z)) - (offset > 1e-6 ? offset : 0),
      maxZ = Math.max(...polygon.map(([, z]) => z)) + (offset > 1e-6 ? offset : 0)
    rectangles.push(
      [
        [minX, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [minX, maxZ],
      ].map(([x, z]) => [Number(x!.toFixed(6)), Number(z!.toFixed(6))]),
    )
  }
  if (rectangles.length) return union(rectangles).map((region) => region.outer.map(world))
  let lastFlight = -1
  for (let index = segments.length - 1; index >= 0; index--)
    if (segments[index]!.segmentType === 'stair') {
      lastFlight = index
      break
    }
  const fallback = lastFlight >= 0 ? lastFlight : segments.length - 1
  return fallback >= 0 ? [slice(fallback, 0).map(world)] : []
}

function materializeLegacyAutoOpeningsOnView(
  sourceNodes: Record<string, unknown>,
  refreshExisting = false,
) {
  let nodes = sourceNodes as Record<string, AnyNode>
  for (const surface of Object.values(nodes)) {
    if (surface.type !== 'slab' && surface.type !== 'ceiling') continue
    const kept = (surface.holes ?? []).flatMap((hole, index) => {
      const metadata = surface.holeMetadata?.[index]
      if (metadata?.source !== 'stair' && metadata?.source !== 'elevator')
        return [{ hole, metadata: metadata ?? { source: 'manual' as const } }]
      const ownerId = metadata.source === 'stair' ? metadata.stairId : metadata.elevatorId
      return ownerId && nodes[ownerId]?.type === metadata.source ? [{ hole, metadata }] : []
    })
    if (kept.length === (surface.holes ?? []).length) continue
    if (nodes === sourceNodes) nodes = { ...nodes }
    nodes[surface.id] = {
      ...surface,
      holes: kept.map((entry) => entry.hole),
      holeMetadata: kept.map((entry) => entry.metadata),
    }
  }
  if (
    !Object.values(nodes).some(
      (node) => (node as AnyNode).type === 'stair' || (node as AnyNode).type === 'elevator',
    )
  )
    return nodes
  if (
    refreshExisting &&
    !Object.values(nodes).some(
      (node) =>
        (node as SlabNode).type === 'slab' &&
        (node as SlabNode).autoFromWalls &&
        !(node as SlabNode).plateRole,
    )
  )
    return nodes
  if (
    Object.values(nodes).some(
      (node) =>
        (node as AnyNode).type === 'floor-opening' &&
        ((node as FloorOpeningNode).source === 'stair' ||
          (node as FloorOpeningNode).source === 'elevator'),
    )
  )
    return nodes
  let pending = true
  while (pending) {
    pending = false
    const legacyStairUpdates = (view: Record<string, AnyNode>) =>
      syncAutoStairOpenings(view, legacyStairOpening)
    for (const derive of [syncAutoElevatorOpenings, syncStairRises, legacyStairUpdates]) {
      const updates =
        derive === syncStairRises
          ? syncStairRises(nodes, (stair: StairNode) => stair.position[1], true)
          : !refreshExisting
            ? ensureMissingSlabOpenings(nodes, derive(nodes))
            : derive(nodes)
      if (refreshExisting && derive !== syncStairRises)
        for (const update of updates) {
          const current = nodes[update.id]
          if (current?.type !== 'slab' && current?.type !== 'ceiling') continue
          const data = update.data as Partial<SlabNode | CeilingNode>
          if (!data.holes || !data.holeMetadata) continue
          const ownerKey = (entry: (typeof current.holeMetadata)[number]) =>
            entry.source === 'stair'
              ? `stair:${entry.stairId}`
              : entry.source === 'elevator'
                ? `elevator:${entry.elevatorId}`
                : undefined
          const generated = new Set(data.holeMetadata.map(ownerKey).filter(Boolean))
          for (const [index, hole] of current.holes.entries()) {
            const metadata = current.holeMetadata[index]
            const owner = metadata && ownerKey(metadata)
            if (!owner || generated.has(owner)) continue
            data.holes = [...data.holes, hole]
            data.holeMetadata = [...data.holeMetadata, metadata]
          }
        }
      const effectiveUpdates = updates.filter(({ id, data }) =>
        Object.entries(data).some(
          ([key, value]) =>
            JSON.stringify((nodes[id] as unknown as Record<string, unknown>)?.[key]) !==
            JSON.stringify(value),
        ),
      )
      if (!effectiveUpdates.length) continue
      pending = true
      nodes = { ...nodes }
      for (const { id, data } of effectiveUpdates) nodes[id] = { ...nodes[id], ...data } as AnyNode
    }
  }
  return nodes
}

function ringSignature(polygon: Ring) {
  const quantized = polygon.map(([x, z]) => [Math.round(x * 10_000), Math.round(z * 10_000)])
  const signatures = [quantized, [...quantized].reverse()].flatMap((ring) =>
    ring.map((_, index) => JSON.stringify([...ring.slice(index), ...ring.slice(0, index)])),
  )
  return signatures.sort()[0]
}

function openingId(surfaceId: string, ownerId: string | undefined, polygon: Ring) {
  const seed = JSON.stringify([surfaceId, ownerId ?? '', ringSignature(polygon)])
  let hash = 0xcbf2_9ce4_8422_2325n
  for (const byte of new TextEncoder().encode(seed))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100_0000_01b3n)
  return `floor-opening_${hash.toString(36).padStart(16, '0')}`
}

function collapseOwnedOpenings(sourceNodes: Record<string, unknown>) {
  const groups = new Map<string, FloorOpeningNode[]>()
  for (const value of Object.values(sourceNodes)) {
    const opening = value as FloorOpeningNode
    if (
      opening.type !== 'floor-opening' ||
      (opening.source !== 'stair' && opening.source !== 'elevator') ||
      !opening.ownerId ||
      !opening.parentId ||
      (sourceNodes[opening.ownerId] as AnyNode | undefined)?.type !== opening.source
    )
      continue
    const key = JSON.stringify([opening.source, opening.ownerId, opening.parentId])
    groups.set(key, [...(groups.get(key) ?? []), opening])
  }
  let nodes = sourceNodes
  const remap = new Map<string, string>()
  for (const openings of groups.values()) {
    if (openings.length < 2) continue
    openings.sort(
      (a, b) =>
        Number(!!b.surfaceId) - Number(!!a.surfaceId) ||
        Number(!!b.metadata?.ownerPose) - Number(!!a.metadata?.ownerPose) ||
        a.id.localeCompare(b.id),
    )
    const keeper = openings[0]!
    const merged: Partial<FloorOpeningNode> = {}
    for (const field of ['legacyPlateCuts', 'legacyCeilingCuts'] as const) {
      const cuts: Record<string, Ring[]> = {}
      for (const opening of openings)
        for (const [surfaceId, rings] of Object.entries(opening[field] ?? {})) {
          const known = new Set((cuts[surfaceId] ?? []).map(ringSignature))
          for (const ring of rings)
            if (!known.has(ringSignature(ring))) {
              cuts[surfaceId] = [...(cuts[surfaceId] ?? []), ring]
              known.add(ringSignature(ring))
            }
        }
      if (field === 'legacyPlateCuts' && keeper.source === 'stair') {
        const entries = Object.entries(cuts)
        if (entries.length > 1 && entries.every(([, rings]) => rings.length === 1)) {
          const largest = entries
            .map(([, rings]) => rings[0]!)
            .sort((a, b) => area([{ outer: b, holes: [] }]) - area([{ outer: a, holes: [] }]))[0]!
          const extent = (ring: Ring) => [
            Math.min(...ring.map(([x]) => x)),
            Math.max(...ring.map(([x]) => x)),
            Math.min(...ring.map(([, z]) => z)),
            Math.max(...ring.map(([, z]) => z)),
          ]
          const bounds = extent(largest)
          if (
            entries.every(([, rings]) => {
              const ring = rings[0]!
              return (
                ring.length === largest.length &&
                extent(ring).every((value, index) => Math.abs(value - bounds[index]!) <= 0.0021)
              )
            })
          )
            for (const [surfaceId] of entries) cuts[surfaceId] = [largest]
        }
      }
      if (Object.keys(cuts).length) merged[field] = cuts
    }
    if (nodes === sourceNodes) nodes = { ...sourceNodes }
    nodes[keeper.id] = { ...keeper, ...merged }
    for (const duplicate of openings.slice(1)) {
      remap.set(duplicate.id, keeper.id)
      delete nodes[duplicate.id]
    }
  }
  if (!remap.size) return nodes
  for (const value of Object.values(nodes)) {
    const node = value as AnyNode
    if (node.type === 'level') {
      const children = node.children.filter((id) => !remap.has(id))
      if (children.length !== node.children.length) nodes[node.id] = { ...node, children }
      continue
    }
    if (node.type !== 'slab' && node.type !== 'ceiling') continue
    const retained: Array<{ hole: Ring; metadata: (typeof node.holeMetadata)[number] }> = []
    const seen = new Set<string>()
    for (const [index, hole] of (node.holes ?? []).entries()) {
      const metadata = node.holeMetadata?.[index] ?? { source: 'manual' as const }
      const openingId = metadata.source === 'floor-opening' ? metadata.openingId : undefined
      const mapped = openingId ? remap.get(openingId) : undefined
      const next = mapped ? { ...metadata, openingId: mapped } : metadata
      const key = next.source === 'floor-opening' ? `${next.openingId}:${ringSignature(hole)}` : ''
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      retained.push({ hole, metadata: next })
    }
    const currentIds = node.type === 'ceiling' ? node.openingIds : undefined
    const openingIds = currentIds
      ? [...new Set(currentIds.map((id) => remap.get(id) ?? id))]
      : undefined
    if (
      retained.length !== (node.holes ?? []).length ||
      retained.some((entry, index) => entry.metadata !== node.holeMetadata?.[index]) ||
      (openingIds && JSON.stringify(openingIds) !== JSON.stringify(currentIds))
    )
      nodes[node.id] = {
        ...node,
        holes: retained.map((entry) => entry.hole),
        holeMetadata: retained.map((entry) => entry.metadata),
        ...(openingIds ? { openingIds } : {}),
      }
  }
  return nodes
}

function migrateOwnedFloorOpeningsOnView(sourceNodes: Record<string, unknown>) {
  let nodes = sourceNodes
  for (const value of Object.values(sourceNodes)) {
    const surface = value as SlabNode | CeilingNode
    if (
      (surface.type !== 'slab' && surface.type !== 'ceiling') ||
      !surface.parentId ||
      !Array.isArray(surface.holes)
    )
      continue
    const kept: Array<{ hole: Ring; metadata: (typeof surface.holeMetadata)[number] }> = []
    let removed = false
    for (const [index, hole] of surface.holes.entries()) {
      const metadata = surface.holeMetadata?.[index] ?? { source: 'manual' as const }
      if (metadata.source !== 'stair' && metadata.source !== 'elevator') {
        kept.push({ hole, metadata })
        continue
      }
      if (area([{ outer: hole, holes: [] }]) < 1e-4) {
        kept.push({ hole, metadata })
        continue
      }
      const candidateId = metadata.source === 'stair' ? metadata.stairId : metadata.elevatorId
      const owner = candidateId ? (sourceNodes[candidateId] as AnyNode | undefined) : undefined
      const ownerId = owner?.type === metadata.source ? candidateId : undefined
      const id = openingId(surface.id, ownerId, hole)
      const existing = nodes[id] as FloorOpeningNode | undefined
      const field = surface.type === 'slab' ? 'legacyPlateCuts' : 'legacyCeilingCuts'
      const cuts = { ...(existing?.[field] ?? {}), [surface.id]: [hole] }
      if (nodes === sourceNodes) nodes = { ...sourceNodes }
      nodes[id] =
        existing?.type === 'floor-opening'
          ? { ...existing, [field]: cuts }
          : FloorOpeningNode.parse({
              id,
              parentId: surface.parentId,
              name: ownerId
                ? `${metadata.source === 'stair' ? 'Stair' : 'Elevator'} opening`
                : 'Floor opening',
              polygon: ownerId ? canonicalOpeningRing(hole) : hole,
              source: ownerId ? metadata.source : 'manual',
              ...(ownerId ? { ownerId } : {}),
              surfaceId: surface.id,
              drawnOn: surface.type === 'slab' ? 'floor' : 'ceiling',
              cutsPrimary: true,
              cutsAdjacent: false,
              [field]: cuts,
            })
      const level = nodes[surface.parentId] as AnyNode | undefined
      if (level?.type === 'level' && !level.children.includes(id as never))
        nodes[level.id] = { ...level, children: [...level.children, id as never] }
      removed = true
      if (
        surface.type === 'ceiling'
          ? surface.boundary !== 'auto'
          : surface.boundary !== 'auto' && !surface.autoFromWalls
      )
        kept.push({ hole, metadata: { source: 'floor-opening', openingId: id } })
    }
    if (removed) {
      if (nodes === sourceNodes) nodes = { ...sourceNodes }
      nodes[surface.id] = {
        ...surface,
        holes: kept.map((entry) => entry.hole),
        holeMetadata: kept.map((entry) => entry.metadata),
      }
    }
  }
  nodes = collapseOwnedOpenings(nodes)
  for (const value of Object.values(nodes)) {
    const opening = value as FloorOpeningNode
    if (
      opening.type !== 'floor-opening' ||
      (opening.source !== 'stair' && opening.source !== 'elevator')
    )
      continue
    const polygon = canonicalOpeningRing(opening.polygon)
    if (JSON.stringify(polygon) === JSON.stringify(opening.polygon)) continue
    if (nodes === sourceNodes) nodes = { ...sourceNodes }
    nodes[opening.id] = { ...opening, polygon }
  }
  return { nodes, changed: nodes !== sourceNodes }
}

export const materializeLegacyAutoOpenings = loadMapMigration(
  'legacy auto openings',
  materializeLegacyAutoOpeningsOnView,
)

export const migrateOwnedFloorOpenings = loadMigration(
  'owned floor openings',
  migrateOwnedFloorOpeningsOnView,
  (nodes) => ({ nodes, changed: false }),
)
