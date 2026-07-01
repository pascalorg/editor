import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'
import { resolveProcessEquipmentContract } from './process-equipment-contracts'
import type {
  ProcessLayoutDiagnostic,
  ProcessLayoutDiagnostics,
  ProcessLayoutStrategy,
  ProcessLineFootprintHint,
  ProcessLineLayoutStyle,
  ProcessLinePlan,
  ProcessStationClearance,
  ProcessStationPlan,
  StationPlacement,
} from './process-line-types'

export const PROCESS_STATION_FOOTPRINTS: Record<
  ProcessLineFootprintHint,
  { length: number; width: number }
> = {
  small: { length: 1.0, width: 0.9 },
  medium: { length: 1.4, width: 1.1 },
  large: { length: 1.8, width: 1.4 },
  long: { length: 2.6, width: 1.1 },
  tall: { length: 1.2, width: 1.2 },
}

const DEFAULT_CLEARANCE = 0.25
const HAZARD_CLEARANCE = 0.35
const MIN_STATION_GAP = 0.25
const ROW_GAP = 0.5

type LayoutBoundary = { length: number; width: number; centerX?: number; centerZ?: number }

type LayoutCandidate = {
  reason?: string
  stationPlacements: StationPlacement[]
  strategy: ProcessLayoutStrategy
}

function stationText(station: ProcessStationPlan) {
  return [
    station.id,
    station.role,
    station.label,
    station.displayLabel,
    station.equipmentHint,
    ...(station.safetyTags ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

function hasHazardClearance(station: ProcessStationPlan) {
  const text = stationText(station)
  return /hydrogen|oxygen|flammable|pressure|\u6c22|\u6c27|\u6613\u71c3|\u538b\u529b/i.test(text)
}

export function stationFootprint(station: ProcessStationPlan, plan?: ProcessLinePlan) {
  const contract = resolveProcessEquipmentContract({ plan, station })
  if (contract) {
    return { length: contract.envelope.length, width: contract.envelope.width }
  }
  return PROCESS_STATION_FOOTPRINTS[station.footprintHint ?? 'medium']
}

export function stationClearance(station: ProcessStationPlan): ProcessStationClearance {
  const clearance = hasHazardClearance(station) ? HAZARD_CLEARANCE : DEFAULT_CLEARANCE
  return {
    left: clearance,
    right: clearance,
    front: clearance,
    back: clearance,
  }
}

export function stationClearanceBox(input: {
  position: Vec3
  footprint: { length: number; width: number }
  clearance: ProcessStationClearance
}) {
  return {
    minX: input.position[0] - input.footprint.length / 2 - input.clearance.left,
    maxX: input.position[0] + input.footprint.length / 2 + input.clearance.right,
    minZ: input.position[2] - input.footprint.width / 2 - input.clearance.back,
    maxZ: input.position[2] + input.footprint.width / 2 + input.clearance.front,
  }
}

export function buildStationPlacement(input: {
  station: ProcessStationPlan
  plan?: ProcessLinePlan
  position: Vec3
  rotation?: Vec3
}): StationPlacement {
  const footprint = stationFootprint(input.station, input.plan)
  const clearance = stationClearance(input.station)
  return {
    stationId: input.station.id,
    role: input.station.role,
    label: input.station.label,
    displayLabel: input.station.displayLabel,
    position: input.position,
    rotation: input.rotation ?? [0, 0, 0],
    footprint,
    clearance,
    clearanceBox: stationClearanceBox({
      position: input.position,
      footprint,
      clearance,
    }),
  }
}

function packedRowLength(stations: ProcessStationPlan[], plan?: ProcessLinePlan) {
  if (!stations.length) return 0
  return (
    stations.reduce((sum, station) => sum + stationXExtent(station, plan) * 2, 0) +
    Math.max(0, stations.length - 1) * MIN_STATION_GAP
  )
}

function requiredBoundaryForParallelBays(input: {
  plan: ProcessLinePlan
  boundary: LayoutBoundary
}) {
  const splitIndex = Math.ceil(input.plan.stations.length / 2)
  const firstRow = input.plan.stations.slice(0, splitIndex)
  const secondRow = input.plan.stations.slice(splitIndex)
  const maxRowLength = Math.max(
    packedRowLength(firstRow, input.plan),
    packedRowLength(secondRow, input.plan),
  )
  const firstRowHalfWidth = Math.max(
    0,
    ...firstRow.map((station) => stationZExtent(station, input.plan)),
  )
  const secondRowHalfWidth = Math.max(
    0,
    ...secondRow.map((station) => stationZExtent(station, input.plan)),
  )
  const maxHalfWidth = Math.max(firstRowHalfWidth, secondRowHalfWidth)
  return {
    length: Math.max(input.boundary.length, maxRowLength + DEFAULT_CLEARANCE * 2),
    width: Math.max(
      input.boundary.width,
      secondRow.length
        ? (ROW_GAP / 2 + maxHalfWidth) * 2 + maxHalfWidth * 2 + DEFAULT_CLEARANCE * 2
        : maxHalfWidth * 2 + DEFAULT_CLEARANCE * 2,
    ),
  }
}

function expandedBoundaryForPlan(input: {
  plan: ProcessLinePlan
  boundary: LayoutBoundary
  style: ProcessLineLayoutStyle
}): LayoutBoundary | undefined {
  if (!input.plan.sourcePack && !input.plan.architecture) return undefined
  const required =
    preferredLayoutStyle(input.style) === 'parallel_bays'
      ? requiredBoundaryForParallelBays(input)
      : {
          length: packedRowLength(input.plan.stations, input.plan) + DEFAULT_CLEARANCE * 2,
          width:
            Math.max(
              0,
              ...input.plan.stations.map((station) => stationZExtent(station, input.plan)),
            ) *
              2 +
            DEFAULT_CLEARANCE * 2,
        }
  const length = Math.max(input.boundary.length, required.length)
  const width = Math.max(input.boundary.width, required.width)
  if (length <= input.boundary.length && width <= input.boundary.width) return undefined
  return {
    ...input.boundary,
    length,
    width,
  }
}

function stationXExtent(station: ProcessStationPlan, plan?: ProcessLinePlan) {
  const footprint = stationFootprint(station, plan)
  const clearance = stationClearance(station)
  return Math.max(footprint.length / 2 + clearance.left, footprint.length / 2 + clearance.right)
}

function stationZExtent(station: ProcessStationPlan, plan?: ProcessLinePlan) {
  const footprint = stationFootprint(station, plan)
  const clearance = stationClearance(station)
  return Math.max(footprint.width / 2 + clearance.front, footprint.width / 2 + clearance.back)
}

function buildEvenLinearPlacements(input: {
  plan: ProcessLinePlan
  boundary: LayoutBoundary
}): StationPlacement[] {
  const centerX = input.boundary.centerX ?? 0
  const centerZ = input.boundary.centerZ ?? 0
  const spacing = input.boundary.length / (input.plan.stations.length + 1)
  return input.plan.stations.map((station, index) =>
    buildStationPlacement({
      station,
      plan: input.plan,
      position: [centerX - input.boundary.length / 2 + spacing * (index + 1), 0, centerZ],
      rotation: [0, 0, 0],
    }),
  )
}

function buildPackedLinearPlacements(input: {
  stations: ProcessStationPlan[]
  plan?: ProcessLinePlan
  boundary: LayoutBoundary
  z?: number
  reversePhysicalOrder?: boolean
  spreadToBoundary?: boolean
}): StationPlacement[] {
  const centerX = input.boundary.centerX ?? 0
  const centerZ = input.z ?? input.boundary.centerZ ?? 0
  const physicalStations = input.reversePhysicalOrder
    ? [...input.stations].reverse()
    : input.stations
  const extents = physicalStations.map((station) => stationXExtent(station, input.plan))
  const stationLength = extents.reduce((sum, extent) => sum + extent * 2, 0)
  const compactLength = stationLength + Math.max(0, physicalStations.length - 1) * MIN_STATION_GAP
  const spreadLength = input.boundary.length * 0.82
  const shouldSpread =
    input.spreadToBoundary && physicalStations.length > 1 && spreadLength > compactLength
  const gap = shouldSpread
    ? (spreadLength - stationLength) / Math.max(1, physicalStations.length - 1)
    : MIN_STATION_GAP
  const totalLength = shouldSpread ? spreadLength : compactLength
  let cursor = centerX - totalLength / 2

  return physicalStations.map((station, index) => {
    const extent = extents[index] ?? 0
    const placement = buildStationPlacement({
      station,
      plan: input.plan,
      position: [cursor + extent, 0, centerZ],
      rotation: [0, 0, 0],
    })
    cursor += extent * 2 + gap
    return placement
  })
}

function buildParallelBayPlacements(input: {
  plan: ProcessLinePlan
  boundary: LayoutBoundary
}): StationPlacement[] {
  const centerZ = input.boundary.centerZ ?? 0
  const splitIndex = Math.ceil(input.plan.stations.length / 2)
  const firstRow = input.plan.stations.slice(0, splitIndex)
  const secondRow = input.plan.stations.slice(splitIndex)
  const firstRowHalfWidth = Math.max(
    0,
    ...firstRow.map((station) => stationZExtent(station, input.plan)),
  )
  const secondRowHalfWidth = Math.max(
    0,
    ...secondRow.map((station) => stationZExtent(station, input.plan)),
  )
  const maxHalfWidth = Math.max(firstRowHalfWidth, secondRowHalfWidth)
  const minOffset = ROW_GAP / 2 + maxHalfWidth
  const maxOffset = input.boundary.width / 2 - maxHalfWidth - DEFAULT_CLEARANCE
  const desiredOffset = input.boundary.width * 0.22
  const rowOffset = secondRow.length ? Math.max(minOffset, Math.min(desiredOffset, maxOffset)) : 0
  const firstRowZ = secondRow.length ? centerZ - rowOffset : centerZ
  const secondRowZ = centerZ + rowOffset
  const placements = [
    ...buildPackedLinearPlacements({
      stations: firstRow,
      plan: input.plan,
      boundary: input.boundary,
      z: firstRowZ,
      spreadToBoundary: true,
    }),
    ...buildPackedLinearPlacements({
      stations: secondRow,
      plan: input.plan,
      boundary: input.boundary,
      z: secondRowZ,
      reversePhysicalOrder: true,
      spreadToBoundary: true,
    }),
  ]
  const byStationId = new Map(placements.map((placement) => [placement.stationId, placement]))
  return input.plan.stations
    .map((station) => byStationId.get(station.id))
    .filter((placement): placement is StationPlacement => Boolean(placement))
}

function validateCandidate(input: {
  candidate: LayoutCandidate
  plan: ProcessLinePlan
  boundary: LayoutBoundary
}) {
  return validateProcessLineLayout({
    plan: input.plan,
    stationPlacements: input.candidate.stationPlacements,
    boundary: input.boundary,
  })
}

function preferredLayoutStyle(style: ProcessLineLayoutStyle) {
  return style === 'parallel_bays' ? 'parallel_bays' : 'linear'
}

export function resolveProcessLineLayout(input: {
  plan: ProcessLinePlan
  boundary: LayoutBoundary
}): {
  layoutDiagnostics: ProcessLayoutDiagnostics
  layoutStrategy: ProcessLayoutStrategy
  stationPlacements: StationPlacement[]
  boundary: LayoutBoundary
} {
  const preferredStyle = preferredLayoutStyle(input.plan.layoutStyle)
  const candidates: LayoutCandidate[] =
    preferredStyle === 'parallel_bays'
      ? [
          {
            stationPlacements: buildParallelBayPlacements(input),
            strategy: { style: 'parallel_bays', repaired: false },
          },
          {
            reason: 'Parallel bays did not fit; trying compact linear placement.',
            stationPlacements: buildPackedLinearPlacements({
              stations: input.plan.stations,
              plan: input.plan,
              boundary: input.boundary,
            }),
            strategy: {
              style: 'linear',
              repaired: true,
              reason: 'Fallback from parallel_bays to compact linear placement.',
            },
          },
        ]
      : [
          {
            stationPlacements: buildEvenLinearPlacements(input),
            strategy: { style: 'linear', repaired: false },
          },
          {
            reason: 'Even linear spacing did not fit; trying compact clearance spacing.',
            stationPlacements: buildPackedLinearPlacements({
              stations: input.plan.stations,
              plan: input.plan,
              boundary: input.boundary,
            }),
            strategy: {
              style: 'linear',
              repaired: true,
              reason: 'Compacted station spacing based on clearance boxes.',
            },
          },
          {
            reason: 'Linear placement did not fit; trying parallel bay fallback.',
            stationPlacements: buildParallelBayPlacements(input),
            strategy: {
              style: 'parallel_bays',
              repaired: true,
              reason: 'Switched from linear to parallel bay placement.',
            },
          },
        ]

  const firstCandidate = candidates[0]
  if (!firstCandidate) {
    const layoutDiagnostics = validateProcessLineLayout({
      plan: input.plan,
      stationPlacements: [],
      boundary: input.boundary,
    })
    return {
      stationPlacements: [],
      layoutDiagnostics,
      layoutStrategy: { style: preferredStyle, repaired: false },
      boundary: input.boundary,
    }
  }

  let firstDiagnostics: ProcessLayoutDiagnostics | null = null
  for (const candidate of candidates) {
    const layoutDiagnostics = validateCandidate({
      candidate,
      plan: input.plan,
      boundary: input.boundary,
    })
    if (!firstDiagnostics) firstDiagnostics = layoutDiagnostics
    if (!layoutDiagnostics.fits) continue
    return {
      stationPlacements: candidate.stationPlacements,
      layoutDiagnostics,
      layoutStrategy: candidate.strategy,
      boundary: input.boundary,
    }
  }

  const expandedBoundary = expandedBoundaryForPlan({
    plan: input.plan,
    boundary: input.boundary,
    style: input.plan.layoutStyle,
  })
  if (expandedBoundary) {
    const stationPlacements =
      preferredStyle === 'parallel_bays'
        ? buildParallelBayPlacements({ plan: input.plan, boundary: expandedBoundary })
        : buildPackedLinearPlacements({
            stations: input.plan.stations,
            plan: input.plan,
            boundary: expandedBoundary,
          })
    const layoutDiagnostics = validateProcessLineLayout({
      plan: input.plan,
      stationPlacements,
      boundary: expandedBoundary,
    })
    if (layoutDiagnostics.fits) {
      return {
        stationPlacements,
        layoutDiagnostics,
        layoutStrategy: {
          style: preferredStyle,
          repaired: true,
          reason: 'Expanded process shell boundary to fit station clearance boxes.',
        },
        boundary: expandedBoundary,
      }
    }
  }

  return {
    stationPlacements: firstCandidate.stationPlacements,
    layoutDiagnostics: firstDiagnostics ?? {
      fits: false,
      boundary: { length: input.boundary.length, width: input.boundary.width },
      diagnostics: [
        diagnostic({
          code: 'layout_no_candidate',
          message: 'No station layout candidate could be evaluated.',
        }),
      ],
    },
    layoutStrategy: {
      ...firstCandidate.strategy,
      repaired: false,
      reason: 'No available layout candidate fit the process shell boundary.',
    },
    boundary: input.boundary,
  }
}

function boxesOverlap(a: StationPlacement, b: StationPlacement) {
  const left = a.clearanceBox
  const right = b.clearanceBox
  return (
    left.minX < right.maxX &&
    left.maxX > right.minX &&
    left.minZ < right.maxZ &&
    left.maxZ > right.minZ
  )
}

function diagnostic(
  input: Omit<ProcessLayoutDiagnostic, 'severity'> & {
    severity?: ProcessLayoutDiagnostic['severity']
  },
) {
  return {
    severity: input.severity ?? 'error',
    code: input.code,
    message: input.message,
    ...(input.stationId ? { stationId: input.stationId } : {}),
    ...(input.relatedStationId ? { relatedStationId: input.relatedStationId } : {}),
    ...(input.connectionIndex != null ? { connectionIndex: input.connectionIndex } : {}),
  }
}

export function validateProcessLineLayout(input: {
  plan: ProcessLinePlan
  stationPlacements: StationPlacement[]
  boundary: LayoutBoundary
}): ProcessLayoutDiagnostics {
  const diagnostics: ProcessLayoutDiagnostic[] = []
  const halfLength = input.boundary.length / 2
  const halfWidth = input.boundary.width / 2
  const centerX = input.boundary.centerX ?? 0
  const centerZ = input.boundary.centerZ ?? 0
  const minX = centerX - halfLength
  const maxX = centerX + halfLength
  const minZ = centerZ - halfWidth
  const maxZ = centerZ + halfWidth
  const byStationId = new Map(
    input.stationPlacements.map((placement) => [placement.stationId, placement]),
  )

  for (const station of input.plan.stations) {
    if (!byStationId.has(station.id)) {
      diagnostics.push(
        diagnostic({
          code: 'station_missing_placement',
          message: `Station ${station.id} has no computed placement.`,
          stationId: station.id,
        }),
      )
    }
  }

  for (const placement of input.stationPlacements) {
    const box = placement.clearanceBox
    if (box.minX < minX || box.maxX > maxX || box.minZ < minZ || box.maxZ > maxZ) {
      diagnostics.push(
        diagnostic({
          code: 'station_outside_boundary',
          message: `Station ${placement.stationId} clearance box exceeds the process shell boundary.`,
          stationId: placement.stationId,
        }),
      )
    }
  }

  for (let index = 0; index < input.stationPlacements.length; index += 1) {
    const current = input.stationPlacements[index]
    if (!current) continue
    for (let nextIndex = index + 1; nextIndex < input.stationPlacements.length; nextIndex += 1) {
      const next = input.stationPlacements[nextIndex]
      if (!next || !boxesOverlap(current, next)) continue
      diagnostics.push(
        diagnostic({
          code: 'station_clearance_overlap',
          message: `Station ${current.stationId} clearance overlaps ${next.stationId}.`,
          stationId: current.stationId,
          relatedStationId: next.stationId,
        }),
      )
    }
  }

  input.plan.connections.forEach((connection, connectionIndex) => {
    if (!byStationId.has(connection.fromStationId)) {
      diagnostics.push(
        diagnostic({
          code: 'connection_missing_from_station',
          message: `Connection ${connectionIndex} source station is missing: ${connection.fromStationId}.`,
          stationId: connection.fromStationId,
          connectionIndex,
        }),
      )
    }
    if (!byStationId.has(connection.toStationId)) {
      diagnostics.push(
        diagnostic({
          code: 'connection_missing_to_station',
          message: `Connection ${connectionIndex} target station is missing: ${connection.toStationId}.`,
          stationId: connection.toStationId,
          connectionIndex,
        }),
      )
    }
  })

  return {
    fits: !diagnostics.some((item) => item.severity === 'error'),
    boundary: { length: input.boundary.length, width: input.boundary.width },
    diagnostics,
  }
}
