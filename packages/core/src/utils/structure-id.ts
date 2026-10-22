import { comparePlateComponents, floorPlateId } from '../lib/floor-plate-id'
import type { SceneNodes } from '../lib/structure-kernel'
import {
  reconcileSceneStructure,
  type SceneStructureInput,
  type SceneStructureResult,
  type StructureIdFactory,
} from '../lib/structure-reconcile'
import { zoneColorForSeed } from '../lib/zone-colors'
import type { AnyNode, SlabNode } from '../schema'

export function createStructureIdFactory(nodes: Record<string, unknown>) {
  const minted = new Set<string>()
  return (kind: Parameters<StructureIdFactory>[0], boundaryIds: readonly string[]) => {
    const seed = JSON.stringify([...new Set(boundaryIds)].sort())
    for (let attempt = 0; ; attempt++) {
      let hash = 0xcbf2_9ce4_8422_2325n
      for (const byte of new TextEncoder().encode(`${seed}|${kind}|${attempt}`)) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100_0000_01b3n)
      }
      const id = `${kind}_${hash.toString(36).padStart(16, '0')}`
      if (minted.has(id) || Object.hasOwn(nodes, id)) continue
      minted.add(id)
      return id
    }
  }
}

function boundaries(node: AnyNode, nodes: SceneNodes): string[] {
  if (node.type === 'zone') return [...node.boundaryWallIds, ...node.boundarySeparatorIds]
  const zoneIds =
    node.type === 'slab'
      ? (node.zoneIds ?? [])
      : node.type === 'ceiling' && node.zoneId
        ? [node.zoneId]
        : []
  return [
    ...new Set(
      zoneIds.flatMap((id) => (nodes[id]?.type === 'zone' ? boundaries(nodes[id]!, nodes) : [])),
    ),
  ].sort()
}

function remapReferences<T extends object>(value: T, ids: Map<string, string>): T {
  const fields = value as Record<string, unknown>
  const changes: Record<string, unknown> = {}
  for (const key of ['id', 'parentId', 'zoneId', 'supportSlabId', 'deckSlabId', 'survivorId']) {
    const id = fields[key]
    if (typeof id === 'string' && ids.has(id)) changes[key] = ids.get(id)
  }
  // Only newly minted rooms are remapped; pick their colour from the final id before persistence.
  if (fields.type === 'zone' && typeof fields.id === 'string' && ids.has(fields.id))
    changes.color = zoneColorForSeed(ids.get(fields.id)!)
  for (const key of ['children', 'zoneIds', 'members']) {
    const references = fields[key]
    if (Array.isArray(references) && references.some((id) => ids.has(id))) {
      const mapped = references.map((id) => ids.get(id) ?? id)
      changes[key] =
        key === 'zoneIds' || (key === 'children' && fields.type === 'ceiling')
          ? mapped.sort()
          : mapped
    }
  }
  return Object.keys(changes).length ? { ...value, ...changes } : value
}

export function reconcileStructureWithStableIds(
  input: Omit<SceneStructureInput, 'mintId'>,
): SceneStructureResult {
  const provisional = createStructureIdFactory(input.nodes)
  const result = reconcileSceneStructure({ ...input, mintId: (kind) => provisional(kind, []) })
  const created = result.patches.flatMap((patch) => (patch.op === 'create' ? [patch.node] : []))
  if (!created.length) return result
  // The kernel's mint callback receives only a kind. Resolve the owning room
  // boundaries from its completed plan, without deriving construction a second time.
  const mint = createStructureIdFactory(input.nodes)
  const ids = new Map<string, string>()
  for (const node of created.sort((a, b) => {
    const key = (n: AnyNode) =>
      JSON.stringify([n.type, boundaries(n, result.nodes), 'polygon' in n ? n.polygon : []])
    const left = key(a),
      right = key(b)
    return left < right ? -1 : left > right ? 1 : 0
  })) {
    if (
      node.type === 'zone' ||
      (node.type === 'slab' && !node.plateRole) ||
      node.type === 'ceiling'
    )
      ids.set(node.id, mint(node.type, boundaries(node, result.nodes)))
  }
  const components = new Map<string, number>()
  const occupied = new Set([...Object.keys(input.nodes), ...ids.values()])
  const plates = created
    .filter(
      (node): node is SlabNode =>
        node.type === 'slab' &&
        !!node.plateRole &&
        !(
          node.plateRole === 'base' &&
          node.zoneIds?.some((id) => {
            const zone = result.nodes[id]
            return zone?.type === 'zone' && !!zone.floor?.footprint
          })
        ),
    )
    .sort((a, b) =>
      comparePlateComponents(
        { outer: a.polygon, holes: a.holes },
        { outer: b.polygon, holes: b.holes },
      ),
    )
  for (const plate of plates) {
    const zoneIds = (plate.zoneIds ?? []).map((id) => ids.get(id) ?? id).sort()
    const key = JSON.stringify([
      plate.parentId,
      plate.plateRole === 'base' ? 'base' : 'room',
      zoneIds,
    ])
    let component = components.get(key) ?? 0
    let id: string
    do {
      id = floorPlateId(plate.parentId!, plate.plateRole!, zoneIds, component++)
    } while (occupied.has(id))
    occupied.add(id)
    components.set(key, component)
    ids.set(plate.id, id)
  }
  return {
    nodes: Object.fromEntries(
      Object.entries(result.nodes).map(([id, node]) => [
        ids.get(id) ?? id,
        remapReferences(node, ids),
      ]),
    ),
    patches: result.patches.map((patch) =>
      patch.op === 'create'
        ? { ...patch, node: remapReferences(patch.node, ids) }
        : patch.op === 'update'
          ? { ...patch, data: remapReferences(patch.data, ids) }
          : patch,
    ),
    events: result.events.map((event) => remapReferences(event, ids)),
  }
}
