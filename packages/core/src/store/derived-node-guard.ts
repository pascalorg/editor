import {
  floorPlateAtGroundContact,
  floorPlateHoldsUnderside,
  supportDerivedFloorHeight,
} from '../lib/floor-foundation-datum'
import { expandFloorIntentChanges, floorIntentConflicts } from '../lib/floor-intent-changes'
import { ownFloorIntentChanges } from '../lib/own-floor-intent'
import { type Ring, union } from '../lib/polygon-boolean'
import type { AnyNode, AnyNodeId, CeilingNode, SlabNode, ZoneNode } from '../schema'
import { FloorOpeningNode, generateId } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import type { SurfaceHoleMetadata } from '../schema/nodes/surface-hole-metadata'

/**
 * Derived construction — floor plates and auto ceilings — is written by the
 * structure reconciler, load migrations, history restore and host-patch
 * application. Every other writer states *intent* (walls, separators, zones)
 * and lets the reconciler derive the construction.
 *
 * The capability is this module-private token. It is deliberately NOT
 * re-exported from the package index, so no caller outside `@pascal-app/core`
 * can mint a write that bypasses the guard — the sanctioned entry points
 * (`applyStructureReconciliation`, `detachDerivedNode`) hold it instead.
 */
export const DERIVED_WRITER_TOKEN: unique symbol = Symbol('pascal.derived-writer')

export type DerivedWriteOptions = {
  /** Internal capability. Only core's reconciler paths can supply it. */
  derivedWriter?: typeof DERIVED_WRITER_TOKEN
}

export type DerivedSurfaceNode = SlabNode | CeilingNode

export type DerivedWriteOperation = 'create' | 'update' | 'delete'

/** Thrown when a caller without the derived-writer capability writes derived construction. */
export class DerivedNodeWriteError extends Error {
  readonly code = 'derived_node_write_refused'

  constructor(
    readonly operation: DerivedWriteOperation,
    readonly nodeId: string,
    readonly fields: readonly string[],
    message: string,
  ) {
    super(message)
    this.name = 'DerivedNodeWriteError'
  }
}

/**
 * A slab or ceiling the reconciler owns. `boundary: 'auto'` is the current
 * marker; `autoFromWalls: true` is the legacy one still present in scenes that
 * have not been through the load migrations.
 */
export function isDerivedNode(node: AnyNode | null | undefined): node is DerivedSurfaceNode {
  if (!node) return false
  if (node.type !== 'slab' && node.type !== 'ceiling') return false
  return node.boundary === 'auto' || node.autoFromWalls === true
}

/** Fields whose value the reconciler owns on a derived surface. */
const PROTECTED_FIELDS: Record<'slab' | 'ceiling', readonly string[]> = {
  slab: [
    'elevation',
    'plateRole',
    'support',
    'railing',
    'polygon',
    'zoneIds',
    'boundary',
    'autoFromWalls',
    'parentId',
  ],
  ceiling: ['polygon', 'zoneId', 'boundary', 'autoFromWalls', 'parentId'],
}

function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The holes the reconciler cut for the room face, in order. Authored holes
 * (manual cut-outs, stair and elevator openings) stay editable on a derived
 * surface — the kernel re-applies them on every pass — so only the `room`
 * entries are protected.
 */
function roomHoles(node: { holes?: unknown; holeMetadata?: unknown }) {
  const holes = (node.holes ?? []) as unknown[]
  const metadata = (node.holeMetadata ?? []) as (SurfaceHoleMetadata | undefined)[]
  return holes.filter((_, index) => metadata[index]?.source === 'room')
}

/** Names the protected fields a patch would actually change on `current`. */
export function derivedFieldViolations(
  current: DerivedSurfaceNode,
  data: Partial<AnyNode>,
  nodes?: Readonly<Record<string, AnyNode>>,
): string[] {
  const patch = data as Record<string, unknown>
  const node = current as unknown as Record<string, unknown>
  const fixedUndersideEdit =
    nodes &&
    current.type === 'slab' &&
    current.plateRole === 'base' &&
    floorPlateHoldsUnderside(nodes, current) &&
    typeof patch.elevation === 'number' &&
    typeof patch.thickness === 'number' &&
    Math.abs(
      patch.elevation -
        patch.thickness -
        ((current.floorHeight ?? current.elevation) - current.thickness),
    ) <= 1e-6
  const violations = PROTECTED_FIELDS[current.type].filter(
    (field) =>
      Object.hasOwn(patch, field) &&
      !equal(patch[field], node[field]) &&
      !(field === 'elevation' && fixedUndersideEdit),
  )
  if (current.type === 'slab')
    for (const field of current.plateRole === 'base'
      ? ['fillToTerrain']
      : ['floorHeight', 'foundation'])
      if (Object.hasOwn(patch, field) && !equal(patch[field], node[field])) violations.push(field)
  if (current.type === 'slab' && current.support === 'open')
    for (const field of ['elevation', 'thickness', 'recessed', 'fillToTerrain'])
      if (Object.hasOwn(patch, field) && !equal(patch[field], node[field])) violations.push(field)
  if (
    current.type === 'slab' &&
    (current.plateRole === 'platform' || current.plateRole === 'sunken')
  )
    for (const field of ['thickness', 'recessed', 'fillToTerrain', 'slots'])
      if (Object.hasOwn(patch, field) && !equal(patch[field], node[field])) violations.push(field)
  if (current.type === 'slab' && (current.plateRole || current.support === 'open')) {
    for (const field of ['material', 'materialPreset', 'recessed'])
      if (Object.hasOwn(patch, field) && !equal(patch[field], node[field])) violations.push(field)
    if (
      (current.plateRole === 'base' || current.support === 'open') &&
      Object.hasOwn(patch, 'slots')
    ) {
      const slots = patch.slots as Record<string, unknown> | undefined
      if (
        [...new Set([...Object.keys(current.slots ?? {}), ...Object.keys(slots ?? {})])].some(
          (key) =>
            !(current.support === 'open' ? ['underside'] : ['edge', 'riser', 'underside']).includes(
              key,
            ) && !equal(slots?.[key], current.slots?.[key]),
        )
      )
        violations.push('slots')
    }
  }
  if (
    (Object.hasOwn(patch, 'holes') || Object.hasOwn(patch, 'holeMetadata')) &&
    !equal(roomHoles({ ...node, ...patch }), roomHoles(node))
  ) {
    violations.push('holes')
  }
  if (
    current.type === 'slab' &&
    (Object.hasOwn(patch, 'holes') || Object.hasOwn(patch, 'holeMetadata'))
  ) {
    const proposed = { ...current, ...data } as SlabNode
    const manual = (surface: SlabNode) =>
      surface.holes.filter(
        (_, index) => (surface.holeMetadata[index]?.source ?? 'manual') === 'manual',
      )
    if (!equal(manual(current), manual(proposed)) && !violations.includes('holes'))
      violations.push('holes')
  }
  return violations
}

export type DerivedNodeChanges = {
  create?: readonly { node: AnyNode }[]
  update?: readonly { id: AnyNodeId; data: Partial<AnyNode> }[]
}

type MutableDerivedChanges = {
  create?: Array<{ node: AnyNode; parentId?: AnyNodeId }>
  update?: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  delete?: AnyNodeId[]
}

function managedPoolOpenings(metadata: unknown): Array<{ poolId: string; polygon: Ring }> {
  const value = (metadata as Record<string, unknown> | undefined)?.poolManagedOpenings
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const candidate = entry as { poolId?: unknown; polygon?: unknown }
    if (typeof candidate?.poolId !== 'string' || !Array.isArray(candidate.polygon)) return []
    const polygon = candidate.polygon as unknown[]
    if (
      !polygon.every(
        (point) =>
          Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite),
      )
    )
      return []
    return [
      {
        poolId: candidate.poolId,
        polygon: polygon.map((point) => (point as number[]).slice(0, 2) as [number, number]),
      },
    ]
  })
}

export function convertDerivedPlateHoleWrites<T extends MutableDerivedChanges>(
  nodes: Readonly<Record<string, AnyNode>>,
  changes: T,
  options?: DerivedWriteOptions,
): T & MutableDerivedChanges {
  if (options?.derivedWriter === DERIVED_WRITER_TOKEN || !changes.update?.length) return changes
  const create = [...(changes.create ?? [])]
  const update = [...changes.update]
  const deleted = new Set(changes.delete ?? [])
  const poolDesired = new Map<string, { levelId: string; ownerId: string; polygon: Ring }>()
  const poolTouched = new Set<string>()
  const poolKey = (levelId: string, ownerId: string) => JSON.stringify([levelId, ownerId])
  for (const op of changes.update) {
    const slab = nodes[op.id]
    if (slab?.type !== 'slab' || !slab.parentId) continue
    const patch = op.data as Partial<SlabNode>
    for (const entry of managedPoolOpenings(slab.metadata))
      poolTouched.add(poolKey(slab.parentId, entry.poolId))
    if (!Object.hasOwn(patch, 'metadata')) continue
    for (const entry of managedPoolOpenings(patch.metadata)) {
      const key = poolKey(slab.parentId, entry.poolId)
      poolTouched.add(key)
      poolDesired.set(key, {
        levelId: slab.parentId,
        ownerId: entry.poolId,
        polygon: entry.polygon,
      })
    }
  }
  let converted = false
  for (const key of poolTouched) {
    const desired = poolDesired.get(key)
    const [levelId, ownerId] = JSON.parse(key) as [string, string]
    const existing = Object.values(nodes)
      .filter(
        (node): node is FloorOpeningNode =>
          node.type === 'floor-opening' &&
          node.parentId === levelId &&
          node.source === 'plugin:pool' &&
          node.ownerId === ownerId,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
    for (const extra of existing.slice(desired ? 1 : 0)) deleted.add(extra.id)
    if (desired) {
      const old = existing[0]
      if (old) {
        if (
          holeKey(old.polygon) !== holeKey(desired.polygon) ||
          old.cutsAdjacent ||
          old.legacyPlateCuts
        )
          update.push({
            id: old.id,
            data: { polygon: desired.polygon, cutsAdjacent: false, legacyPlateCuts: undefined },
          })
      } else {
        const node = FloorOpeningNode.parse({
          id: generateId('floor-opening'),
          parentId: levelId,
          name: 'Pool opening',
          polygon: desired.polygon,
          source: 'plugin:pool',
          ownerId,
          cutsAdjacent: false,
        })
        create.push({ node, parentId: levelId as AnyNodeId })
      }
    }
    converted = true
  }
  for (const [opIndex, op] of changes.update.entries()) {
    const slab = nodes[op.id]
    if (!isDerivedNode(slab) || slab.type !== 'slab' || !slab.parentId) continue
    const patch = op.data as Partial<SlabNode>
    if (!Object.hasOwn(patch, 'holes') && !Object.hasOwn(patch, 'holeMetadata')) continue
    const holes = patch.holes ?? slab.holes
    const pluginWrite = Object.hasOwn(patch, 'metadata')
    const sameGeometry =
      holes.length === slab.holes.length &&
      (equal(holes, slab.holes) || equal(holes.map(holeKey).sort(), slab.holes.map(holeKey).sort()))
    const unmaterializedAuthoredOpening =
      sameGeometry &&
      !pluginWrite &&
      Object.values(nodes).some(
        (node) =>
          node.type === 'floor-opening' &&
          node.source === 'manual' &&
          (node.metadata as Record<string, unknown> | undefined)?.plateHoleAuthoring === slab.id &&
          !slab.holeMetadata.some(
            (entry) => entry.source === 'floor-opening' && entry.openingId === node.id,
          ),
      )
    if (sameGeometry && !unmaterializedAuthoredOpening) {
      const data = { ...patch }
      delete data.holes
      delete data.holeMetadata
      update[opIndex] = { ...op, data: data as Partial<AnyNode> }
      converted = true
      continue
    }
    const ownedMetadataByHole = new Map(
      slab.holes.flatMap((hole, index) => {
        const entry = slab.holeMetadata[index]
        return entry && entry.source !== 'manual' ? [[holeKey(hole), entry] as const] : []
      }),
    )
    const proposedMetadata = patch.holeMetadata ?? slab.holeMetadata
    const metadata = holes.map((hole, index) => {
      const entry = proposedMetadata[index]
      return (entry?.source ?? 'manual') === 'manual'
        ? (ownedMetadataByHole.get(holeKey(hole)) ?? entry)
        : entry
    })
    if (!equal(metadata, patch.holeMetadata)) {
      update[opIndex] = {
        ...op,
        data: { ...patch, holeMetadata: metadata } as Partial<AnyNode>,
      }
      converted = true
    }
    const managed = managedPoolOpenings(patch.metadata ?? slab.metadata)
    const managedKeys = new Set(managed.map((entry) => holeKey(entry.polygon)))
    const roomKeys = new Set(
      slab.holes.flatMap((hole, index) =>
        slab.holeMetadata[index]?.source === 'room' ? [holeKey(hole)] : [],
      ),
    )
    const poolWrite =
      Object.hasOwn(patch, 'metadata') &&
      (managed.length > 0 || managedPoolOpenings(slab.metadata).length > 0)
    const currentOpenings = new Map<string, FloorOpeningNode>()
    for (const entry of slab.holeMetadata) {
      if (entry.source !== 'floor-opening' || !entry.openingId) continue
      const opening = nodes[entry.openingId]
      if (opening?.type === 'floor-opening' && opening.source === 'manual')
        currentOpenings.set(opening.id, opening)
    }
    for (const node of Object.values(nodes)) {
      if (node.type !== 'floor-opening' || node.source !== 'manual') continue
      if ((node.metadata as Record<string, unknown> | undefined)?.plateHoleAuthoring === slab.id)
        currentOpenings.set(node.id, node)
    }
    const retainedIds = new Set(
      metadata.flatMap((entry) =>
        entry?.source === 'floor-opening' && entry.openingId ? [entry.openingId] : [],
      ),
    )
    const pending = [...currentOpenings.values()].filter((opening) => !retainedIds.has(opening.id))
    const authored = holes.flatMap((polygon, index) =>
      (metadata[index]?.source ?? 'manual') === 'manual' &&
      !managedKeys.has(holeKey(polygon)) &&
      !roomKeys.has(holeKey(polygon))
        ? [{ polygon, openingId: metadata[index]?.openingId }]
        : [],
    )
    let manualConverted = false
    for (const { polygon, openingId } of authored) {
      const exact = [...currentOpenings.values()].find(
        (opening) => opening.id === openingId || holeKey(opening.polygon) === holeKey(polygon),
      )
      const old = exact ?? pending.shift()
      if (old) {
        const index = pending.findIndex((candidate) => candidate.id === old.id)
        if (index >= 0) pending.splice(index, 1)
        if (holeKey(old.polygon) !== holeKey(polygon))
          update.push({ id: old.id, data: { polygon, cutsAdjacent: false } })
      } else if (
        !create.some(
          (entry) =>
            entry.node.type === 'floor-opening' &&
            entry.node.parentId === slab.parentId &&
            holeKey(entry.node.polygon) === holeKey(polygon),
        )
      ) {
        const hostZoneId =
          slab.support === 'open' && slab.zoneIds?.length === 1 ? slab.zoneIds[0] : undefined
        const node = FloorOpeningNode.parse({
          id: generateId('floor-opening'),
          parentId: slab.parentId,
          name: 'Floor opening',
          polygon,
          ...(hostZoneId ? { hostZoneId } : {}),
          metadata: { plateHoleAuthoring: slab.id },
          cutsAdjacent: false,
        })
        create.push({ node, parentId: slab.parentId as AnyNodeId })
      }
      manualConverted = true
    }
    const managedHoles = (surfaceHoles: typeof holes, surfaceMetadata: typeof metadata) =>
      surfaceHoles.flatMap((hole, index) =>
        surfaceMetadata[index]?.source === 'stair' || surfaceMetadata[index]?.source === 'elevator'
          ? [{ hole, metadata: surfaceMetadata[index] }]
          : [],
      )
    const systemWrite = !equal(
      managedHoles(slab.holes, slab.holeMetadata),
      managedHoles(holes, metadata),
    )
    if (!pluginWrite && !poolWrite && !systemWrite)
      for (const opening of pending) {
        deleted.add(opening.id)
        manualConverted = true
      }
    const hasManual = holes.some(
      (polygon, index) =>
        (metadata[index]?.source ?? 'manual') === 'manual' &&
        !managedKeys.has(holeKey(polygon)) &&
        !roomKeys.has(holeKey(polygon)),
    )
    const hasManaged = holes.some(
      (polygon, index) =>
        (metadata[index]?.source ?? 'manual') === 'manual' && managedKeys.has(holeKey(polygon)),
    )
    const preservedOpenings =
      pluginWrite || poolWrite || systemWrite
        ? slab.holes.flatMap((hole, index) => {
            const entry = slab.holeMetadata[index]
            return entry &&
              entry.source !== 'manual' &&
              !holes.some((candidate) => holeKey(candidate) === holeKey(hole))
              ? [{ hole, metadata: entry }]
              : []
          })
        : []
    if (!manualConverted && !hasManual && !hasManaged && !preservedOpenings.length) continue
    const retained = holes.flatMap((hole, index) =>
      (metadata[index]?.source ?? 'manual') === 'manual'
        ? []
        : [{ hole, metadata: metadata[index] ?? { source: 'manual' as const } }],
    )
    retained.push(...preservedOpenings)
    update[opIndex] = {
      ...op,
      data: {
        ...patch,
        holes: retained.map((entry) => entry.hole),
        holeMetadata: retained.map((entry) => entry.metadata),
      } as Partial<AnyNode>,
    }
    converted = true
  }
  return converted
    ? ({ ...changes, create, update, delete: [...deleted] } as T & MutableDerivedChanges)
    : changes
}

const warnedFields = new Set<string>()

function warnFilteredFields(nodeId: string, fields: string[]) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return
  const fresh = fields.filter((field) => !warnedFields.has(`${nodeId}:${field}`))
  if (!fresh.length) return
  for (const field of fresh) warnedFields.add(`${nodeId}:${field}`)
  try {
    console.warn(`[Scene] Preserved derived ownership of ${fresh.join(', ')} on ${nodeId}`)
  } catch {
    // Diagnostics must not turn a filtered plugin write into a scene failure.
  }
}

function holeKey(hole: Ring): string {
  return JSON.stringify(union([hole]))
}

function mergeRoomHoles(current: DerivedSurfaceNode, patch: Partial<DerivedSurfaceNode>) {
  const rooms = current.holes.flatMap((hole, index) => {
    const metadata = current.holeMetadata[index]
    return metadata?.source === 'room' ? [{ hole, metadata, key: holeKey(hole) }] : []
  })
  if (!rooms.length) return patch
  const holes: Ring[] = []
  const holeMetadata: SurfaceHoleMetadata[] = []
  const emitted = new Set<string>()
  const proposedHoles = Object.hasOwn(patch, 'holes') ? (patch.holes ?? []) : current.holes
  const proposedMetadata = Object.hasOwn(patch, 'holeMetadata')
    ? (patch.holeMetadata ?? [])
    : current.holeMetadata
  for (const [index, hole] of proposedHoles.entries()) {
    const key = holeKey(hole)
    const room = rooms.find((entry) => entry.key === key)
    if (room) {
      if (emitted.has(room.key)) continue
      emitted.add(room.key)
      holes.push(room.hole)
      holeMetadata.push(room.metadata)
    } else {
      holes.push(hole)
      holeMetadata.push(proposedMetadata[index] ?? { source: 'manual' })
    }
  }
  for (const room of rooms) {
    if (emitted.has(room.key)) continue
    emitted.add(room.key)
    holes.push(room.hole)
    holeMetadata.push(room.metadata)
  }
  return { ...patch, holes, holeMetadata }
}

const createdNodes = (create: DerivedNodeChanges['create']) =>
  new Map((create ?? []).map(({ node }) => [node.id as string, node]))

/**
 * Construction copied together with the level and rooms it stands for (a
 * duplicated level) stays derived: the reconciler adopts it for the copied
 * rooms, as it does a loaded scene's, instead of building a second plate
 * beside a manual copy.
 */
function arrivesWithItsLevel(node: DerivedSurfaceNode, created: ReadonlyMap<string, AnyNode>) {
  return (
    created.get(node.parentId ?? '')?.type === 'level' &&
    linkedZoneIds(node).every((id) => created.get(id)?.type === 'zone')
  )
}

function groundPlateRebases(nodes: Readonly<Record<string, AnyNode>>, changes: DerivedNodeChanges) {
  // Inserting a storey below a ground plate changes its construction model:
  // retain thickness, remove the foundation, and rest its underside upstairs.
  const movedLevels = new Set<string>(
    changes.update?.flatMap(({ id, data }) =>
      nodes[id]?.type === 'level' && 'level' in data && data.level !== nodes[id].level ? [id] : [],
    ),
  )
  if (!movedLevels.size) return new Set<string>()
  const draft = {
    ...nodes,
    ...Object.fromEntries(changes.create?.map(({ node }) => [node.id, node]) ?? []),
  }
  for (const { id, data } of changes.update ?? [])
    if (movedLevels.has(id)) draft[id] = { ...draft[id], ...data } as AnyNode
  return new Set(
    changes.update?.flatMap(({ id, data }) => {
      const plate = nodes[id]
      if (
        plate?.type !== 'slab' ||
        plate.plateRole !== 'base' ||
        !movedLevels.has(plate.parentId!) ||
        !floorPlateAtGroundContact(nodes, plate) ||
        floorPlateAtGroundContact(draft, plate)
      )
        return []
      const patch = data as Partial<SlabNode>
      const reference = supportDerivedFloorHeight(draft, plate)
      return Object.hasOwn(patch, 'floorHeight') &&
        patch.floorHeight === undefined &&
        patch.foundation?.type === 'none' &&
        (patch.thickness === undefined || patch.thickness === plate.thickness) &&
        patch.referenceFloorElevation === reference &&
        typeof patch.elevation === 'number' &&
        Math.abs(patch.elevation - (reference - DEFAULT_SLAB_ELEVATION + plate.thickness)) <= 1e-6
        ? [id]
        : []
    }),
  )
}

/** In-app writers retain authored edits without taking ownership from the reconciler. */
export function filterDerivedNodeWrites<T extends DerivedNodeChanges>(
  nodes: Readonly<Record<string, AnyNode>>,
  changes: T,
  options?: DerivedWriteOptions,
): T {
  if (options?.derivedWriter === DERIVED_WRITER_TOKEN) return changes
  if (changes.update) {
    const own = ownFloorIntentChanges(nodes, changes.update)
    const update = own.conflicts.length ? [] : expandFloorIntentChanges(nodes, own.updates)
    changes = { ...changes, update }
  }
  const created = createdNodes(changes.create)
  const rebases = groundPlateRebases(nodes, changes)
  return {
    ...changes,
    ...(changes.create && {
      create: changes.create.map((op) => {
        if (!isDerivedNode(op.node) || arrivesWithItsLevel(op.node, created)) return op
        const node = { ...op.node } as Record<string, unknown>
        const fields = ['plateRole', 'boundary', 'zoneIds', 'zoneId', 'autoFromWalls']
        warnFilteredFields(
          op.node.id,
          fields.filter((field) => Object.hasOwn(node, field)),
        )
        for (const field of fields) delete node[field]
        return { ...op, node: node as AnyNode }
      }),
    }),
    ...(changes.update && {
      update: changes.update.flatMap((op) => {
        const current = nodes[op.id]
        if (!isDerivedNode(current)) return [op]
        const fields = derivedFieldViolations(current, op.data, nodes).filter(
          (field) => field !== 'holes' && !(field === 'elevation' && rebases.has(op.id)),
        )
        let data = { ...op.data } as Record<string, unknown>
        for (const field of fields) delete data[field]
        if (Object.hasOwn(data, 'holes') || Object.hasOwn(data, 'holeMetadata')) {
          const merged = mergeRoomHoles(current, data)
          for (const field of ['holes', 'holeMetadata'] as const) {
            const proposed = Object.hasOwn(data, field) ? data[field] : current[field]
            if (Object.hasOwn(merged, field) && !equal(merged[field], proposed)) fields.push(field)
          }
          data = merged
        }
        warnFilteredFields(op.id, fields)
        const node = current as unknown as Record<string, unknown>
        if (Object.entries(data).every(([field, value]) => equal(value, node[field]))) return []
        return [{ ...op, data: data as Partial<AnyNode> }]
      }),
    }),
  }
}

/**
 * State-aware refusal guard for MCP bridges. In-app mutation boundaries use
 * filterDerivedNodeWrites so a plugin cannot crash the scene with a derived write.
 *
 * Base construction remains editable; room plate finishes and elevations are intent
 * on the owning zone or level.
 */
export function assertDerivedNodeWrites(
  nodes: Readonly<Record<string, AnyNode>>,
  changes: DerivedNodeChanges,
  options?: DerivedWriteOptions,
): void {
  if (options?.derivedWriter === DERIVED_WRITER_TOKEN) return
  const own = ownFloorIntentChanges(nodes, changes.update ?? [])
  const conflicts = [
    ...own.conflicts,
    ...floorIntentConflicts(
      nodes,
      expandFloorIntentChanges(nodes, own.updates),
      changes.create?.map(({ node }) => node),
    ),
  ]
  if (conflicts.length)
    throw Object.assign(new Error(conflicts.map((c) => c.message).join(' ')), {
      code: 'room_floor_conflict',
      conflicts,
    })
  const created = createdNodes(changes.create)
  const rebases = groundPlateRebases(nodes, changes)
  for (const { node } of changes.create ?? []) {
    if (!isDerivedNode(node) || arrivesWithItsLevel(node, created)) continue
    throw new DerivedNodeWriteError(
      'create',
      node.id,
      node.type === 'slab' ? ['boundary', 'zoneIds'] : ['boundary', 'zoneId'],
      `Refusing to create the derived ${node.type} ${node.id}. Floor plates and auto ceilings are derived from rooms: create walls and a zone (spaceRole: "room") and the structure reconciler builds them.`,
    )
  }
  for (const { id, data } of changes.update ?? []) {
    const current = nodes[id]
    if (!isDerivedNode(current)) continue
    const fields = derivedFieldViolations(current, data, nodes).filter(
      (field) => !(field === 'elevation' && rebases.has(id)),
    )
    if (fields.length === 0) continue
    throw new DerivedNodeWriteError(
      'update',
      id,
      fields,
      current.type === 'slab' && current.plateRole === 'base'
        ? `Refusing to change ${fields.join(', ')} on the derived slab ${id} (base plate). Use set_floor_foundation to change its floor height.`
        : `Refusing to change ${fields.join(', ')} on the derived ${current.type} ${id}. The structure reconciler owns it: edit the room zone's intent instead, or convert the surface to manual with detachDerivedNode.`,
    )
  }
}

/** The patch that converts a derived surface into an ordinary authored one. */
export function derivedDetachPatch(node: DerivedSurfaceNode): Partial<AnyNode> {
  return (
    node.type === 'slab'
      ? { autoFromWalls: false, boundary: undefined, zoneIds: undefined, plateRole: undefined }
      : { autoFromWalls: false, boundary: undefined, zoneId: undefined }
  ) as Partial<AnyNode>
}

/** The zone ids whose construction intent a derived surface stands for. */
function linkedZoneIds(node: DerivedSurfaceNode): string[] {
  const ids = node.type === 'slab' ? (node.zoneIds ?? []) : node.zoneId ? [node.zoneId] : []
  return [...new Set(ids)]
}

/**
 * Explicit deletion of derived construction is an intent edit, not a refusal:
 * removing a room's auto ceiling means "this room has no ceiling"
 * (`hasCeiling: false`), removing its plate means "no floor" (`hasFloor:
 * false`). Returns the zone updates that record it, so the reconciler does not
 * simply rebuild what the user deleted.
 *
 * Cascaded descendants (deleting the level that owns the plate) carry no
 * intent — the zone is going away with them.
 */
export function derivedDeletionIntent(
  nodes: Readonly<Record<string, AnyNode>>,
  ids: readonly AnyNodeId[],
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const deleted = new Set<AnyNodeId>(ids)
  const intent = new Map<AnyNodeId, Partial<ZoneNode>>()
  for (const id of ids) {
    const node = nodes[id]
    if (!isDerivedNode(node)) continue
    const field = node.type === 'ceiling' ? 'hasCeiling' : 'hasFloor'
    for (const zoneId of linkedZoneIds(node)) {
      const zone = nodes[zoneId]
      if (zone?.type !== 'zone' || deleted.has(zone.id)) continue
      if (zone[field] === false) continue
      intent.set(zone.id, { ...intent.get(zone.id), [field]: false })
    }
  }
  return [...intent].map(([id, data]) => ({ id, data: data as Partial<AnyNode> }))
}
