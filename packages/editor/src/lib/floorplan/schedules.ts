import type { AnyNode, AnyNodeId, DoorNode, WallNode, WindowNode, ZoneNode } from '@pascal-app/core'
import { deriveZoneQuantityReport, resolveAutoZonePolygon } from '@pascal-app/core'
import { collectFloorplanSchedules } from './floorplan-export'
import type { FloorplanSchedule } from './floorplan-extension'
import { resolveMarkDetail } from './marks'

/**
 * Construction-document schedule DATA — WS3.
 *
 * The PDF export already renders schedules through the node registry
 * (`collectFloorplanSchedules` in `floorplan-export.tsx`, backed by each
 * kind's `def.extensions['pascal:editor/floorplan'].schedule`). That path is
 * untouched and keeps working; `floorplanSchedules()` below re-exports it.
 *
 * What this module adds is a TYPED, renderer-agnostic row model that the
 * sheets workstream can lay out itself (column widths, grouping, sorting)
 * instead of re-parsing formatted cells. Marks come from `marks.ts`, so a
 * schedule row and the tag drawn on the plan always agree.
 */

const SQUARE_FEET_PER_SQUARE_METER = 10.76391041671
const INCHES_PER_METER = 1 / 0.0254

export type ScheduleUnit = 'metric' | 'imperial'

export type OpeningScheduleRow = {
  id: string
  mark: string
  type: string
  /** Metres. */
  width: number
  /** Metres. */
  height: number
  widthText: string
  heightText: string
  sizeText: string
  /** Rough opening as "W x H", or `null` when it was never entered. */
  roughOpening: string | null
  /** Frame material / thickness-depth where the model knows it. */
  material: string | null
  frame: string | null
  hardware: string | null
  /** How many identical openings this row stands for (grouped rows only). */
  count: number
  remarks: string
}

export type RoomScheduleRow = {
  id: string
  number: string
  name: string
  /** Square metres. */
  area: number
  areaText: string
  floorFinish: string | null
  ceilingHeight: number
  remarks: string
}

export type ScheduleResult<TRow> = {
  rows: TRow[]
  issues: string[]
}

export type ScheduleSceneInput = { nodes: Readonly<Record<string, AnyNode>> } | Readonly<Record<string, AnyNode>>

export type ScheduleOptions = {
  unit?: ScheduleUnit
  /** Collapse identical openings into one row carrying `count`. Default false. */
  group?: boolean
}

// ── Door schedule ────────────────────────────────────────────────────

export function doorSchedule(
  scene: ScheduleSceneInput,
  levelId?: AnyNodeId,
  options: ScheduleOptions = {},
): ScheduleResult<OpeningScheduleRow> {
  return openingSchedule(scene, 'door', levelId, options)
}

export function windowSchedule(
  scene: ScheduleSceneInput,
  levelId?: AnyNodeId,
  options: ScheduleOptions = {},
): ScheduleResult<OpeningScheduleRow> {
  return openingSchedule(scene, 'window', levelId, options)
}

function openingSchedule(
  scene: ScheduleSceneInput,
  kind: 'door' | 'window',
  levelId: AnyNodeId | undefined,
  options: ScheduleOptions,
): ScheduleResult<OpeningScheduleRow> {
  const nodes = normalizeNodes(scene)
  const unit = options.unit ?? 'imperial'
  const levelIds = levelId ? [levelId] : allLevelIds(nodes)

  const rows: OpeningScheduleRow[] = []
  const issues: string[] = []

  for (const id of levelIds) {
    const resolution = resolveMarkDetail(nodes, id as AnyNodeId)
    issues.push(...resolution.issues)
    for (const node of collectSubtree(nodes, id)) {
      if (node.type !== kind) continue
      const opening = node as DoorNode | WindowNode
      rows.push(openingRow(opening, nodes, resolution.marks.get(opening.id) ?? '—', unit))
    }
  }

  rows.sort((left, right) => left.mark.localeCompare(right.mark, 'en', { numeric: true }))
  return { rows: options.group ? groupOpeningRows(rows) : rows, issues }
}

function openingRow(
  opening: DoorNode | WindowNode,
  nodes: Readonly<Record<string, AnyNode>>,
  mark: string,
  unit: ScheduleUnit,
): OpeningScheduleRow {
  const remarks: string[] = []
  if (opening.roughOpeningWidth === undefined || opening.roughOpeningHeight === undefined) {
    remarks.push('VERIFY R.O.')
  }
  const wall = opening.wallId ? (nodes[opening.wallId] as WallNode | undefined) : undefined
  if (wall && wall.type === 'wall' && (wall.frontSide === 'exterior' || wall.backSide === 'exterior')) {
    remarks.push('Exterior')
  }

  return {
    id: opening.id,
    mark,
    type: openingTypeLabel(opening),
    width: opening.width,
    height: opening.height,
    widthText: formatScheduleLength(opening.width, unit),
    heightText: formatScheduleLength(opening.height, unit),
    sizeText: `${formatScheduleLength(opening.width, unit)} x ${formatScheduleLength(opening.height, unit)}`,
    roughOpening:
      opening.roughOpeningWidth !== undefined && opening.roughOpeningHeight !== undefined
        ? `${formatScheduleLength(opening.roughOpeningWidth, unit)} x ${formatScheduleLength(opening.roughOpeningHeight, unit)}`
        : null,
    material: openingMaterial(opening),
    frame: openingFrame(opening, unit),
    hardware: opening.type === 'door' ? doorHardware(opening as DoorNode) : null,
    count: 1,
    remarks: remarks.join('; '),
  }
}

function groupOpeningRows(rows: readonly OpeningScheduleRow[]): OpeningScheduleRow[] {
  const grouped = new Map<string, OpeningScheduleRow>()
  for (const row of rows) {
    const key = [row.type, row.sizeText, row.roughOpening, row.material, row.frame, row.hardware].join('|')
    const existing = grouped.get(key)
    if (existing) existing.count += row.count
    else grouped.set(key, { ...row })
  }
  return [...grouped.values()]
}

function openingTypeLabel(opening: DoorNode | WindowNode): string {
  if (opening.openingKind === 'opening') return 'Opening'
  return titleCase(
    opening.type === 'door' ? (opening as DoorNode).doorType : (opening as WindowNode).windowType,
  )
}

function openingMaterial(opening: DoorNode | WindowNode): string | null {
  // `slots.panel` / `material` hold a MaterialRef (`library:<id>` /
  // `scene:<id>`). Only the ref is knowable here — no invented values.
  const ref = opening.slots?.panel ?? opening.slots?.frame ?? undefined
  if (typeof ref === 'string' && ref.includes(':')) return titleCase(ref.split(':')[1] ?? ref)
  return null
}

function openingFrame(opening: DoorNode | WindowNode, unit: ScheduleUnit): string | null {
  const thickness = (opening as DoorNode).frameThickness
  const depth = (opening as DoorNode).frameDepth
  if (typeof thickness !== 'number' || typeof depth !== 'number') return null
  return `${formatScheduleLength(thickness, unit)} / ${formatScheduleLength(depth, unit)}`
}

function doorHardware(door: DoorNode): string {
  if (door.openingKind === 'opening') return 'None'
  const hardware: string[] = []
  if (door.doorCloser) hardware.push('Closer')
  if (door.panicBar) hardware.push('Panic bar')
  if (door.threshold) hardware.push('Threshold')
  return hardware.length > 0 ? hardware.join(', ') : 'Standard'
}

// ── Room schedule ────────────────────────────────────────────────────

export function roomSchedule(
  scene: ScheduleSceneInput,
  levelId?: AnyNodeId,
  options: ScheduleOptions = {},
): ScheduleResult<RoomScheduleRow> {
  const nodes = normalizeNodes(scene)
  const unit = options.unit ?? 'imperial'
  const levelIds = levelId ? [levelId] : allLevelIds(nodes)

  const rows: RoomScheduleRow[] = []
  const issues: string[] = []
  const seenNumbers = new Map<string, string[]>()

  for (const id of levelIds) {
    for (const node of collectSubtree(nodes, id)) {
      if (node.type !== 'zone') continue
      const zone = node as ZoneNode
      if (zone.spaceRole !== 'room') continue
      const polygon = resolveAutoZonePolygon(zone, (nodeId) => nodes[nodeId])
      const resolved = polygon === zone.polygon ? zone : { ...zone, polygon }
      const report = deriveZoneQuantityReport(resolved, nodes as Record<string, AnyNode>)
      const number = zone.roomNumber.trim()
      if (!number) issues.push(`Room ${zone.name.trim() || zone.id} has no room number`)
      else {
        const owners = seenNumbers.get(number.toLocaleUpperCase())
        if (owners) owners.push(zone.id)
        else seenNumbers.set(number.toLocaleUpperCase(), [zone.id])
      }
      rows.push({
        id: zone.id,
        number: number || '—',
        name: zone.name.trim() || '—',
        area: report.footprintArea,
        areaText: formatArea(report.footprintArea, unit),
        floorFinish: zone.floorFinish.trim() || null,
        ceilingHeight: zone.ceilingHeight,
        remarks: zone.occupancy.trim(),
      })
    }
  }

  for (const [number, owners] of seenNumbers) {
    if (owners.length > 1) issues.push(`Duplicate room number ${number} (${owners.length} rooms)`)
  }

  rows.sort((left, right) => left.number.localeCompare(right.number, 'en', { numeric: true }))
  return { rows, issues }
}

// ── PDF-compatible schedules (unchanged registry path) ───────────────

/**
 * The registry-driven schedules the PDF export renders. Kept as the single
 * source for the PDF so extending this module never forks that output.
 */
export function floorplanSchedules(
  nodes: Record<string, AnyNode>,
  levelId: AnyNodeId,
  unit: ScheduleUnit,
): FloorplanSchedule[] {
  return collectFloorplanSchedules(nodes, levelId, unit)
}

// ── Helpers ──────────────────────────────────────────────────────────

export function formatScheduleLength(metres: number, unit: ScheduleUnit): string {
  if (!Number.isFinite(metres)) return '—'
  if (unit === 'metric') return `${Math.round(metres * 1000)}`
  const denominator = 16
  const sign = metres < 0 ? '-' : ''
  const totalUnits = Math.round(Math.abs(metres) * INCHES_PER_METER * denominator)
  const unitsPerFoot = 12 * denominator
  const feet = Math.floor(totalUnits / unitsPerFoot)
  const remainder = totalUnits - feet * unitsPerFoot
  const inches = Math.floor(remainder / denominator)
  const numerator = remainder - inches * denominator
  const divisor = greatestCommonDivisor(numerator, denominator)
  const fraction = numerator === 0 ? '' : `${numerator / divisor}/${denominator / divisor}`
  const inchText = fraction ? `${inches} ${fraction}` : `${inches}`
  return feet === 0 ? `${sign}${inchText}"` : `${sign}${feet}'-${inchText}"`
}

function formatArea(squareMetres: number, unit: ScheduleUnit): string {
  if (!Number.isFinite(squareMetres)) return '—'
  return unit === 'metric'
    ? `${squareMetres.toFixed(2)} m²`
    : `${(squareMetres * SQUARE_FEET_PER_SQUARE_METER).toFixed(1)} ft²`
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a)
  let right = Math.abs(b)
  while (right !== 0) {
    const next = left % right
    left = right
    right = next
  }
  return left || 1
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
}

function collectSubtree(
  nodes: Readonly<Record<string, AnyNode>>,
  rootId: string,
): AnyNode[] {
  const result: AnyNode[] = []
  const visit = (id: string) => {
    const node = nodes[id]
    if (!node || node.visible === false) return
    result.push(node)
    for (const childId of (node as { children?: string[] }).children ?? []) visit(childId)
  }
  visit(rootId)
  return result
}

function allLevelIds(nodes: Readonly<Record<string, AnyNode>>): string[] {
  return Object.values(nodes)
    .filter((node) => node?.type === 'level')
    .map((node) => node.id)
}

function normalizeNodes(scene: ScheduleSceneInput): Readonly<Record<string, AnyNode>> {
  const candidate = scene as { nodes?: Readonly<Record<string, AnyNode>> }
  return candidate && typeof candidate === 'object' && candidate.nodes
    ? candidate.nodes
    : (scene as Readonly<Record<string, AnyNode>>)
}
