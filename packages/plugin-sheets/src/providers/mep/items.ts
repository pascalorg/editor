/**
 * Placed plumbing fixtures — the `item` nodes the user actually dropped.
 *
 * The plumbing plan's fixtures are NOT guessed from room names: they are the
 * toilets, tubs, showers, sinks, washers and dishwashers standing in the
 * model. Move one and its mark, its key letters and its rough-in move with
 * it, because this is read from the same nodes the 3D view draws.
 *
 * PLAN TRANSFORM. A level-parented item's plan point is `position[0], [2]`.
 * A WALL-attached item's position is wall-local, so its plan point has to go
 * through the wall's frame — the same math the host runs in
 * `packages/nodes/src/item/floorplan.ts` (`resolveItemTransform`). That
 * function is not exported and lives in a package this one does not depend
 * on, so the arithmetic is MIRRORED here, deliberately, with the host's
 * clockwise `rotateVec` convention preserved exactly (`wallRotation =
 * -atan2(dz, dx)` is calibrated against it — a "tidier" counter-clockwise
 * rotation silently mirrors every wall-hung sink to the far side of its
 * wall).
 *
 * MARKS. The fixture schedule is owned by `schedule-fixtures.ts`. When it
 * produces rows, the marks printed on this plan are ITS marks, looked up by
 * description, so plan and schedule always agree. Until it does, the marks
 * are derived the same deterministic way it will: distinct descriptions
 * sorted, then A01, A02, …
 */
import type { NodeMap } from '../../model'
import { buildFixtureSchedule } from '../../schedule-fixtures'

/** The host's plan-space rotation — CLOCKWISE. See the module note. */
function rotateVec(x: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + y * s, -x * s + y * c]
}

export type PlumbingService = {
  /** Waste — discharges into the drain. */
  w: boolean
  /** Hot water. */
  h: boolean
  /** Cold water. */
  c: boolean
  /** Gas. */
  g: boolean
  /** Thermostatic / pressure-balancing mixing valve. */
  t: boolean
}

export type FixtureClass = {
  /** Schedule description — also the mark sort key. */
  description: string
  service: PlumbingService
  /** Drain size in inches, from mep-rules.json's Table P3005.4.1 classes. */
  drainIn: number | null
  /** Plan glyph family. */
  glyph: 'wc' | 'basin' | 'tub' | 'shower' | 'sink' | 'appliance' | 'other'
}

const S = (w: boolean, h: boolean, c: boolean, t = false, g = false): PlumbingService => ({
  w,
  h,
  c,
  g,
  t,
})

/**
 * asset.id → fixture class. The ids are the catalog's
 * (`SANITARY_ASSETS` in packages/plugin-bones/src/core/wall-model.ts uses the
 * same keys for the ones Bones roughs in), extended here with the fixtures
 * that carry a plumbing connection but no Bones demand point — dishwashers,
 * refrigerator ice makers — because they still belong on a plumbing plan and
 * in the fixture schedule.
 *
 * Drain sizes are the IRC Table P3005.4.1 fixture classes carried in
 * `mep-rules.json` (`plumbing.dwv.*DrainIn`).
 */
const CLASSES: Record<string, FixtureClass> = {
  toilet: {
    description: 'Toilet',
    service: S(true, false, true),
    drainIn: 3,
    glyph: 'wc',
  },
  'bathroom-sink': {
    description: 'Lavatory',
    service: S(true, true, true),
    drainIn: 1.25,
    glyph: 'basin',
  },
  'wall-sink': {
    description: 'Lavatory — wall hung',
    service: S(true, true, true),
    drainIn: 1.25,
    glyph: 'basin',
  },
  bathtub: {
    description: 'Bathtub',
    service: S(true, true, true, true),
    drainIn: 1.5,
    glyph: 'tub',
  },
  tub: {
    description: 'Bathtub',
    service: S(true, true, true, true),
    drainIn: 1.5,
    glyph: 'tub',
  },
  shower: {
    description: 'Shower',
    service: S(true, true, true, true),
    drainIn: 2,
    glyph: 'shower',
  },
  'shower-square': {
    description: 'Shower',
    service: S(true, true, true, true),
    drainIn: 2,
    glyph: 'shower',
  },
  'shower-angle': {
    description: 'Shower — corner',
    service: S(true, true, true, true),
    drainIn: 2,
    glyph: 'shower',
  },
  kitchen: {
    description: 'Kitchen sink',
    service: S(true, true, true),
    drainIn: 1.5,
    glyph: 'sink',
  },
  'kitchen-counter': {
    description: 'Kitchen sink',
    service: S(true, true, true),
    drainIn: 1.5,
    glyph: 'sink',
  },
  'washing-machine': {
    description: 'Clothes washer',
    service: S(true, true, true),
    drainIn: 2,
    glyph: 'appliance',
  },
  fridge: {
    description: 'Refrigerator — ice maker',
    service: S(false, false, true),
    drainIn: null,
    glyph: 'appliance',
  },
}

/** Prefix matches, for the catalog's families ('dishwasher-24', …). */
const CLASS_PREFIXES: [string, FixtureClass][] = [
  [
    'dishwasher',
    {
      description: 'Dishwasher',
      service: S(true, true, false),
      drainIn: 1.5,
      glyph: 'appliance',
    },
  ],
  [
    'shower',
    { description: 'Shower', service: S(true, true, true, true), drainIn: 2, glyph: 'shower' },
  ],
  [
    'toilet',
    { description: 'Toilet', service: S(true, false, true), drainIn: 3, glyph: 'wc' },
  ],
  [
    'bathtub',
    { description: 'Bathtub', service: S(true, true, true, true), drainIn: 1.5, glyph: 'tub' },
  ],
]

export function classifyItem(assetId: string, category: string, name: string): FixtureClass | null {
  const direct = CLASSES[assetId]
  if (direct) return direct
  for (const [prefix, cls] of CLASS_PREFIXES) {
    if (assetId.startsWith(prefix)) return cls
  }
  // Catalog ids drift; a sink or a toilet named as such still belongs on the
  // plan. Category/name matching is the LAST resort and never invents a
  // service set beyond what the word itself says.
  const hay = `${category} ${name}`.toLowerCase()
  if (/\btoilet|water closet\b/.test(hay)) return CLASSES.toilet ?? null
  if (/\bbathtub|\btub\b/.test(hay)) return CLASSES.bathtub ?? null
  if (/\bshower\b/.test(hay)) return CLASSES.shower ?? null
  if (/\bkitchen sink\b/.test(hay)) return CLASSES.kitchen ?? null
  if (/\bsink|lavatory|basin\b/.test(hay)) return CLASSES['bathroom-sink'] ?? null
  if (/\bdishwasher\b/.test(hay)) return CLASS_PREFIXES[0]?.[1] ?? null
  if (/\bwash(ing|er)\b/.test(hay)) return CLASSES['washing-machine'] ?? null
  return null
}

export type PlacedItem = {
  id: string
  /** Plan point of the item's CENTRE, level-local metres. */
  plan: [number, number]
  /** Plan rotation, radians, in the host's clockwise convention. */
  rotation: number
  /** Footprint, metres. */
  width: number
  depth: number
  cls: FixtureClass
  /** Schedule mark ('A01'). */
  mark: string
  /** True when the plan point came through a wall frame. */
  wallHosted: boolean
}

type Vec3 = [number, number, number]

function vec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value)) return fallback
  const out: Vec3 = [...fallback]
  for (let i = 0; i < 3; i++) {
    const v = value[i]
    if (typeof v === 'number' && Number.isFinite(v)) out[i] = v
  }
  return out
}

/**
 * Plan transform of an item, mirroring the host's `resolveItemTransform`.
 * Returns null when the item hangs off a host this mirror does not model
 * (a roof face, a block face, a shelf) — the caller warns rather than
 * drawing the fixture at the wrong spot.
 */
export function itemPlanTransform(
  nodes: NodeMap,
  node: Record<string, unknown>,
  depth = 0,
): { x: number; y: number; rotation: number; wallHosted: boolean } | null {
  if (depth > 8) return null
  const position = vec3(node.position, [0, 0, 0])
  const localRotation = vec3(node.rotation, [0, 0, 0])[1]
  const parentId = typeof node.parentId === 'string' ? node.parentId : ''
  const parent = parentId ? nodes[parentId] : undefined

  if (parent?.type === 'wall') {
    const start = parent.start as [number, number] | undefined
    const end = parent.end as [number, number] | undefined
    if (!Array.isArray(start) || !Array.isArray(end)) return null
    const wallRotation = -Math.atan2(end[1] - start[1], end[0] - start[0])
    const asset = (node.asset ?? {}) as { attachTo?: string }
    const thickness = typeof parent.thickness === 'number' ? parent.thickness : 0.1
    const wallLocalZ =
      asset.attachTo === 'wall-side'
        ? (thickness / 2) * (node.side === 'front' ? 1 : -1)
        : position[2]
    const [offsetX, offsetY] = rotateVec(position[0], wallLocalZ, wallRotation)
    return {
      x: start[0] + offsetX,
      y: start[1] + offsetY,
      rotation: wallRotation + localRotation,
      wallHosted: true,
    }
  }

  if (parent?.type === 'item') {
    const parentT = itemPlanTransform(nodes, parent, depth + 1)
    if (!parentT) return null
    const [offsetX, offsetY] = rotateVec(position[0], position[2], parentT.rotation)
    return {
      x: parentT.x + offsetX,
      y: parentT.y + offsetY,
      rotation: parentT.rotation + localRotation,
      wallHosted: parentT.wallHosted,
    }
  }

  if (parent?.type === 'roof-segment' || parent?.type === 'block' || parent?.type === 'shelf') {
    return null
  }

  // Level / slab / ceiling parent — the position IS level-local.
  return { x: position[0], y: position[2], rotation: localRotation, wallHosted: false }
}

/**
 * Marks for the level's plumbing fixtures.
 *
 * `buildFixtureSchedule` owns the schedule. When it has rows, its marks win
 * — matched by the row's description, case-insensitively, so the plan bubble
 * and the schedule row carry the same letters. When it has none (the stub, or
 * a level it found nothing on), the same rule it will apply is applied here:
 * distinct descriptions sorted, then A01, A02, …
 */
export function fixtureMarks(
  nodes: NodeMap,
  levelId: string,
  descriptions: readonly string[],
): { marks: Map<string, string>; fromSchedule: boolean } {
  const marks = new Map<string, string>()
  let fromSchedule = false
  try {
    const table = buildFixtureSchedule(nodes, levelId)
    for (const row of table.rows) {
      const description = String(row.description ?? '').trim()
      const mark = String(row.mark ?? '').trim()
      if (description && mark) {
        marks.set(description.toLowerCase(), mark)
        fromSchedule = true
      }
    }
  } catch {
    // A schedule that throws must not take the plan down with it.
  }
  const distinct = [...new Set(descriptions)].sort((a, b) => a.localeCompare(b))
  distinct.forEach((description, index) => {
    const key = description.toLowerCase()
    if (marks.has(key)) return
    marks.set(key, `A${String(index + 1).padStart(2, '0')}`)
  })
  return { marks, fromSchedule }
}

/**
 * Every plumbing-connected item on the level, with its plan transform, class
 * and schedule mark. `skipped` names the items whose host frame this mirror
 * cannot resolve, so the sheet can say so instead of dropping them silently.
 */
export function placedPlumbingItems(
  nodes: NodeMap,
  levelId: string,
): { items: PlacedItem[]; skipped: string[]; marksFromSchedule: boolean } {
  const rows: {
    id: string
    node: Record<string, unknown>
    cls: FixtureClass
    transform: ReturnType<typeof itemPlanTransform>
  }[] = []
  const skipped: string[] = []

  for (const node of Object.values(nodes)) {
    if (node?.type !== 'item') continue
    if (node.visible === false) continue
    if (!onLevel(nodes, node, levelId)) continue
    const asset = (node.asset ?? {}) as { id?: string; category?: string; name?: string }
    const cls = classifyItem(
      String(asset.id ?? ''),
      String(asset.category ?? ''),
      String(asset.name ?? ''),
    )
    if (!cls) continue
    const transform = itemPlanTransform(nodes, node)
    if (!transform) {
      skipped.push(String(asset.name || asset.id || node.id))
      continue
    }
    rows.push({ id: String(node.id), node, cls, transform })
  }

  rows.sort((a, b) => a.id.localeCompare(b.id))
  const { marks, fromSchedule } = fixtureMarks(
    nodes,
    levelId,
    rows.map((r) => r.cls.description),
  )

  const items: PlacedItem[] = rows.map(({ id, node, cls, transform }) => {
    const asset = (node.asset ?? {}) as { dimensions?: unknown; attachTo?: string }
    const dimensions = vec3(asset.dimensions, [0.6, 0.8, 0.6])
    const scale = vec3(node.scale, [1, 1, 1])
    const width = Math.abs(dimensions[0] * scale[0])
    const depth = Math.abs(dimensions[2] * scale[2])
    // A wall-SIDE item hangs off the wall face: the host draws its footprint
    // pushed a half-depth off the face, and the plan mark follows the body.
    const t = transform as NonNullable<typeof transform>
    let { x, y } = t
    if (asset.attachTo === 'wall-side') {
      const [dx, dy] = rotateVec(0, depth / 2, t.rotation)
      x += dx
      y += dy
    }
    return {
      id,
      plan: [x, y],
      rotation: t.rotation,
      width,
      depth,
      cls,
      mark: marks.get(cls.description.toLowerCase()) ?? 'A??',
      wallHosted: t.wallHosted,
    }
  })
  return { items, skipped, marksFromSchedule: fromSchedule }
}

/** Whether an item belongs to `levelId`, following item→item→wall→level. */
function onLevel(
  nodes: NodeMap,
  node: Record<string, unknown>,
  levelId: string,
  depth = 0,
): boolean {
  if (depth > 8) return false
  const parentId = typeof node.parentId === 'string' ? node.parentId : ''
  if (!parentId) return false
  if (parentId === levelId) return true
  const parent = nodes[parentId]
  if (!parent) return false
  if (parent.type === 'level') return parent.id === levelId
  return onLevel(nodes, parent, levelId, depth + 1)
}

/** The key letters printed beside a fixture, in W H C G T order. */
export function serviceLetters(service: PlumbingService): string {
  return [
    service.w ? 'W' : '',
    service.h ? 'H' : '',
    service.c ? 'C' : '',
    service.g ? 'G' : '',
    service.t ? 'T' : '',
  ]
    .filter(Boolean)
    .join(',')
}
