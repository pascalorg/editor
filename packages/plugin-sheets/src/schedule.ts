/**
 * Schedules.
 *
 * The marks on a schedule and the mark bubbles on the plan MUST be the same
 * numbers, so where the host already owns the answer, Sheets uses it: door
 * and window kinds contribute a `FloorplanSchedule` through
 * `def.extensions['pascal:editor/floorplan'].schedule`
 * (`packages/nodes/src/shared/opening-documentation.ts`), and its
 * `resolveOpeningMarks` is what the plan's bubbles read too. `adaptSchedule`
 * converts one of those into the table this package draws.
 *
 * The functions below are the FALLBACK for a scene whose openings contribute
 * no schedule (and the room schedule, which no kind contributes at all).
 * They implement the same rule the host does — a node's own `mark` wins;
 * otherwise a deterministic per-level number, level 0 → 101, 102 …, level 1 →
 * 201 … — so the two paths agree on the numbers even though only one of them
 * runs at a time.
 */
import { INCHES_PER_METRE } from './scale'
import { buildFixtureSchedule } from './schedule-fixtures'

export type ScheduleNodes = Record<
  string,
  (Record<string, unknown> & { id: string; type: string }) | undefined
>

export type ScheduleColumn = { key: string; label: string; weight: number }
export type ScheduleRow = Record<string, string>

export type ScheduleTable = {
  title: string
  columns: ScheduleColumn[]
  rows: ScheduleRow[]
  issues: string[]
}

/** A host `FloorplanSchedule` → the table this package draws. */
export function adaptSchedule(schedule: {
  title: string
  columns: ReadonlyArray<{ key: string; label: string; weight?: number }>
  rows: ReadonlyArray<{ cells: Readonly<Record<string, string>> }>
  issues?: readonly string[]
}): ScheduleTable {
  return {
    title: schedule.title,
    columns: schedule.columns.map((c) => ({ key: c.key, label: c.label, weight: c.weight ?? 1 })),
    rows: schedule.rows.map((r) => ({ ...r.cells })),
    issues: [...(schedule.issues ?? [])],
  }
}

export const OPENING_COLUMNS: ScheduleColumn[] = [
  { key: 'mark', label: 'MARK', weight: 0.8 },
  { key: 'type', label: 'TYPE', weight: 1.6 },
  { key: 'width', label: 'WIDTH', weight: 1 },
  { key: 'height', label: 'HEIGHT', weight: 1 },
  { key: 'notes', label: 'REMARKS', weight: 2.2 },
]

/** Depth-first walk of a level's subtree — the order marks are assigned in. */
export function walkLevel(nodes: ScheduleNodes, levelId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = nodes[id]
    if (!node) return
    out.push(id)
    const children = node.children
    if (Array.isArray(children)) for (const child of children) visit(String(child))
  }
  visit(levelId)
  return out
}

export function levelIndexOf(nodes: ScheduleNodes, levelId: string): number {
  const value = nodes[levelId]?.level
  return typeof value === 'number' ? value : 0
}

/**
 * Deterministic mark for every opening of one type on one level.
 * A node's own `mark` wins but does NOT consume a number — the sequence
 * counts positions, so adding an override never renumbers what follows.
 */
export function resolveMarks(
  nodes: ScheduleNodes,
  levelId: string,
  type: 'door' | 'window',
): Map<string, string> {
  const base = (levelIndexOf(nodes, levelId) + 1) * 100
  const marks = new Map<string, string>()
  let n = 0
  for (const id of walkLevel(nodes, levelId)) {
    const node = nodes[id]
    if (!node || node.type !== type) continue
    n += 1
    const own = typeof node.mark === 'string' ? node.mark.trim() : ''
    marks.set(id, own || String(base + n))
  }
  return marks
}

/** Metres → a feet-and-inches string, the only unit a schedule prints. */
export function feetInches(metres: number): string {
  const totalInches = metres * INCHES_PER_METRE
  const rounded = Math.round(totalInches * 2) / 2
  const feet = Math.floor(rounded / 12)
  const inches = rounded - feet * 12
  const inchText = Number.isInteger(inches) ? `${inches}` : inches.toFixed(1)
  return `${feet}'-${inchText}"`
}

function label(node: Record<string, unknown>, fallback: string): string {
  const raw =
    (typeof node.doorType === 'string' && node.doorType) ||
    (typeof node.windowType === 'string' && node.windowType) ||
    (typeof node.name === 'string' && node.name) ||
    fallback
  return String(raw)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function buildOpeningSchedule(
  nodes: ScheduleNodes,
  levelId: string,
  type: 'door' | 'window',
): ScheduleTable {
  const marks = resolveMarks(nodes, levelId, type)
  const rows: ScheduleRow[] = []
  for (const id of walkLevel(nodes, levelId)) {
    const node = nodes[id]
    if (!node || node.type !== type) continue
    if (node.visible === false) continue
    rows.push({
      mark: marks.get(id) ?? '',
      type: label(node, type === 'door' ? 'Door' : 'Window'),
      width: feetInches(typeof node.width === 'number' ? node.width : 0),
      height: feetInches(typeof node.height === 'number' ? node.height : 0),
      notes: typeof node.material === 'string' ? node.material : '',
    })
  }
  rows.sort((a, b) =>
    String(a.mark).localeCompare(String(b.mark), undefined, { numeric: true }),
  )
  return {
    title: type === 'door' ? 'DOOR SCHEDULE' : 'WINDOW SCHEDULE',
    columns: OPENING_COLUMNS,
    rows,
    issues: [],
  }
}

/** Room schedule — one row per zone on the level. No kind contributes this. */
export function buildRoomSchedule(nodes: ScheduleNodes, levelId: string): ScheduleTable {
  const rows: ScheduleRow[] = []
  let n = 0
  for (const id of walkLevel(nodes, levelId)) {
    const node = nodes[id]
    if (!node || node.type !== 'zone') continue
    if (node.visible === false) continue
    n += 1
    rows.push({
      mark: String((levelIndexOf(nodes, levelId) + 1) * 100 + n),
      type: typeof node.name === 'string' && node.name ? node.name : 'Room',
      notes: '',
    })
  }
  return {
    title: 'ROOM SCHEDULE',
    columns: [
      { key: 'mark', label: 'NO.', weight: 0.7 },
      { key: 'type', label: 'ROOM', weight: 2.4 },
      { key: 'notes', label: 'REMARKS', weight: 2.4 },
    ],
    rows,
    issues: [],
  }
}

export function buildSchedule(
  nodes: ScheduleNodes,
  levelId: string,
  of: 'doors' | 'windows' | 'rooms' | 'fixtures',
): ScheduleTable {
  if (of === 'rooms') return buildRoomSchedule(nodes, levelId)
  if (of === 'fixtures') return buildFixtureSchedule(nodes as never, levelId)
  return buildOpeningSchedule(nodes, levelId, of === 'doors' ? 'door' : 'window')
}
