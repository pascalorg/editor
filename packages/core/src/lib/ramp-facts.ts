import type { SceneNodes } from '../agent-operations/types'
import { refuse } from '../agent-tools/refusal'
import type { AnyNode, AnyNodeId, BuildingNode, DoorNode, RampNode } from '../schema'
import { getLevelElevations, levelFloorWorldY } from '../services/storey'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { findLevelAncestorId, resolveBuildingForLevel } from './node-ancestry'
import { getOpeningFloorDatum } from './opening-floor-datum'
import { pointInPolygon } from './polygon-relations'
import {
  type RampPoint,
  type RampStation,
  rampCentrelineMaximumSlopePercent,
  rampHeightAt,
  rampLength,
  rampMaximumSlopePercent,
  rampStations,
} from './ramp'
import { slabTerrainHeightAt } from './slab-terrain'

export type RampTargetMatch = {
  targetId: string
  kind: 'door' | 'level' | 'unknown'
  matched: boolean
  horizontalErrorM: number | null
  heightErrorM: number | null
  planeErrorM: number | null
  planeToleranceM: number | null
  lateralErrorM: number | null
  lateralToleranceM: number | null
  point: RampPoint | null
  heightM: number | null
  levelId: string | null
}
export type RampWarning = {
  code: 'ramp_slope_exceeded' | 'ramp_target_mismatch'
  message: string
  endpoint?: 'start' | 'end'
  targetId?: string
}
export type RampTransitionFacts = {
  lengthM: number
  startDistanceM: number
  endDistanceM: number
  startHeightM: number
  endHeightM: number
  startGradePercent: number
  endGradePercent: number
}
export type RampFacts = {
  lengthM: number
  riseM: number
  averageSlopePercent: number
  maximumSlopePercent: number
  centrelineMaximumSlopePercent: number
  maxSlopePercent: number
  heightToleranceM: number
  startTransitionM: number
  endTransitionM: number
  plateauLengthM: number
  transitions: { start: RampTransitionFacts; end: RampTransitionFacts }
  endpoints: {
    start: { point: RampPoint; heightM: number }
    end: { point: RampPoint; heightM: number }
  }
  targets: { start: RampTargetMatch | null; end: RampTargetMatch | null }
  warnings: RampWarning[]
  retaining: {
    kind: 'retaining_wall'
    heightM: number
    thicknessM: number
    sides: ('left' | 'right')[]
  }
}
const HEIGHT_TOLERANCE = 0.05
const asNodes = (nodes: SceneNodes) => nodes as Record<AnyNodeId, AnyNode>
type TargetFrame = { building: BuildingNode; baseY: number; levelId: string }

function targetBuilding(ramp: RampNode, levelId: string, nodes: SceneNodes): BuildingNode | null {
  const id = resolveBuildingForLevel(levelId as AnyNodeId, asNodes(nodes))
  const building = id ? nodes[id] : undefined
  if (
    building?.type !== 'building' ||
    ![...building.position, ...building.rotation].every(Number.isFinite)
  )
    return null
  if (Math.abs(building.rotation[0]) > 1e-8 || Math.abs(building.rotation[2]) > 1e-8) return null
  const site = ramp.parentId ? nodes[ramp.parentId] : undefined
  if (site?.type !== 'site') return null
  return building.parentId === ramp.parentId ||
    (site?.type === 'site' && site.children.includes(building.id))
    ? building
    : null
}

function toSite(building: BuildingNode, [x, z]: RampPoint): RampPoint {
  const cos = Math.cos(building.rotation[1]),
    sin = Math.sin(building.rotation[1])
  return [cos * x + sin * z + building.position[0], -sin * x + cos * z + building.position[2]]
}

function toBuilding(building: BuildingNode, [x, z]: RampPoint): RampPoint {
  const cos = Math.cos(building.rotation[1]),
    sin = Math.sin(building.rotation[1])
  const dx = x - building.position[0],
    dz = z - building.position[2]
  return [cos * dx - sin * dz, sin * dx + cos * dz]
}

function measureDoor(
  ramp: RampNode,
  target: DoorNode,
  endpoint: RampStation,
  { building, baseY }: TargetFrame,
  nodes: SceneNodes,
): Partial<RampTargetMatch> {
  const wall = target.parentId ? nodes[target.parentId] : undefined
  if (wall?.type !== 'wall') return {}
  const length = getWallCurveLength(wall)
  if (!Number.isFinite(length) || length <= 1e-8) return {}
  const frame = getWallCurveFrameAt(wall, target.position[0] / length)
  const offset = getWallBodyCenterOffset(wall) + target.position[2]
  const point = toSite(building, [
    frame.point.x + frame.normal.x * offset,
    frame.point.y + frame.normal.y * offset,
  ])
  const heightM =
    building.position[1] +
    baseY +
    getOpeningFloorDatum(wall, target, nodes) +
    target.position[1] -
    target.height / 2
  const [cos, sin] = [Math.cos(building.rotation[1]), Math.sin(building.rotation[1])]
  const tx = cos * frame.tangent.x + sin * frame.tangent.y
  const tz = -sin * frame.tangent.x + cos * frame.tangent.y
  const nx = cos * frame.normal.x + sin * frame.normal.y
  const nz = -sin * frame.normal.x + cos * frame.normal.y
  const dx = endpoint.point[0] - point[0],
    dz = endpoint.point[1] - point[1]
  const planeErrorM = Math.abs(dx * nx + dz * nz)
  const planeToleranceM = getWallThickness(wall) / 2 + HEIGHT_TOLERANCE
  const lateralErrorM = Math.abs(dx * tx + dz * tz)
  const lateralToleranceM =
    target.width / 2 +
    (ramp.width / 2) * Math.abs(-endpoint.tangent[1] * tx + endpoint.tangent[0] * tz)
  const heightErrorM = endpoint.height - heightM
  return {
    point,
    heightM,
    horizontalErrorM: Math.hypot(dx, dz),
    heightErrorM,
    planeErrorM,
    planeToleranceM,
    lateralErrorM,
    lateralToleranceM,
    matched:
      planeErrorM <= planeToleranceM + 1e-8 &&
      lateralErrorM <= lateralToleranceM + 1e-8 &&
      Math.abs(heightErrorM) <= HEIGHT_TOLERANCE + 1e-8,
  }
}

function measureLevel(
  endpoint: RampStation,
  { building, baseY, levelId }: TargetFrame,
  nodes: SceneNodes,
): Partial<RampTargetMatch> {
  const local = toBuilding(building, endpoint.point)
  const tops = Object.values(nodes).flatMap((node) =>
    node.type === 'slab' &&
    node.parentId === levelId &&
    !node.recessed &&
    pointInPolygon(local, node.polygon) &&
    !node.holes.some((hole) => pointInPolygon(local, hole))
      ? [building.position[1] + baseY + slabTerrainHeightAt(node, nodes, local[0], local[1])]
      : [],
  )
  const heightM = tops.length ? Math.max(...tops) : levelFloorWorldY(asNodes(nodes), levelId)
  const heightErrorM = heightM === null ? null : endpoint.height - heightM
  return {
    heightM,
    heightErrorM,
    point: tops.length ? endpoint.point : null,
    horizontalErrorM: tops.length ? 0 : null,
    matched:
      tops.length > 0 && heightErrorM !== null && Math.abs(heightErrorM) <= HEIGHT_TOLERANCE + 1e-8,
  }
}

function targetMatch(
  ramp: RampNode,
  targetId: string,
  endpoint: RampStation,
  nodes: SceneNodes,
): RampTargetMatch {
  const target = nodes[targetId]
  const kind = target?.type === 'door' || target?.type === 'level' ? target.type : 'unknown'
  const levelId = findLevelAncestorId(targetId as AnyNodeId, asNodes(nodes))
  const result: RampTargetMatch = {
    targetId,
    kind,
    matched: false,
    horizontalErrorM: null,
    heightErrorM: null,
    planeErrorM: null,
    planeToleranceM: null,
    lateralErrorM: null,
    lateralToleranceM: null,
    point: null,
    heightM: null,
    levelId,
  }
  if (!levelId || kind === 'unknown') return result
  const building = targetBuilding(ramp, levelId, nodes)
  const baseY = getLevelElevations(asNodes(nodes)).get(levelId)?.baseY
  if (!building || baseY === undefined || !Number.isFinite(baseY)) return result
  const frame = { building, baseY, levelId }
  const measured = {
    ...result,
    ...(target?.type === 'door'
      ? measureDoor(ramp, target, endpoint, frame, nodes)
      : measureLevel(endpoint, frame, nodes)),
  }
  const finite = [
    ...(measured.point ?? []),
    ...Object.values(measured).filter((value) => typeof value === 'number'),
  ].every(Number.isFinite)
  return finite ? measured : result
}

function transitionFacts(
  ramp: RampNode,
  startDistanceM: number,
  endDistanceM: number,
  startGradePercent: number,
  endGradePercent: number,
): RampTransitionFacts {
  return {
    lengthM: endDistanceM - startDistanceM,
    startDistanceM,
    endDistanceM,
    startHeightM: rampHeightAt(ramp, startDistanceM),
    endHeightM: rampHeightAt(ramp, endDistanceM),
    startGradePercent,
    endGradePercent,
  }
}

/** Measured design facts, not accessibility, traffic or structural certification. */
export function rampFacts(ramp: RampNode, nodes: SceneNodes): RampFacts {
  const lengthM = rampLength(ramp)
  const stations = rampStations(ramp, Math.max(0.5, lengthM / 1000))
  const start = stations[0]
  const end = stations.at(-1)
  if (!start || !end) refuse('ramp_degenerate', 'A ramp needs measurable endpoints.')
  const targets = {
    start: ramp.startTargetId ? targetMatch(ramp, ramp.startTargetId, start, nodes) : null,
    end: ramp.endTargetId ? targetMatch(ramp, ramp.endTargetId, end, nodes) : null,
  }
  const maximumSlopePercent = rampMaximumSlopePercent(ramp)
  const centrelineMaximumSlopePercent = rampCentrelineMaximumSlopePercent(ramp)
  const signedGrade = Math.sign(ramp.endHeight - ramp.startHeight) * centrelineMaximumSlopePercent
  const warnings: RampWarning[] = []
  if (maximumSlopePercent > ramp.maxSlopePercent + 1e-8)
    warnings.push({
      code: 'ramp_slope_exceeded',
      message: `Ramp maximum grade is ${maximumSlopePercent.toFixed(3)}%, above the stated ${ramp.maxSlopePercent}% target.`,
    })
  for (const endpoint of ['start', 'end'] as const) {
    const target = targets[endpoint]
    if (target && !target.matched)
      warnings.push({
        code: 'ramp_target_mismatch',
        endpoint,
        targetId: target.targetId,
        message: `Ramp ${endpoint} does not reach ${target.targetId}: plan gap ${target.horizontalErrorM === null ? 'unmeasured' : `${target.horizontalErrorM.toFixed(3)} m`}, height difference ${target.heightErrorM === null ? 'unmeasured' : `${target.heightErrorM.toFixed(3)} m`}.`,
      })
  }
  return {
    lengthM,
    riseM: ramp.endHeight - ramp.startHeight,
    averageSlopePercent: (Math.abs(ramp.endHeight - ramp.startHeight) / lengthM) * 100,
    maximumSlopePercent,
    centrelineMaximumSlopePercent,
    maxSlopePercent: ramp.maxSlopePercent,
    heightToleranceM: HEIGHT_TOLERANCE,
    startTransitionM: ramp.startTransition,
    endTransitionM: ramp.endTransition,
    plateauLengthM: Math.max(0, lengthM - ramp.startTransition - ramp.endTransition),
    transitions: {
      start: transitionFacts(
        ramp,
        0,
        ramp.startTransition,
        ramp.startTransition > 0 ? 0 : signedGrade,
        signedGrade,
      ),
      end: transitionFacts(
        ramp,
        lengthM - ramp.endTransition,
        lengthM,
        signedGrade,
        ramp.endTransition > 0 ? 0 : signedGrade,
      ),
    },
    endpoints: {
      start: { point: ramp.start, heightM: ramp.startHeight },
      end: { point: end.point, heightM: ramp.endHeight },
    },
    targets,
    warnings,
    retaining: {
      kind: 'retaining_wall',
      heightM: ramp.retainingHeight,
      thicknessM: 0.2,
      sides: ramp.retainingHeight > 0 ? ['left', 'right'] : [],
    },
  }
}
