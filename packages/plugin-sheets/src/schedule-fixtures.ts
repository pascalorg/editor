/**
 * FIXTURE / APPLIANCE SCHEDULE — the placed items of a level, as the table a
 * permit set carries next to the floor plan (see the reference set's A3
 * FIXTURE SCHEDULE: LABEL / DESCRIPTION / QTY / INFO / STATUS).
 *
 * WHAT GETS SCHEDULED. Items in the catalog's `kitchen`, `bathroom` and
 * `appliance` categories, plus anything whose asset id matches a known
 * fixture (a water heater filed under `furniture` still belongs here). Loose
 * props in those categories — the kettle, the toaster, the fruit bowl, the
 * shower rug — are excluded by `DECOR`: a fixture schedule is a list of
 * things that get connected to something, not a list of things on a counter.
 *
 * THE INFO COLUMN IS A DRAFTING CONVENTION, NOT A CODE VALUE. It is the
 * rough-in key a plumber and an electrician read off the schedule:
 *
 *     H  hot water supply          W  waste / drain and vent
 *     C  cold water supply         T  thermostatic or pressure-balancing
 *                                     mixing valve (IRC P2708.4)
 *     ELECTRIC  a dedicated branch circuit is required at this fixture
 *
 * and it is assigned per fixture type by `SERVICE`:
 *
 *     sink (kitchen / lavatory / wall)  H, C, W
 *     water closet                      C, W
 *     tub / shower / tub-shower         H, C, W, T
 *     dishwasher                        H, W  + ELECTRIC
 *     clothes washer                    H, C, W
 *     refrigerator                      C (ice maker)
 *     range / oven / cooktop / hood /
 *       microwave                       ELECTRIC
 *     water heater                      H, C  + ELECTRIC
 *     condenser / air handler / panel /
 *       alarm / fan / charger           ELECTRIC
 *
 * Circuit sizes, trap sizes and fixture units are NOT invented here — those
 * belong to the plumbing and electrical engines, which key off the same marks
 * through `fixtureMarks`.
 */
import type { AnyNodeLike, NodeMap } from './model'
import type { ScheduleColumn, ScheduleRow, ScheduleTable } from './schedule'

export const FIXTURE_COLUMNS: ScheduleColumn[] = [
  { key: 'mark', label: 'LABEL', weight: 0.7 },
  { key: 'description', label: 'DESCRIPTION', weight: 1.9 },
  { key: 'qty', label: 'QTY', weight: 0.5 },
  { key: 'info', label: 'INFO', weight: 2.1 },
  { key: 'status', label: 'STATUS', weight: 0.7 },
]

/** The catalog categories a fixture schedule draws from. */
const SCHEDULED_CATEGORIES = new Set(['kitchen', 'bathroom', 'appliance'])

/**
 * Loose props that live in a scheduled category but are not fixtures. The
 * first block is the list the drafting convention names explicitly; the
 * second is the rest of the shipped catalog's decor and portable equipment
 * (a television is plugged in, not connected).
 */
export const DECOR = new Set([
  'kettle',
  'toaster',
  'fruits',
  'cutting-board',
  'kitchen-utensils',
  'wine-bottle',
  'toilet-paper',
  'toilet-brush',
  'shower-rug',
  'laundry-bag',
  'iron',
  // Portable / decorative items in the same catalog categories.
  'frying-pan',
  'coffee-machine',
  'television',
  'stereo-speaker',
  'computer',
  'sewing-machine',
  'drying-rack',
  'ironing-board',
  'trash-bin',
])

type ServiceRule = { match: RegExp; info: string }

/**
 * asset id → the rough-in key printed in INFO. Order matters: the first rule
 * whose pattern matches the asset id wins, so the specific patterns
 * ('dishwasher') come before the general ones ('washer').
 */
const SERVICE: ServiceRule[] = [
  { match: /^(dishwasher|dish-washer)/, info: 'PLUMBING: H,W · ELECTRIC' },
  { match: /^(washing-machine|clothes-washer|washer)/, info: 'PLUMBING: H,C,W' },
  { match: /(water-heater|waterheater|boiler)/, info: 'PLUMBING: H,C · ELECTRIC' },
  { match: /^(toilet|water-closet|wc)\b|^toilet$/, info: 'PLUMBING: C,W' },
  { match: /^(bathtub|tub)/, info: 'PLUMBING: H,C,W,T' },
  { match: /^shower/, info: 'PLUMBING: H,C,W,T' },
  { match: /(sink|lavatory|basin)/, info: 'PLUMBING: H,C,W' },
  { match: /^kitchen(-counter)?$/, info: 'PLUMBING: H,C,W' },
  { match: /^(fridge|refrigerator)/, info: 'PLUMBING: C (ICE MAKER)' },
  { match: /^(stove|range|oven|cooktop|microwave|hood)/, info: 'ELECTRIC' },
  {
    match: /^(ac-block|air-conditioning|condenser|heat-pump|air-handler|furnace)/,
    info: 'ELECTRIC',
  },
  { match: /^(electric-panel|sub-panel|ev-wall-charger|power-outlet)/, info: 'ELECTRIC' },
  {
    match: /^(thermostat|smoke-detector|fire-detector|alarm-keypad|ceiling-fan|exhaust-fan)/,
    info: 'ELECTRIC',
  },
]

/** Fixtures worth scheduling even when the catalog files them elsewhere. */
const ALWAYS_SCHEDULE =
  /(sink|toilet|bathtub|^tub|^shower|water-heater|dishwasher|washing-machine|^fridge|^stove|^range|^oven|^cooktop|^microwave|^hood|electric-panel|ac-block|air-conditioning|thermostat|smoke-detector|ceiling-fan|ev-wall-charger)/

/* ------------------------------------------------------------ walking */

/**
 * Every node under a level — both the `children` arrays and the `parentId`
 * back-references, so an item attached to a wall (parented to the wall)
 * arrives whichever way the scene records the link.
 */
export function levelSubtree(nodes: NodeMap, levelId: string): AnyNodeLike[] {
  if (!nodes[levelId]) return []
  const childrenOf = new Map<string, string[]>()
  const push = (parent: string, child: string) => {
    const list = childrenOf.get(parent)
    if (list) list.push(child)
    else childrenOf.set(parent, [child])
  }
  for (const node of Object.values(nodes)) {
    if (!node) continue
    const parent = typeof node.parentId === 'string' ? node.parentId : ''
    if (parent) push(parent, node.id)
    const declared = node.children
    if (Array.isArray(declared)) {
      for (const child of declared) if (typeof child === 'string') push(node.id, child)
    }
  }
  const seen = new Set<string>([levelId])
  const out: AnyNodeLike[] = []
  const queue = [levelId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const child of childrenOf.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      const node = nodes[child]
      if (!node) continue
      out.push(node)
      queue.push(child)
    }
  }
  return out
}

/* ------------------------------------------------------- classifying */

function assetOf(node: AnyNodeLike): { id: string; name: string; category: string } {
  const asset = (node.asset ?? {}) as Record<string, unknown>
  return {
    id: typeof asset.id === 'string' ? asset.id.toLowerCase() : '',
    name: typeof asset.name === 'string' ? asset.name : '',
    category: typeof asset.category === 'string' ? asset.category.toLowerCase() : '',
  }
}

/** Whether a placed item belongs on the fixture schedule. */
export function isScheduledFixture(node: AnyNodeLike): boolean {
  if (node.type !== 'item' || node.visible === false) return false
  const asset = assetOf(node)
  if (!asset.id) return false
  if (DECOR.has(asset.id)) return false
  if (ALWAYS_SCHEDULE.test(asset.id)) return true
  return SCHEDULED_CATEGORIES.has(asset.category)
}

/** The INFO cell for an asset id — '—' when the item takes no service. */
export function serviceFor(assetId: string): string {
  const id = assetId.toLowerCase()
  for (const rule of SERVICE) if (rule.match.test(id)) return rule.info
  return '—'
}

/** 'kitchen-counter' → 'KITCHEN COUNTER', when the asset carries no name. */
function describe(asset: { id: string; name: string }): string {
  const raw = asset.name.trim() || asset.id.replace(/-mo[a-z0-9]{6,}$/i, '').replace(/[-_]/g, ' ')
  return raw.replace(/[-_]/g, ' ').trim().toUpperCase()
}

/** A01 … A99, then A100 — the label column of the reference schedule. */
export function fixtureMark(index: number): string {
  const n = index + 1
  return `A${n < 100 ? String(n).padStart(2, '0') : String(n)}`
}

/* ------------------------------------------------------------- groups */

type Group = {
  key: string
  description: string
  info: string
  ids: string[]
}

/**
 * Identical assets collapse into one scheduled row with a QTY. The rows are
 * ordered by DESCRIPTION then by asset id, so the label a fixture gets is a
 * function of the scene's content and not of the order it was drawn in — the
 * same scene always produces the same A01.
 */
function groupsFor(nodes: NodeMap, levelId: string): { groups: Group[]; unmapped: number } {
  const byKey = new Map<string, Group>()
  let unmapped = 0
  for (const node of levelSubtree(nodes, levelId)) {
    if (!isScheduledFixture(node)) continue
    const asset = assetOf(node)
    const info = serviceFor(asset.id)
    if (info === '—') unmapped += 1
    const existing = byKey.get(asset.id)
    if (existing) existing.ids.push(node.id)
    else
      byKey.set(asset.id, {
        key: asset.id,
        description: describe(asset),
        info,
        ids: [node.id],
      })
  }
  const groups = [...byKey.values()].sort(
    (a, b) => a.description.localeCompare(b.description) || a.key.localeCompare(b.key),
  )
  for (const group of groups) group.ids.sort()
  return { groups, unmapped }
}

/**
 * itemId → the label its row carries, so the plumbing and electrical plans
 * can tag the same fixtures with the same marks the schedule prints.
 */
export function fixtureMarks(nodes: NodeMap, levelId: string): Map<string, string> {
  const out = new Map<string, string>()
  const { groups } = groupsFor(nodes, levelId)
  groups.forEach((group, index) => {
    const mark = fixtureMark(index)
    for (const id of group.ids) out.set(id, mark)
  })
  return out
}

export function buildFixtureSchedule(nodes: NodeMap, levelId: string): ScheduleTable {
  const { groups, unmapped } = groupsFor(nodes, levelId)
  const rows: ScheduleRow[] = groups.map((group, index) => ({
    mark: fixtureMark(index),
    description: group.description,
    qty: String(group.ids.length),
    info: group.info,
    status: 'NEW',
  }))
  const issues: string[] = []
  if (unmapped > 0) {
    issues.push(
      `${unmapped} scheduled item${unmapped === 1 ? '' : 's'} ha${unmapped === 1 ? 's' : 've'} no rough-in mapping — INFO reads "—"; fill it in by hand.`,
    )
  }
  return {
    title: 'FIXTURE SCHEDULE',
    columns: FIXTURE_COLUMNS,
    rows,
    issues,
  }
}
