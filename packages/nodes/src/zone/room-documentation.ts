import {
  type AnyNode,
  deriveZoneQuantityReport,
  resolveAutoZonePolygon,
  type ZoneNode,
} from '@pascal-app/core'
import type { FloorplanSchedule } from '@pascal-app/editor'
import {
  type ConstructionLengthProfile,
  type ConstructionLinearUnit,
  formatConstructionLength,
} from '../shared/construction-length'

const SQUARE_FEET_PER_SQUARE_METER = 10.76391041671
const ROOM_NUMBER_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function buildRoomFloorplanSchedule(args: {
  siblings: ReadonlyArray<ZoneNode>
  nodes: Readonly<Record<string, AnyNode>>
  levelId: string
  unit: ConstructionLinearUnit
  profile?: ConstructionLengthProfile
}): FloorplanSchedule | null {
  const rooms = args.siblings
    .filter((zone) => zone.spaceRole === 'room')
    .map((zone) => {
      const polygon = resolveAutoZonePolygon(zone, (id) => args.nodes[id])
      const resolvedZone = polygon === zone.polygon ? zone : { ...zone, polygon }
      return { zone: resolvedZone, report: deriveZoneQuantityReport(resolvedZone, args.nodes) }
    })
    .sort((a, b) => compareRooms(a.zone, b.zone))

  if (rooms.length === 0) return null

  return {
    id: 'rooms',
    title: 'ROOM SCHEDULE',
    columns: [
      { key: 'number', label: 'NO.', weight: 0.7 },
      { key: 'name', label: 'ROOM NAME', weight: 1.35 },
      { key: 'area', label: 'AREA', weight: 0.9 },
      { key: 'floorFinish', label: 'FLOOR FINISH', weight: 1.15 },
      { key: 'wallFinish', label: 'WALL FINISH', weight: 1.15 },
      { key: 'ceilingFinish', label: 'CEILING FINISH', weight: 1.15 },
      { key: 'ceilingHeight', label: 'CLG. HT.', weight: 0.9 },
      { key: 'occupancy', label: 'OCCUPANCY / USE', weight: 1.25 },
      { key: 'enclosure', label: 'ENCLOSURE', weight: 0.9 },
    ],
    rows: rooms.map(({ zone, report }) => ({
      id: zone.id,
      cells: {
        number: valueOrDash(zone.roomNumber),
        name: valueOrDash(zone.name),
        area: formatRoomArea(report.footprintArea, args.unit),
        floorFinish: valueOrDash(zone.floorFinish),
        wallFinish: valueOrDash(zone.wallFinish),
        ceilingFinish: valueOrDash(zone.ceilingFinish),
        ceilingHeight: formatConstructionLength(
          zone.ceilingHeight,
          args.unit,
          args.profile ?? 'document',
        ),
        occupancy: valueOrDash(zone.occupancy),
        enclosure: resolveEnclosure(zone, report.classification),
      },
    })),
    issues: collectRoomScheduleIssues(rooms),
  }
}

function compareRooms(a: ZoneNode, b: ZoneNode): number {
  const numberComparison = ROOM_NUMBER_COLLATOR.compare(a.roomNumber.trim(), b.roomNumber.trim())
  if (numberComparison !== 0) return numberComparison
  const nameComparison = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  return nameComparison !== 0 ? nameComparison : a.id.localeCompare(b.id)
}

function valueOrDash(value: string): string {
  return value.trim() || '—'
}

function formatRoomArea(squareMeters: number, unit: ConstructionLinearUnit): string {
  if (!Number.isFinite(squareMeters)) return '—'
  if (unit === 'metric') return `${squareMeters.toFixed(2)} m²`
  return `${(squareMeters * SQUARE_FEET_PER_SQUARE_METER).toFixed(1)} ft²`
}

function resolveEnclosure(zone: ZoneNode, classification: 'footprint' | 'enclosed-room'): string {
  if (zone.enclosureStatus === 'enclosed') return 'Enclosed'
  if (zone.enclosureStatus === 'open') return 'Open'
  return classification === 'enclosed-room' ? 'Enclosed' : 'Open'
}

function collectRoomScheduleIssues(
  rooms: ReadonlyArray<{
    zone: ZoneNode
    report: { classification: 'footprint' | 'enclosed-room' }
  }>,
): string[] {
  const issues: string[] = []
  const numberedRooms = new Map<string, ZoneNode[]>()

  for (const { zone, report } of rooms) {
    const number = zone.roomNumber.trim()
    if (!number) {
      issues.push(`Room ${zone.name.trim() || zone.id} has no room number`)
    } else {
      const normalized = number.toLocaleUpperCase()
      const duplicates = numberedRooms.get(normalized)
      if (duplicates) duplicates.push(zone)
      else numberedRooms.set(normalized, [zone])
    }

    if (zone.enclosureStatus === 'enclosed' && report.classification !== 'enclosed-room') {
      issues.push(`Room ${number || zone.name.trim() || zone.id} is marked enclosed but not proven`)
    }
  }

  for (const [normalizedNumber, duplicateRooms] of numberedRooms) {
    if (duplicateRooms.length < 2) continue
    issues.push(`Duplicate room number ${normalizedNumber} (${duplicateRooms.length} rooms)`)
  }

  return issues
}
