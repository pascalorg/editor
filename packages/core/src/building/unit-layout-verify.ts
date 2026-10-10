import {
  mergeSegments,
  OPEN_PLAN_ROOMS,
  outlineEdges,
  overlapOnEdge,
  type Pt,
  polygonArea,
  polygonRects,
  type Rect,
  rectArea,
  roomContacts,
  roomGap,
  roomNarrowest,
  roomWidth,
  type Segment,
  TOL,
  type UnitLayout,
  type UnitSpace,
  WET_ROOMS,
} from './unit-layout'

/**
 * Funnel stage 3: the hard rules, each with a signed margin in metres (or m², or a count) — how
 * far the layout is from failing it. Soft preferences (kitchen by the living room, short
 * corridors) are the judges' business: a check that is too strict silently deletes good layouts.
 */

export type UnitRule =
  | 'covers_outline'
  | 'doors_on_walls'
  | 'rooms_reachable'
  | 'min_width'
  | 'bath_door'
  | 'entry_door'
  | 'wet_grouped'

export type RuleResult = { rule: UnitRule; margin: number; room?: string }
export type UnitVerdict = { ok: boolean; margin: number; rules: RuleResult[] }

/** Centreline metres. */
export const UNIT_RULES = {
  /** The plan's 2.7 m rejects the Victor's B2 bedroom 1 (2.66 m with its closet alcove). */
  bedroomWidth: 2.4,
  bathroomWidth: 1.5,
  hallWidth: 0.9,
  window: 0.9,
  /** Wall left on each side of a door. */
  jamb: 0.05,
  /** Every wet room is at most this far from another one. */
  wetGap: 3,
}
export type UnitRules = typeof UNIT_RULES

/** Coverage errors below this (m²) are rounding. */
const AREA_TOL = 1e-4

function intersection(p: Rect, q: Rect) {
  const w = Math.min(p[2], q[2]) - Math.max(p[0], q[0])
  const h = Math.min(p[3], q[3]) - Math.max(p[1], q[1])
  return w > 0 && h > 0 ? w * h : 0
}

function coverage(space: UnitSpace, layout: UnitLayout): RuleResult {
  const rects = layout.rooms.flatMap((r) => r.rects)
  const outline = polygonRects(space.outline)
  let overlap = 0
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) overlap += intersection(rects[i]!, rects[j]!)
  const total = rects.reduce((sum, r) => sum + rectArea(r), 0)
  const inside = rects.reduce(
    (sum, r) => sum + outline.reduce((s, o) => s + intersection(r, o), 0),
    0,
  )
  const hole = polygonArea(space.outline) - (inside - overlap)
  const error = overlap + (total - inside) + Math.max(0, hole)
  return { rule: 'covers_outline', margin: error > AREA_TOL ? -error : 0 }
}

/** How far a span of `width` centred at `at` sits inside a segment, jambs kept; negative when off it. */
function spanMargin(at: Pt, width: number, segment: Segment, jamb: number) {
  const vertical = Math.abs(segment.a[0] - segment.b[0]) < TOL
  const line = vertical ? 0 : 1
  const axis = vertical ? 1 : 0
  const off = Math.abs(at[line] - segment.a[line])
  if (off > TOL) return -off
  const lo = Math.min(segment.a[axis], segment.b[axis]) + jamb
  const hi = Math.max(segment.a[axis], segment.b[axis]) - jamb
  return Math.min(at[axis] - width / 2 - lo, hi - (at[axis] + width / 2))
}

const worst = (rule: UnitRule, entries: { margin: number; room?: string }[]): RuleResult[] => {
  if (!entries.length) return []
  const min = entries.reduce((p, q) => (q.margin < p.margin ? q : p))
  return [{ rule, ...min }]
}

export function verifyUnitLayout(
  space: UnitSpace,
  layout: UnitLayout,
  rules: UnitRules = UNIT_RULES,
): UnitVerdict {
  const results: RuleResult[] = [coverage(space, layout)]
  const contacts = roomContacts(layout)
  const between = (p: string, q: string) => contacts.get(p < q ? `${p}|${q}` : `${q}|${p}`) ?? []
  const type = new Map(layout.rooms.map((r) => [r.id, r.type]))

  const doors = layout.doors.map((door) => {
    const margins = between(...door.rooms).map((s) =>
      spanMargin(door.at, door.width, s, rules.jamb),
    )
    return { door, margin: margins.length ? Math.max(...margins) : -1 }
  })
  results.push(
    ...worst(
      'doors_on_walls',
      doors.map((d) => ({ margin: d.margin, room: d.door.rooms[0] })),
    ),
  )

  const links = new Map<string, string[]>(layout.rooms.map((r) => [r.id, []]))
  const link = (p: string, q: string) => {
    links.get(p)?.push(q)
    links.get(q)?.push(p)
  }
  for (const { door, margin } of doors) if (margin >= 0) link(...door.rooms)
  for (const [p, q] of layout.open) {
    const length = between(p, q).reduce(
      (sum, s) => sum + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]),
      0,
    )
    if (length >= rules.hallWidth) link(p, q)
  }
  const reached = new Set([layout.entry.room])
  const queue = [layout.entry.room]
  while (queue.length)
    for (const next of links.get(queue.pop()!) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  const unreached = layout.rooms.filter((r) => !reached.has(r.id))
  results.push({ rule: 'rooms_reachable', margin: -unreached.length, room: unreached[0]?.id })

  const widths = layout.rooms.flatMap((r) => {
    if (r.type === 'bedroom') return [{ margin: roomWidth(r) - rules.bedroomWidth, room: r.id }]
    if (r.type === 'bathroom') return [{ margin: roomWidth(r) - rules.bathroomWidth, room: r.id }]
    if (r.type === 'hall') return [{ margin: roomNarrowest(r) - rules.hallWidth, room: r.id }]
    return []
  })
  results.push(...worst('min_width', widths))

  const day = new Set(['kitchen', 'living'])
  const bathDoors = layout.doors.filter((d) => {
    const [p, q] = d.rooms.map((id) => type.get(id))
    return (p === 'bathroom' && day.has(q!)) || (q === 'bathroom' && day.has(p!))
  })
  const bathOpen = layout.open.filter(
    ([p, q]) => type.get(p) === 'bathroom' || type.get(q) === 'bathroom',
  )
  results.push({
    rule: 'bath_door',
    margin: -(bathDoors.length + bathOpen.length),
    room: bathDoors[0]?.rooms[0],
  })

  results.push(entryDoor(space, layout, rules))

  const wet = layout.rooms.filter((r) => WET_ROOMS.has(r.type))
  if (wet.length > 1)
    results.push(
      ...worst(
        'wet_grouped',
        wet.map((r) => ({
          margin: rules.wetGap - Math.min(...wet.filter((o) => o !== r).map((o) => roomGap(r, o))),
          room: r.id,
        })),
      ),
    )

  // Micrometre rounding: a door exactly as wide as its wall passes.
  for (const r of results) r.margin = Math.round(r.margin * 1e6) / 1e6 || 0
  const margin = Math.min(...results.map((r) => r.margin))
  return { ok: margin >= 0, margin, rules: results }
}

function entryDoor(space: UnitSpace, layout: UnitLayout, rules: UnitRules): RuleResult {
  const { entry } = layout
  const edge = outlineEdges(space)[space.entryEdge]!
  const room = layout.rooms.find((r) => r.id === entry.room)
  if (!(room && OPEN_PLAN_ROOMS.has(room.type)))
    return { rule: 'entry_door', margin: -1, room: entry.room }
  const along = mergeSegments(
    room.rects.flatMap((rect) => {
      const overlap = overlapOnEdge(rect, edge)
      return overlap ? [overlap] : []
    }),
  )
  const spans = along.map((s) => spanMargin(entry.at, entry.width, s, rules.jamb))
  return { rule: 'entry_door', margin: spans.length ? Math.max(...spans) : -1, room: entry.room }
}
