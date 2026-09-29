import { canonicalOpeningRing } from '../lib/canonical-opening-ring'
import type { NodePatch } from '../lib/structure-kernel'
import type { AnyNode, AnyNodeId, FloorOpeningNode, SurfaceHoleMetadata } from '../schema'
import { FloorOpeningNode as FloorOpeningSchema } from '../schema/nodes/floor-opening'
import { resolveCeilingHeight } from '../services/level-height'
import { getLevelElevations } from '../services/storey'
import { syncAutoElevatorOpenings } from './elevator/elevator-opening-sync'
import { syncAutoStairOpenings } from './stair/stair-opening-sync'
import { resolveStairTotalRise } from './stair/stair-rise-query'

type Source = 'stair' | 'elevator'
type Surface = Extract<AnyNode, { type: 'slab' | 'ceiling' }>
type DesiredCut = { source: Source; ownerId: string; surface: Surface; polygon: [number, number][] }
type OwnerPose = {
  position: [number, number, number]
  rotation: number
  width: number
  runLength: number
}

function ownerPose(value: unknown): OwnerPose | undefined {
  if (!value || typeof value !== 'object') return
  const pose = value as Partial<OwnerPose>
  if (
    !Array.isArray(pose.position) ||
    pose.position.length !== 3 ||
    !pose.position.every(
      (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
    ) ||
    typeof pose.rotation !== 'number' ||
    !Number.isFinite(pose.rotation) ||
    typeof pose.width !== 'number' ||
    !Number.isFinite(pose.width) ||
    !(pose.width > 0) ||
    typeof pose.runLength !== 'number' ||
    !Number.isFinite(pose.runLength) ||
    !(pose.runLength > 0)
  )
    return
  return pose as OwnerPose
}

function hashKey(key: string) {
  let hash = 0xcbf2_9ce4_8422_2325n
  for (const byte of new TextEncoder().encode(key))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100_0000_01b3n)
  return `floor-opening_${hash.toString(36).padStart(16, '0')}`
}

function ownerFor(metadata: SurfaceHoleMetadata) {
  return metadata.source === 'stair'
    ? metadata.stairId
    : metadata.source === 'elevator'
      ? metadata.elevatorId
      : undefined
}

function withoutOwnedCuts(nodes: Record<string, AnyNode>) {
  const stripped = { ...nodes }
  for (const node of Object.values(nodes)) {
    if (node.type !== 'slab' && node.type !== 'ceiling') continue
    const kept = (node.holes ?? []).flatMap((hole, index) => {
      const metadata = node.holeMetadata?.[index]
      if (metadata?.source === 'stair' || metadata?.source === 'elevator') return []
      if (metadata?.source === 'floor-opening' && metadata.openingId) {
        const opening = nodes[metadata.openingId]
        if (
          !opening ||
          (opening.type === 'floor-opening' &&
            (opening.source === 'stair' || opening.source === 'elevator'))
        )
          return []
      }
      return [{ hole, metadata: metadata ?? { source: 'manual' as const } }]
    })
    if (kept.length !== (node.holes ?? []).length)
      stripped[node.id] = {
        ...node,
        holes: kept.map((entry) => entry.hole),
        holeMetadata: kept.map((entry) => entry.metadata),
      } as Surface
  }
  return stripped
}

function desiredCuts(nodes: Record<string, AnyNode>) {
  let draft = withoutOwnedCuts(nodes)
  for (const derive of [syncAutoElevatorOpenings, syncAutoStairOpenings]) {
    const updates = derive(draft)
    if (!updates.length) continue
    draft = { ...draft }
    for (const { id, data } of updates) draft[id] = { ...draft[id], ...data } as AnyNode
  }
  return cutsFromSurfaces(draft, nodes)
}

function cutsFromSurfaces(surfaces: Record<string, AnyNode>, owners: Record<string, AnyNode>) {
  const cuts: DesiredCut[] = []
  for (const surface of Object.values(surfaces)) {
    if (surface.type !== 'slab' && surface.type !== 'ceiling') continue
    for (const [index, polygon] of (surface.holes ?? []).entries()) {
      const metadata = surface.holeMetadata?.[index]
      if (metadata?.source !== 'stair' && metadata?.source !== 'elevator') continue
      const ownerId = ownerFor(metadata)
      if (ownerId && owners[ownerId]?.type === metadata.source)
        cuts.push({ source: metadata.source, ownerId, surface, polygon })
    }
  }
  return cuts
}

export function planOwnedFloorOpenings(
  nodes: Record<string, AnyNode>,
  options: {
    ownerIds?: ReadonlySet<string>
    skipExistingSurfaces?: boolean
    enforceReach?: boolean
    materializedNodes?: Record<string, AnyNode>
  } = {},
): NodePatch[] {
  const values = Object.values(nodes)
  if (
    !values.some(
      (node) =>
        node.type === 'stair' ||
        node.type === 'elevator' ||
        (node.type === 'floor-opening' && (node.source === 'stair' || node.source === 'elevator')),
    )
  )
    return []
  const existing = values.filter(
    (node): node is FloorOpeningNode =>
      node.type === 'floor-opening' &&
      (node.source === 'stair' || node.source === 'elevator') &&
      !!node.ownerId &&
      !!node.surfaceId,
  )
  const authored = values.filter(
    (node): node is FloorOpeningNode =>
      node.type === 'floor-opening' &&
      (node.source === 'stair' || node.source === 'elevator') &&
      !!node.ownerId &&
      !node.surfaceId,
  )
  const eligible = (ownerId: string) => !options.ownerIds || options.ownerIds.has(ownerId)
  const byLevel = new Map<string, DesiredCut[]>()
  const elevations = options.enforceReach === false ? undefined : getLevelElevations(nodes)
  for (const cut of options.materializedNodes
    ? cutsFromSurfaces(options.materializedNodes, nodes)
    : desiredCuts(nodes)) {
    const owner = nodes[cut.ownerId]
    if (!eligible(cut.ownerId)) continue
    const level = cut.surface.parentId ? nodes[cut.surface.parentId] : undefined
    if (
      options.skipExistingSurfaces &&
      level?.type === 'level' &&
      level.metadata?.legacyAutoOpeningsMigrated === true &&
      !existing.some(
        (opening) => opening.ownerId === cut.ownerId && opening.source === cut.source,
      ) &&
      !(nodes[cut.surface.id]?.type === 'slab' || nodes[cut.surface.id]?.type === 'ceiling'
        ? (nodes[cut.surface.id] as Surface).holeMetadata?.some(
            (metadata) => metadata.source === cut.source && ownerFor(metadata) === cut.ownerId,
          )
        : false)
    )
      continue
    if (owner?.type === 'stair' && elevations) {
      const from = elevations.get(owner.fromLevelId ?? owner.parentId ?? '')
      const target = elevations.get(cut.surface.parentId ?? '')
      if (from && target && from.buildingId === target.buildingId) {
        const rise = resolveStairTotalRise(owner, nodes)
        const surfaceHeight =
          cut.surface.type === 'slab'
            ? (cut.surface.elevation ?? 0.05)
            : resolveCeilingHeight(cut.surface, nodes)
        const targetRise = target.baseY - from.baseY + surfaceHeight - owner.position[1]
        if (rise + Math.max(0.35, (rise / Math.max(owner.stepCount, 1)) * 2) < targetRise) continue
      }
    }
    if (
      options.skipExistingSurfaces &&
      existing.some((opening) => opening.ownerId === cut.ownerId && opening.source === cut.source)
    )
      continue
    if (
      authored.some(
        (opening) =>
          opening.source === cut.source &&
          opening.ownerId === cut.ownerId &&
          opening.parentId === cut.surface.parentId,
      ) &&
      !existing.some(
        (opening) =>
          opening.source === cut.source &&
          opening.ownerId === cut.ownerId &&
          opening.parentId === cut.surface.parentId,
      )
    )
      continue
    if (owner?.type === 'stair' && (owner.slabOpeningMode ?? 'none') !== 'destination') continue
    if (!cut.surface.parentId) continue
    const key = JSON.stringify([cut.source, cut.ownerId, cut.surface.parentId])
    byLevel.set(key, [...(byLevel.get(key) ?? []), cut])
  }
  const patches: NodePatch[] = []
  const retained = new Set<string>()
  const addedByLevel = new Map<string, string[]>()
  const deletedByLevel = new Map<string, Set<string>>()
  for (const opening of authored) {
    if (!eligible(opening.ownerId!)) continue
    const owner = nodes[opening.ownerId!]
    if (
      !owner ||
      owner.type !== opening.source ||
      existing.some(
        (candidate) =>
          candidate.source === opening.source &&
          candidate.ownerId === opening.ownerId &&
          candidate.parentId === opening.parentId,
      )
    ) {
      patches.push({ op: 'delete', id: opening.id })
      if (opening.parentId) {
        const removed = deletedByLevel.get(opening.parentId) ?? new Set<string>()
        removed.add(opening.id)
        deletedByLevel.set(opening.parentId, removed)
      }
      continue
    }
    if (owner.type !== 'stair') continue
    const oldPose = ownerPose(opening.metadata.ownerPose)
    const segment = owner.children
      .map((id) => nodes[id])
      .find((node) => node?.type === 'stair-segment')
    const runLength = segment?.type === 'stair-segment' ? segment.length : (oldPose?.runLength ?? 1)
    const pose = {
      position: owner.position,
      rotation: owner.rotation,
      width: owner.width,
      runLength,
    }
    const target =
      opening.metadata.ownerOpeningTarget === 'source' || opening.drawnOn === 'ceiling'
        ? owner.fromLevelId
        : owner.toLevelId
    const parentId = target && nodes[target]?.type === 'level' ? target : opening.parentId
    const poseChanged = oldPose && JSON.stringify(oldPose) !== JSON.stringify(pose)
    const polygon = poseChanged
      ? canonicalOpeningRing(
          opening.polygon.map(([x, z]): [number, number] => {
            const dx = x - oldPose.position[0]
            const dz = z - oldPose.position[2]
            const cosOld = Math.cos(oldPose.rotation)
            const sinOld = Math.sin(oldPose.rotation)
            const localX = (dx * cosOld - dz * sinOld) * (owner.width / oldPose.width)
            const localZ = (dx * sinOld + dz * cosOld) * (runLength / oldPose.runLength)
            const cos = Math.cos(owner.rotation)
            const sin = Math.sin(owner.rotation)
            return [
              owner.position[0] + localX * cos + localZ * sin,
              owner.position[2] - localX * sin + localZ * cos,
            ]
          }),
        )
      : opening.polygon
    const metadata = { ...opening.metadata, ownerPose: pose }
    const data: Partial<FloorOpeningNode> = {}
    if (JSON.stringify(polygon) !== JSON.stringify(opening.polygon)) data.polygon = polygon
    if (parentId !== opening.parentId) {
      data.parentId = parentId
      if (opening.parentId) {
        const removed = deletedByLevel.get(opening.parentId) ?? new Set<string>()
        removed.add(opening.id)
        deletedByLevel.set(opening.parentId, removed)
      }
      if (parentId) addedByLevel.set(parentId, [...(addedByLevel.get(parentId) ?? []), opening.id])
    }
    if (JSON.stringify(metadata) !== JSON.stringify(opening.metadata)) data.metadata = metadata
    if (Object.keys(data).length) patches.push({ op: 'update', id: opening.id, data })
  }
  for (const [key, cuts] of byLevel) {
    const [source, ownerId, levelId] = JSON.parse(key) as [Source, string, string]
    const siblings = existing
      .filter(
        (node) => node.source === source && node.ownerId === ownerId && node.parentId === levelId,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
    cuts.sort(
      (a, b) =>
        Number(b.surface.type === 'slab') - Number(a.surface.type === 'slab') ||
        a.surface.id.localeCompare(b.surface.id) ||
        JSON.stringify(a.polygon).localeCompare(JSON.stringify(b.polygon)),
    )
    const old =
      siblings[0] ??
      existing.find(
        (node) =>
          node.source === source &&
          node.ownerId === ownerId &&
          node.drawnOn === (cuts[0]!.surface.type === 'slab' ? 'floor' : 'ceiling') &&
          !retained.has(node.id) &&
          !byLevel.has(JSON.stringify([source, ownerId, node.parentId])),
      )
    const id = old?.id ?? hashKey(JSON.stringify([source, ownerId, levelId]))
    const legacyPlateCuts: Record<string, [number, number][][]> = {}
    const legacyCeilingCuts: Record<string, [number, number][][]> = {}
    for (const cut of cuts) {
      const map = cut.surface.type === 'slab' ? legacyPlateCuts : legacyCeilingCuts
      const rings = map[cut.surface.id] ?? []
      if (!rings.some((ring) => JSON.stringify(ring) === JSON.stringify(cut.polygon)))
        map[cut.surface.id] = [...rings, cut.polygon]
    }
    const primary = cuts[0]!
    const candidate = FloorOpeningSchema.parse({
      ...old,
      id,
      parentId: levelId,
      name: source === 'stair' ? 'Stair opening' : 'Elevator opening',
      polygon: canonicalOpeningRing(primary.polygon),
      source,
      ownerId,
      surfaceId: primary.surface.id,
      drawnOn: primary.surface.type === 'slab' ? 'floor' : 'ceiling',
      cutsPrimary: true,
      cutsAdjacent: false,
      legacyPlateCuts: Object.keys(legacyPlateCuts).length ? legacyPlateCuts : undefined,
      legacyCeilingCuts: Object.keys(legacyCeilingCuts).length ? legacyCeilingCuts : undefined,
    })
    retained.add(id)
    if (old) {
      const data: Record<string, unknown> = {}
      for (const property of [
        'parentId',
        'surfaceId',
        'polygon',
        'legacyPlateCuts',
        'legacyCeilingCuts',
        'drawnOn',
      ])
        if (
          JSON.stringify(old[property as keyof FloorOpeningNode]) !==
          JSON.stringify(candidate[property as keyof FloorOpeningNode])
        )
          data[property] = candidate[property as keyof FloorOpeningNode]
      if (Object.keys(data).length)
        patches.push({ op: 'update', id: old.id, data: data as Partial<AnyNode> })
      if (old.parentId !== candidate.parentId) {
        if (old.parentId) {
          const removed = deletedByLevel.get(old.parentId) ?? new Set<string>()
          removed.add(old.id)
          deletedByLevel.set(old.parentId, removed)
        }
        if (candidate.parentId)
          addedByLevel.set(candidate.parentId, [
            ...(addedByLevel.get(candidate.parentId) ?? []),
            old.id,
          ])
      }
    } else {
      patches.push({ op: 'create', node: candidate })
      if (candidate.parentId)
        addedByLevel.set(candidate.parentId, [...(addedByLevel.get(candidate.parentId) ?? []), id])
    }
  }
  for (const opening of existing) {
    if (!eligible(opening.ownerId!) || retained.has(opening.id) || options.skipExistingSurfaces)
      continue
    patches.push({ op: 'delete', id: opening.id })
    if (opening.parentId) {
      const removed = deletedByLevel.get(opening.parentId) ?? new Set<string>()
      removed.add(opening.id)
      deletedByLevel.set(opening.parentId, removed)
    }
  }
  for (const levelId of new Set([...addedByLevel.keys(), ...deletedByLevel.keys()])) {
    const level = nodes[levelId]
    if (level?.type !== 'level') continue
    const children = [
      ...level.children.filter((id) => !deletedByLevel.get(levelId)?.has(id)),
      ...(addedByLevel.get(levelId) ?? []),
    ] as AnyNodeId[]
    if (JSON.stringify(children) !== JSON.stringify(level.children))
      patches.push({ op: 'update', id: level.id, data: { children } })
  }
  return patches
}
