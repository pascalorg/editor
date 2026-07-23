import {
  type AnyNode,
  type DoorNode,
  getWallAssemblyFaceOffsets,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { formatConstructionLength } from './construction-length'

const INCH = 0.0254

export type ConstructionModuleSystem = 'imperial' | 'metric'
export type ConstructionModuleAdvisorySeverity = 'info' | 'warning'

export type ConstructionModuleProfile = {
  id: string
  label: string
  system: ConstructionModuleSystem
  modules: readonly number[]
  tolerance: number
  enabled: boolean
}

export type ConstructionModuleMeasurementKind =
  | 'wall-length'
  | 'level-overall-width'
  | 'level-overall-depth'
  | 'opening-width'
  | 'rough-opening-width'
  | 'masonry-opening-width'
  | 'finish-opening-width'

export type ConstructionModuleAdvisory = {
  id: string
  nodeId: string
  nodeType: string
  profileId: string
  profileLabel: string
  system: ConstructionModuleSystem
  kind: ConstructionModuleMeasurementKind
  label: string
  module: number
  measured: number
  deviation: number
  nearestMultiple: number
  severity: ConstructionModuleAdvisorySeverity
  message: string
}

export type BuildConstructionModuleAdvisoriesOptions = {
  profiles?: readonly ConstructionModuleProfile[]
  includeDisabled?: boolean
}

type ConstructionModuleMeasurement = {
  nodeId: string
  nodeType: string
  kind: ConstructionModuleMeasurementKind
  label: string
  measured: number
}

type ModuleFit = {
  module: number
  nearestMultiple: number
  deviation: number
}

export const DEFAULT_CONSTRUCTION_MODULE_PROFILES: readonly ConstructionModuleProfile[] = [
  {
    id: 'imperial-common',
    label: 'Imperial common modules',
    system: 'imperial',
    modules: [12 * INCH, 16 * INCH, 24 * INCH],
    tolerance: 0.25 * INCH,
    enabled: false,
  },
  {
    id: 'metric-common',
    label: 'Metric common modules',
    system: 'metric',
    modules: [0.1, 0.2, 0.4, 0.6],
    tolerance: 0.005,
    enabled: false,
  },
] as const

export function buildConstructionModuleAdvisories(
  nodes: Readonly<Record<string, AnyNode>>,
  options: BuildConstructionModuleAdvisoriesOptions = {},
): ConstructionModuleAdvisory[] {
  const profiles = (options.profiles ?? DEFAULT_CONSTRUCTION_MODULE_PROFILES).filter(
    (profile) => options.includeDisabled === true || profile.enabled,
  )
  if (profiles.length === 0) return []

  const measurements = [
    ...Object.values(nodes).flatMap((node) => constructionModuleMeasurements(node)),
    ...levelOverallMeasurements(nodes),
  ]
  const advisories: ConstructionModuleAdvisory[] = []

  for (const measurement of measurements) {
    for (const profile of profiles) {
      const fit = bestModuleFit(measurement.measured, profile.modules)
      if (!fit || fit.deviation <= profile.tolerance) continue

      advisories.push({
        id: ['construction-module', profile.id, measurement.nodeId, measurement.kind].join(':'),
        nodeId: measurement.nodeId,
        nodeType: measurement.nodeType,
        profileId: profile.id,
        profileLabel: profile.label,
        system: profile.system,
        kind: measurement.kind,
        label: measurement.label,
        module: fit.module,
        measured: measurement.measured,
        deviation: fit.deviation,
        nearestMultiple: fit.nearestMultiple,
        severity: 'info',
        message: moduleAdvisoryMessage(measurement, profile, fit),
      })
    }
  }

  return advisories.sort((left, right) => left.id.localeCompare(right.id))
}

function levelOverallMeasurements(
  nodes: Readonly<Record<string, AnyNode>>,
): ConstructionModuleMeasurement[] {
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || !node.parentId) continue
    if (node.curveOffset !== undefined && Math.abs(node.curveOffset) > 1e-6) continue
    const levelWalls = wallsByLevel.get(node.parentId) ?? []
    levelWalls.push(node)
    wallsByLevel.set(node.parentId, levelWalls)
  }

  const measurements: ConstructionModuleMeasurement[] = []
  for (const [levelId, walls] of wallsByLevel) {
    const primaryWall = walls.reduce((longest, wall) =>
      wallLength(wall) > wallLength(longest) ? wall : longest,
    )
    const primaryLength = wallLength(primaryWall)
    if (
      walls.length < 2 ||
      !isUsefulLength(primaryLength) ||
      !walls.some((wall) => !wallsAreParallel(primaryWall, wall))
    ) {
      continue
    }

    const footprintPoints = walls.flatMap(wallFootprintPoints)
    const direction: [number, number] = [
      (primaryWall.end[0] - primaryWall.start[0]) / primaryLength,
      (primaryWall.end[1] - primaryWall.start[1]) / primaryLength,
    ]
    const normal: [number, number] = [-direction[1], direction[0]]
    const along = footprintPoints.map(([x, y]) => x * direction[0] + y * direction[1])
    const across = footprintPoints.map(([x, y]) => x * normal[0] + y * normal[1])
    const width = Math.max(...along) - Math.min(...along)
    const depth = Math.max(...across) - Math.min(...across)

    if (isUsefulLength(width)) {
      measurements.push({
        nodeId: levelId,
        nodeType: 'level',
        kind: 'level-overall-width',
        label: 'overall plan width',
        measured: width,
      })
    }
    if (isUsefulLength(depth)) {
      measurements.push({
        nodeId: levelId,
        nodeType: 'level',
        kind: 'level-overall-depth',
        label: 'overall plan depth',
        measured: depth,
      })
    }
  }

  return measurements
}

function wallLength(wall: WallNode): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function wallsAreParallel(left: WallNode, right: WallNode): boolean {
  const leftLength = wallLength(left)
  const rightLength = wallLength(right)
  if (!(isUsefulLength(leftLength) && isUsefulLength(rightLength))) return true
  const leftDirection = [
    (left.end[0] - left.start[0]) / leftLength,
    (left.end[1] - left.start[1]) / leftLength,
  ]
  const rightDirection = [
    (right.end[0] - right.start[0]) / rightLength,
    (right.end[1] - right.start[1]) / rightLength,
  ]
  return (
    Math.abs(leftDirection[0]! * rightDirection[1]! - leftDirection[1]! * rightDirection[0]!) < 1e-4
  )
}

function wallFootprintPoints(wall: WallNode): [number, number][] {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = wallLength(wall)
  if (!isUsefulLength(length)) return []

  const normal: [number, number] = [-dy / length, dx / length]
  const offsets = getWallAssemblyFaceOffsets(wall)
  return [offsets.interior, offsets.exterior].flatMap((offset) => [
    [wall.start[0] + normal[0] * offset, wall.start[1] + normal[1] * offset],
    [wall.end[0] + normal[0] * offset, wall.end[1] + normal[1] * offset],
  ])
}

function constructionModuleMeasurements(node: AnyNode): ConstructionModuleMeasurement[] {
  if (node.type === 'wall') return wallMeasurements(node)
  if (node.type === 'door' || node.type === 'window') return openingMeasurements(node)
  return []
}

function wallMeasurements(wall: WallNode): ConstructionModuleMeasurement[] {
  if (wall.curveOffset !== undefined && Math.abs(wall.curveOffset) > 1e-6) return []

  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (!isUsefulLength(length)) return []

  return [
    {
      nodeId: wall.id,
      nodeType: wall.type,
      kind: 'wall-length',
      label: 'wall length',
      measured: length,
    },
  ]
}

function openingMeasurements(opening: DoorNode | WindowNode): ConstructionModuleMeasurement[] {
  return [
    widthMeasurement(opening, 'opening-width', 'nominal width', opening.width),
    widthMeasurement(
      opening,
      'rough-opening-width',
      'rough opening width',
      opening.roughOpeningWidth,
    ),
    widthMeasurement(
      opening,
      'masonry-opening-width',
      'masonry opening width',
      opening.masonryOpeningWidth,
    ),
    widthMeasurement(
      opening,
      'finish-opening-width',
      'finish opening width',
      opening.finishOpeningWidth,
    ),
  ].filter((measurement): measurement is ConstructionModuleMeasurement => measurement !== null)
}

function widthMeasurement(
  opening: DoorNode | WindowNode,
  kind: ConstructionModuleMeasurementKind,
  label: string,
  measured: number | undefined,
): ConstructionModuleMeasurement | null {
  if (!isUsefulLength(measured)) return null
  return {
    nodeId: opening.id,
    nodeType: opening.type,
    kind,
    label,
    measured,
  }
}

function bestModuleFit(measured: number, modules: readonly number[]): ModuleFit | null {
  let best: ModuleFit | null = null
  for (const module of modules) {
    if (!isUsefulLength(module)) continue
    const multiple = Math.max(1, Math.round(measured / module))
    const nearestMultiple = multiple * module
    const deviation = Math.abs(measured - nearestMultiple)
    if (!best || deviation < best.deviation) {
      best = { module, nearestMultiple, deviation }
    }
  }
  return best
}

function moduleAdvisoryMessage(
  measurement: ConstructionModuleMeasurement,
  profile: ConstructionModuleProfile,
  fit: ModuleFit,
): string {
  const unit = profile.system === 'imperial' ? 'imperial' : 'metric'
  const measured = formatConstructionLength(measurement.measured, unit)
  const module = formatModuleLength(fit.module, profile.system)
  const deviation = formatConstructionLength(fit.deviation, unit)

  return `${titleCase(measurement.nodeType)} ${measurement.nodeId} ${measurement.label} ${measured} is ${deviation} off the ${module} construction module.`
}

function formatModuleLength(module: number, system: ConstructionModuleSystem): string {
  if (system === 'metric') return `${Math.round(module * 1000)} mm`
  return formatConstructionLength(module, 'imperial')
}

function isUsefulLength(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 1e-6
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
