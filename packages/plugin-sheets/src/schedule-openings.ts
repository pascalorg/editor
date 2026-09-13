/**
 * DOOR / WINDOW SCHEDULE ENRICHMENT — the columns a permit set's schedule
 * carries beyond mark and size, derived from the model:
 *
 *   QTY       identical openings (same type, size, operation) collapse into
 *             one row whose MARK lists every mark, the way the reference set
 *             prints "(N) W07 · 3050SH · 8".
 *   EGRESS    windows: "REQ'D" when the window's wall bounds a sleeping room
 *             (a room zone named BEDROOM …), with the R310 checks the model
 *             can make — sill ≤ 44 in AFF (R310.2.3) and the nominal size at
 *             least 20 in wide × 24 in high (R310.2.2). The NET CLEAR opening
 *             (5.7 sf, R310.2.1) depends on the sash/operation and is not
 *             modelled, so it prints as "verify".
 *   TEMPERED  R308.4 hazardous locations the model can test: glazing in a
 *             door (R308.4.1 — any door type naming glass, french, sliding,
 *             patio); glazing within 24 in of a door on the same wall
 *             (R308.4.2); a large low pane — > 9 sf, bottom edge < 18 in,
 *             top edge > 36 in AFF (R308.4.3; the 36 in walking-surface
 *             condition is assumed met indoors). Tub / shower enclosures
 *             (R308.4.5) are not tested — the fixtures' positions are not
 *             tied to the openings — and print nothing, never "no".
 *   STATUS    NEW.
 *
 * The citations are IRC 2021 sections; the FBC-R 8th edition carries the same
 * numbering for these. Everything here reads the scene only — nothing is
 * stored back on the nodes.
 */
import type { ScheduleColumn, ScheduleNodes, ScheduleRow, ScheduleTable } from './schedule'

const INCH = 0.0254
const SQ_FT = 0.09290304

type Opening = {
  id: string
  type: 'door' | 'window'
  wallId: string | null
  along: number
  width: number
  height: number
  /** Sill above the level floor, metres (doors: 0). */
  sill: number
  kind: string
  mark: string
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function openingsOnLevel(nodes: ScheduleNodes, levelId: string, type: 'door' | 'window'): Opening[] {
  const out: Opening[] = []
  const wallsOnLevel = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node?.type === 'wall' && node.parentId === levelId) wallsOnLevel.add(node.id)
  }
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== type || node.visible === false) continue
    const wallId =
      typeof node.wallId === 'string'
        ? node.wallId
        : typeof node.parentId === 'string' && wallsOnLevel.has(node.parentId)
          ? node.parentId
          : null
    if (!wallId || !wallsOnLevel.has(wallId)) continue
    const position = Array.isArray(node.position) ? (node.position as number[]) : [0, 0, 0]
    const height = num(node.height)
    const centreY = num(position[1])
    out.push({
      id: node.id,
      type,
      wallId,
      along: num(position[0]),
      width: num(node.width),
      height,
      sill: type === 'door' ? 0 : Math.max(0, centreY - height / 2),
      kind: String(node.doorType ?? node.windowType ?? node.name ?? type),
      mark: typeof node.mark === 'string' ? node.mark : '',
    })
  }
  return out
}

/**
 * The room an opening serves: the zone whose polygon holds the point just
 * inside the wall at the opening — for an exterior wall that is the one room
 * behind it, which is what R310 asks about. A wall's whole `boundaryWallIds`
 * list would make every window on a long exterior wall "in" every room along
 * it. Null when no zone contains either side (then the wall list is the
 * fallback).
 */
function roomAtOpening(nodes: ScheduleNodes, opening: Opening): string | null {
  const wall = opening.wallId ? nodes[opening.wallId] : undefined
  const start = Array.isArray(wall?.start) ? (wall.start as number[]) : null
  const end = Array.isArray(wall?.end) ? (wall.end as number[]) : null
  if (!start || !end) return null
  const dx = num(end[0]) - num(start[0])
  const dz = num(end[1]) - num(start[1])
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const ax = dx / length
  const az = dz / length
  const cx = num(start[0]) + ax * opening.along
  const cz = num(start[1]) + az * opening.along
  const reach = num(wall?.thickness, 0.15) / 2 + 0.12
  const probes: [number, number][] = [
    [cx - az * reach, cz + ax * reach],
    [cx + az * reach, cz - ax * reach],
  ]
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'zone' || node.parentId !== wall?.parentId) continue
    const ring = Array.isArray(node.polygon) ? (node.polygon as number[][]) : []
    if (ring.length < 3 || typeof node.name !== 'string') continue
    if (probes.some((p) => pointInRing(p, ring))) return node.name
  }
  return null
}

function pointInRing(p: [number, number], ring: readonly number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = num(ring[i]?.[0])
    const zi = num(ring[i]?.[1])
    const xj = num(ring[j]?.[0])
    const zj = num(ring[j]?.[1])
    const crosses = zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi || 1e-12) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Zones (rooms) whose boundary includes `wallId`. */
function roomsOnWall(nodes: ScheduleNodes, wallId: string): string[] {
  const names: string[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'zone') continue
    const ids = Array.isArray(node.boundaryWallIds) ? (node.boundaryWallIds as string[]) : []
    if (ids.includes(wallId) && typeof node.name === 'string') names.push(node.name)
  }
  return names
}

const GLASS_DOOR = /glass|french|slid|patio|storefront|lite/i

export function temperedReason(
  opening: Opening,
  doorsOnWall: readonly Opening[],
): string | null {
  if (opening.type === 'door') {
    return GLASS_DOOR.test(opening.kind) ? 'YES (R308.4.1)' : null
  }
  // R308.4.2 — within 24 in of either jamb of a door on the same wall.
  for (const door of doorsOnWall) {
    const gap = Math.abs(door.along - opening.along) - (door.width + opening.width) / 2
    if (gap <= 24 * INCH) return 'YES (R308.4.2)'
  }
  // R308.4.3 — big low pane.
  const area = opening.width * opening.height
  const bottom = opening.sill
  const top = opening.sill + opening.height
  if (area > 9 * SQ_FT && bottom < 18 * INCH && top > 36 * INCH) return 'YES (R308.4.3)'
  return null
}

export function egressNote(opening: Opening, rooms: readonly string[]): string {
  if (opening.type !== 'window') return ''
  const sleeping = rooms.some((name) => /bed|sleep/i.test(name))
  if (!sleeping) return ''
  const problems: string[] = []
  if (opening.sill > 44 * INCH) problems.push('sill > 44" (R310.2.3)')
  if (opening.width < 20 * INCH) problems.push('< 20" wide (R310.2.2)')
  if (opening.height < 24 * INCH) problems.push('< 24" high (R310.2.2)')
  if (problems.length > 0) return `REQ'D — ${problems.join(', ')}`
  return `REQ'D — verify 5.7 sf net clear (R310.2.1)`
}

/**
 * Add QTY / EGRESS / TEMPERED / STATUS to a door or window table and collapse
 * identical rows. Rows are matched to nodes by MARK, which both the host
 * schedule and the fallback derive the same way.
 */
export function enrichOpeningSchedule(
  table: ScheduleTable,
  nodes: ScheduleNodes,
  levelId: string,
  of: 'doors' | 'windows',
): ScheduleTable {
  const type = of === 'doors' ? 'door' : 'window'
  const openings = openingsOnLevel(nodes, levelId, type)
  const doorsByWall = new Map<string, Opening[]>()
  for (const door of openingsOnLevel(nodes, levelId, 'door')) {
    if (!door.wallId) continue
    const bucket = doorsByWall.get(door.wallId)
    if (bucket) bucket.push(door)
    else doorsByWall.set(door.wallId, [door])
  }
  // Mark → opening. Marks without an explicit `mark` are the host's
  // deterministic numbers; we recover them from the table rows in order.
  const byMark = new Map<string, Opening>()
  const unmarked = openings.filter((o) => !o.mark)
  for (const o of openings) if (o.mark) byMark.set(o.mark, o)
  const unmarkedQueue = [...unmarked]
  for (const row of table.rows) {
    const mark = row.mark ?? ''
    if (!mark || byMark.has(mark)) continue
    const next = unmarkedQueue.shift()
    if (next) byMark.set(mark, next)
  }

  const groupKey = (row: ScheduleRow) =>
    [row.type, row.size ?? `${row.width ?? ''}x${row.height ?? ''}`, row.operation ?? '', row.sill ?? '']
      .join('|')
      .toLowerCase()
  const groups = new Map<string, { row: ScheduleRow; marks: string[]; egress: Set<string>; tempered: Set<string> }>()
  for (const row of table.rows) {
    const opening = byMark.get(row.mark ?? '')
    const room = opening ? roomAtOpening(nodes, opening) : null
    const rooms = room ? [room] : opening?.wallId ? roomsOnWall(nodes, opening.wallId) : []
    const egress = opening ? egressNote(opening, rooms) : ''
    const tempered = opening
      ? (temperedReason(opening, opening.wallId ? (doorsByWall.get(opening.wallId) ?? []) : []) ?? '')
      : ''
    const key = groupKey(row)
    const group = groups.get(key)
    if (group) {
      group.marks.push(row.mark ?? '')
      if (egress) group.egress.add(egress)
      if (tempered) group.tempered.add(tempered)
    } else {
      groups.set(key, {
        row,
        marks: [row.mark ?? ''],
        egress: new Set(egress ? [egress] : []),
        tempered: new Set(tempered ? [tempered] : []),
      })
    }
  }

  const rows: ScheduleRow[] = [...groups.values()].map((group) => ({
    ...group.row,
    mark: group.marks.join(', '),
    qty: String(group.marks.length),
    egress: [...group.egress].join('; '),
    tempered: [...group.tempered].join('; '),
    status: 'NEW',
  }))

  const columns: ScheduleColumn[] = [...table.columns]
  const insertAfter = (key: string, column: ScheduleColumn) => {
    const at = columns.findIndex((c) => c.key === key)
    columns.splice(at >= 0 ? at + 1 : columns.length, 0, column)
  }
  insertAfter('mark', { key: 'qty', label: 'QTY', weight: 0.5 })
  // A collapsed row lists every mark it stands for; the column grows with the
  // longest list so "D102, D104, D110, D111" never runs into TYPE.
  const markColumn = columns.find((c) => c.key === 'mark')
  const longestMark = rows.reduce((n, row) => Math.max(n, (row.mark ?? '').length), 0)
  if (markColumn) markColumn.weight = Math.max(markColumn.weight, longestMark * 0.085)
  if (of === 'windows') columns.push({ key: 'egress', label: 'EGRESS', weight: 2.4 })
  columns.push({ key: 'tempered', label: 'TEMPERED', weight: 1.1 })
  columns.push({ key: 'status', label: 'STATUS', weight: 0.7 })

  return { ...table, columns, rows }
}
