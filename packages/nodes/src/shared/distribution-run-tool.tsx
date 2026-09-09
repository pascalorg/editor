'use client'

import { type AnyNodeId, emitter, type GridEvent, sceneRegistry, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  clearPlacementSurface,
  DimensionPill,
  type DimensionPillPart,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  publishPlacementSurface,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'
import type { RunSurfaceBounds, RunSurfaceTarget } from './distribution-run-contract'
import { clearDrawAlignment } from './draw-alignment'
import type { RunBodyHit, ScenePort } from './ports'
import { resolveRunCursorPlane } from './run-cursor'
import {
  RunDirectionFeedback,
  type RunDirectionMode,
  run3DDirectionCandidates,
  runHorizontalDirectionCandidates,
} from './run-direction-feedback'

export type RunPoint = [number, number, number]

export type RunSurfaceFrame = {
  origin: RunPoint
  normal: RunPoint
  tangent: RunPoint
  bitangent: RunPoint
}

type RunPointerEvent = GridEvent

export type RunConnection = {
  port: ScenePort | null
  body: RunBodyHit | null
}

export type RunCommitResult = {
  nextStart: RunPoint
  nextConnection: RunConnection
}

export type RunCursorRay = {
  origin: RunPoint
  direction: RunPoint
}

export type CameraDirectionProjection = {
  point: RunPoint
  direction: RunPoint
}

type ResolvedRunPoint = RunConnection & {
  point: RunPoint
  frame?: RunSurfaceFrame
  surfaceTarget?: RunSurfaceTarget | null
  snapped: RunPoint | null
  directionMode: RunDirectionMode
}

const UP: RunPoint = [0, 1, 0]
const X_AXIS: RunPoint = [1, 0, 0]
const Z_AXIS: RunPoint = [0, 0, 1]

function dotRun(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

function crossRun(a: readonly number[], b: readonly number[]): RunPoint {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ]
}

function normalizeRun(vector: readonly number[], fallback: RunPoint): RunPoint {
  const length = Math.hypot(vector[0]!, vector[1]!, vector[2]!)
  return length < 1e-9
    ? [...fallback]
    : [vector[0]! / length, vector[1]! / length, vector[2]! / length]
}

/** Build a stable 2D drawing frame for a floor, wall, ceiling, or sloped face. */
export function createRunSurfaceFrame(
  origin: readonly number[],
  surfaceNormal: readonly number[] = UP,
): RunSurfaceFrame {
  const normal = normalizeRun(surfaceNormal, UP)
  // Prefer the building's vertical axis for walls and sloped surfaces. For a
  // horizontal floor/ceiling this deliberately falls back to world X so the
  // frame remains stable and matches the existing floor grid orientation.
  const horizontal = Math.abs(dotRun(normal, UP)) > 0.98
  const tangent = horizontal
    ? ([...X_AXIS] as RunPoint)
    : normalizeRun(crossRun(UP, normal), X_AXIS)
  const bitangent = horizontal
    ? ([...Z_AXIS] as RunPoint)
    : normalizeRun(crossRun(normal, tangent), Z_AXIS)
  return {
    origin: [origin[0]!, origin[1]!, origin[2]!],
    normal,
    tangent,
    bitangent,
  }
}

export function projectRunPointToSurface(
  point: readonly number[],
  frame: RunSurfaceFrame,
): RunPoint {
  const offset: RunPoint = [
    point[0]! - frame.origin[0],
    point[1]! - frame.origin[1],
    point[2]! - frame.origin[2],
  ]
  const distance = dotRun(offset, frame.normal)
  return [
    point[0]! - frame.normal[0] * distance,
    point[1]! - frame.normal[1] * distance,
    point[2]! - frame.normal[2] * distance,
  ]
}

export function snapRunPointToSurface(
  point: readonly number[],
  frame: RunSurfaceFrame,
  step: number,
): RunPoint {
  const projected = projectRunPointToSurface(point, frame)
  if (step <= 0) return projected
  const offset: RunPoint = [
    projected[0] - frame.origin[0],
    projected[1] - frame.origin[1],
    projected[2] - frame.origin[2],
  ]
  const u = snapRunValue(dotRun(offset, frame.tangent), step)
  const v = snapRunValue(dotRun(offset, frame.bitangent), step)
  return [
    frame.origin[0] + frame.tangent[0] * u + frame.bitangent[0] * v,
    frame.origin[1] + frame.tangent[1] * u + frame.bitangent[1] * v,
    frame.origin[2] + frame.tangent[2] * u + frame.bitangent[2] * v,
  ]
}

export function projectRunToSurfaceAngleLock(
  from: readonly number[],
  raw: readonly number[],
  frame: RunSurfaceFrame,
  sourceDirection: readonly number[] | null = null,
): RunPoint {
  const fromOffset: RunPoint = [
    from[0]! - frame.origin[0],
    from[1]! - frame.origin[1],
    from[2]! - frame.origin[2],
  ]
  const rawOffset: RunPoint = [raw[0]! - from[0]!, raw[1]! - from[1]!, raw[2]! - from[2]!]
  const rawU = dotRun(rawOffset, frame.tangent)
  const rawV = dotRun(rawOffset, frame.bitangent)
  const sourceU = sourceDirection ? dotRun(sourceDirection, frame.tangent) : 0
  const sourceV = sourceDirection ? dotRun(sourceDirection, frame.bitangent) : 0
  const sourceAngle =
    sourceDirection && Math.hypot(sourceU, sourceV) > 1e-6
      ? Math.atan2(sourceV, sourceU)
      : Math.atan2(rawV, rawU)
  const angle = Math.round(sourceAngle / ANGLE_STEP_RAD) * ANGLE_STEP_RAD
  const distance = Math.max(0, rawU * Math.cos(angle) + rawV * Math.sin(angle))
  const u = dotRun(fromOffset, frame.tangent) + Math.cos(angle) * distance
  const v = dotRun(fromOffset, frame.bitangent) + Math.sin(angle) * distance
  return [
    frame.origin[0] + frame.tangent[0] * u + frame.bitangent[0] * v,
    frame.origin[1] + frame.tangent[1] * u + frame.bitangent[1] * v,
    frame.origin[2] + frame.tangent[2] * u + frame.bitangent[2] * v,
  ]
}

type DistributionRunToolConfig = {
  active: boolean
  levelId: AnyNodeId | null
  toolName: 'duct-segment' | 'pipe-segment'
  initialStart?: RunPoint | null
  initialConnection?: RunConnection | null
  findPort: (point: RunPoint, surface: RunSurfaceTarget | null) => ScenePort | null
  findBody: (point: RunPoint, surface: RunSurfaceTarget | null) => RunBodyHit | null
  surfaceClearance?: (surface: RunSurfaceTarget | null) => number
  resolveFreeEnd?: (start: RunPoint, end: RunPoint, startConnection: RunConnection) => RunPoint
  /** Minimum drawable centerline length, including fitting clearance. */
  minimumSegmentLength?: number
  inheritFromConnection?: (connection: RunConnection) => void
  commit: (args: {
    start: RunPoint
    end: RunPoint
    startConnection: RunConnection
    endConnection: RunConnection
    surfaceTarget: RunSurfaceTarget | null
  }) => RunCommitResult | null
  onShortcut?: (event: KeyboardEvent, start: RunPoint | null) => void
}

const ANGLE_STEP_RAD = Math.PI / 4
const ALT_PIXELS_PER_METER = 100
export const RUN_PREVIEW_OPACITY = 0.55
export const RUN_SNAP_CURSOR_COLOR = '#22c55e'

export function runSectionHalfSizeM(nominalInches: number): number {
  return (nominalInches * 0.0254) / 2
}

export function snapRunValue(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function runDistanceSquared(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!
  const dy = a[1]! - b[1]!
  const dz = a[2]! - b[2]!
  return dx * dx + dy * dy + dz * dz
}

export function projectRunToAngleLock(
  from: RunPoint,
  raw: RunPoint,
  sourceDirection: readonly [number, number, number] | null = null,
): RunPoint {
  const dx = raw[0] - from[0]
  const dz = raw[2] - from[2]
  const length = Math.hypot(dx, dz)
  if (length < 1e-4) return [...from]
  if (!sourceDirection) {
    const angle = Math.round(Math.atan2(dz, dx) / ANGLE_STEP_RAD) * ANGLE_STEP_RAD
    const distance = Math.max(0, dx * Math.cos(angle) + dz * Math.sin(angle))
    return [from[0] + Math.cos(angle) * distance, from[1], from[2] + Math.sin(angle) * distance]
  }
  const candidates = runHorizontalDirectionCandidates(sourceDirection)
  let winner = candidates[0]!
  let winningProjection = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    const projection = dx * candidate[0] + dz * candidate[2]
    if (projection > winningProjection) {
      winner = candidate
      winningProjection = projection
    }
  }
  const distance = Math.max(0, winningProjection)
  return [from[0] + winner[0] * distance, from[1], from[2] + winner[2] * distance]
}

function dotRunVector(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
}

function normalizedRunVector(vector: readonly number[]): RunPoint | null {
  const length = Math.hypot(vector[0]!, vector[1]!, vector[2]!)
  return length < 1e-9 ? null : [vector[0]! / length, vector[1]! / length, vector[2]! / length]
}

export function projectRunToDirection(
  from: RunPoint,
  raw: RunPoint,
  direction: readonly [number, number, number],
): RunPoint {
  const distance = Math.max(
    0,
    dotRun([raw[0] - from[0], raw[1] - from[1], raw[2] - from[2]], direction),
  )
  return [
    from[0] + direction[0] * distance,
    from[1] + direction[1] * distance,
    from[2] + direction[2] * distance,
  ]
}

export function projectRunToCameraDirection(
  from: RunPoint,
  ray: RunCursorRay,
  sourceDirection: readonly [number, number, number],
  minimumDistance: number,
  gridStep: number,
  candidates = run3DDirectionCandidates(sourceDirection),
  surfaceFrame?: RunSurfaceFrame,
): CameraDirectionProjection | null {
  const rayDirection = normalizedRunVector(ray.direction)
  if (!rayDirection) return null
  const fromRayOrigin: RunPoint = [
    ray.origin[0] - from[0],
    ray.origin[1] - from[1],
    ray.origin[2] - from[2],
  ]
  let winner: CameraDirectionProjection | null = null
  let winningAim = Number.NEGATIVE_INFINITY

  for (const direction of candidates) {
    const parallel = dotRunVector(rayDirection, direction)
    const denominator = 1 - parallel * parallel
    const projectedDistance =
      Math.abs(denominator) < 1e-9
        ? minimumDistance
        : (dotRunVector(fromRayOrigin, direction) -
            parallel * dotRunVector(fromRayOrigin, rayDirection)) /
          denominator
    const distance = Math.max(
      minimumDistance,
      snapRunValue(Math.max(projectedDistance, minimumDistance), gridStep),
    )
    const point: RunPoint = [
      from[0] + direction[0] * distance,
      from[1] + direction[1] * distance,
      from[2] + direction[2] * distance,
    ]
    if (
      surfaceFrame &&
      runDistanceSquared(point, projectRunPointToSurface(point, surfaceFrame)) > 1e-8
    ) {
      continue
    }
    const aim = normalizedRunVector([
      point[0] - ray.origin[0],
      point[1] - ray.origin[1],
      point[2] - ray.origin[2],
    ])
    if (!aim) continue
    const aimDot = dotRunVector(rayDirection, aim)
    if (aimDot > winningAim) {
      winningAim = aimDot
      winner = { point, direction }
    }
  }
  return winner
}

export function stepNominalRunSize(
  sizes: readonly number[],
  current: number,
  direction: 1 | -1,
): number {
  let nearest = 0
  for (let index = 1; index < sizes.length; index++) {
    if (Math.abs(sizes[index]! - current) < Math.abs(sizes[nearest]! - current)) nearest = index
  }
  return sizes[Math.min(sizes.length - 1, Math.max(0, nearest + direction))] ?? current
}

function wallSurfaceBounds(hostId: AnyNodeId): RunSurfaceBounds {
  const wall = useScene.getState().nodes[hostId]
  if (wall?.type !== 'wall') {
    return { minU: 0, maxU: 0, minV: 0, maxV: 0 }
  }
  return {
    minU: 0,
    maxU: Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]),
    minV: 0,
    maxV: Math.max(0, wall.height ?? 0),
  }
}

function stableWallFrame(
  frame: RunSurfaceFrame,
  hostId: AnyNodeId,
  activeLevelId: AnyNodeId | null,
): RunSurfaceFrame {
  const wall = useScene.getState().nodes[hostId]
  if (wall?.type !== 'wall') return frame
  const origin = new Vector3(wall.start[0], 0, wall.start[1])
  const ownerLevel = wall.parentId ? sceneRegistry.nodes.get(wall.parentId as AnyNodeId) : null
  const activeLevel = activeLevelId ? sceneRegistry.nodes.get(activeLevelId) : null
  if (ownerLevel) ownerLevel.localToWorld(origin)
  if (activeLevel) activeLevel.worldToLocal(origin)
  return {
    ...frame,
    origin: projectRunPointToSurface(origin.toArray(), frame),
  }
}

function publishRunSurface(
  target: RunSurfaceTarget | null,
  point: RunPoint,
  activeLevelId: AnyNodeId | null,
): void {
  if (!target) {
    clearPlacementSurface()
    return
  }
  const building = activeLevelId ? sceneRegistry.nodes.get(activeLevelId) : null
  const worldPoint = new Vector3(...point)
  const worldAnchor = new Vector3(...target.frame.origin)
  const worldNormalPoint = new Vector3(
    target.frame.origin[0] + target.frame.normal[0],
    target.frame.origin[1] + target.frame.normal[1],
    target.frame.origin[2] + target.frame.normal[2],
  )
  if (building) {
    building.localToWorld(worldPoint)
    building.localToWorld(worldAnchor)
    building.localToWorld(worldNormalPoint)
  }
  const worldNormal = worldNormalPoint.sub(worldAnchor).normalize()
  publishPlacementSurface(worldPoint, worldNormal, 'fixed-plane', worldAnchor)
}

function surfacePointFromEvent(
  event: RunPointerEvent,
  activeLevelId: AnyNodeId | null,
): {
  point: RunPoint
  frame: RunSurfaceFrame
  isHorizontal: boolean
  target: RunSurfaceTarget | null
} {
  const source = event.surfaceLocalPosition ?? event.localPosition
  const point: RunPoint = [source[0], source[1], source[2]]
  const frame = createRunSurfaceFrame(point, event.surfaceNormal ?? UP)
  const planeDistance = dotRun(point, frame.normal)
  frame.origin = frame.normal.map((value) => value * planeDistance) as RunPoint
  const floorLevelId = event.surfaceHit?.levelId ?? activeLevelId
  const wallNode = event.surfaceHit?.hostId
    ? useScene.getState().nodes[event.surfaceHit.hostId]
    : undefined
  // The selected level can legitimately remain on the ground floor while the
  // cursor is over a wall on another storey. Resolve the wall's owning level
  // from the hit node so the wall target cannot be downgraded to a floor target.
  const wallLevelId = wallNode?.type === 'wall' ? (wallNode.parentId as AnyNodeId) : undefined
  const target =
    event.surfaceHit?.kind === 'wall' && event.surfaceHit.face === 'side' && wallLevelId
      ? {
          kind: 'wall' as const,
          levelId: wallLevelId,
          hostId: event.surfaceHit.hostId,
          side: event.surfaceHit.side ?? 'front',
          frame: stableWallFrame(frame, event.surfaceHit.hostId, activeLevelId),
          bounds: wallSurfaceBounds(event.surfaceHit.hostId),
        }
      : floorLevelId
        ? {
            kind:
              event.surfaceHit?.kind === 'ceiling' || frame.normal[1] < -0.98
                ? ('ceiling' as const)
                : Math.abs(frame.normal[1]) > 0.98
                  ? ('floor' as const)
                  : ('surface' as const),
            hostId: event.surfaceHit?.hostId,
            levelId: floorLevelId,
            frame,
          }
        : null
  return {
    point,
    frame: target?.frame ?? frame,
    isHorizontal: event.surfaceNormal == null || Math.abs(frame.normal[1]) > 0.98,
    target,
  }
}

export function useDistributionRunTool(config: DistributionRunToolConfig) {
  const { camera, gl } = useThree()
  const initialStartRef = useRef<RunPoint | null>(
    config.initialStart ? [...config.initialStart] : null,
  )
  const initialConnectionRef = useRef<RunConnection>(
    config.initialConnection ?? { port: null, body: null },
  )
  const [start, setStart] = useState<RunPoint | null>(initialStartRef.current)
  const [cursor, setCursor] = useState<RunPoint | null>(initialStartRef.current)
  const [snapTarget, setSnapTarget] = useState<RunPoint | null>(null)
  const [endConnection, setEndConnection] = useState<RunConnection>({
    port: null,
    body: null,
  })
  const [altActive, setAltActive] = useState(false)
  const [directionMode, setDirectionMode] = useState<RunDirectionMode>('free')
  const [lengthInput, setLengthInput] = useState('')
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const startRef = useRef(start)
  startRef.current = start
  const startConnectionRef = useRef<RunConnection>(initialConnectionRef.current)
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  const lastPointerRef = useRef<GridEvent | null>(null)
  const refreshCursorRef = useRef<() => void>(() => {})
  const lastClientYRef = useRef<number | null>(null)
  const lastResolvedRef = useRef<ResolvedRunPoint | null>(null)
  const forcedDirectionRef = useRef<RunPoint | null>(null)
  const lengthInputRef = useRef('')

  useEffect(() => {
    if (!config.active) return
    const toolName = config.toolName
    useInteractionScope.getState().begin({ kind: 'drafting', tool: toolName })
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === toolName)
      clearPlacementSurface()
    }
  }, [config.active, config.toolName])

  const refreshCursor = useCallback(() => refreshCursorRef.current(), [])

  const updateLengthInput = useCallback((value: string) => {
    const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '')
    const firstDot = normalized.indexOf('.')
    const cleaned =
      firstDot < 0
        ? normalized
        : `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`
    lengthInputRef.current = cleaned.slice(0, 12)
    setLengthInput(lengthInputRef.current)
    refreshCursorRef.current()
  }, [])

  useEffect(() => {
    if (!config.active) return

    const applyTypedLength = (resolved: ResolvedRunPoint): ResolvedRunPoint => {
      const currentStart = startRef.current
      const typed = Number.parseFloat(lengthInputRef.current)
      if (
        !currentStart ||
        !Number.isFinite(typed) ||
        typed <= 0 ||
        resolved.port ||
        resolved.body
      ) {
        return resolved
      }
      const direction = normalizedRunVector([
        resolved.point[0] - currentStart[0],
        resolved.point[1] - currentStart[1],
        resolved.point[2] - currentStart[2],
      ])
      if (!direction) return resolved
      return {
        ...resolved,
        point: [
          currentStart[0] + direction[0] * typed,
          currentStart[1] + direction[1] * typed,
          currentStart[2] + direction[2] * typed,
        ],
        snapped: null,
        directionMode: resolved.directionMode,
      }
    }

    const resolvePoint = (event: GridEvent): ResolvedRunPoint => {
      const adapter = configRef.current
      const hit = surfacePointFromEvent(event, adapter.levelId)
      const currentStart = startRef.current
      const previous = lastResolvedRef.current
      // A wall is only an attachment candidate, not a constraint for the
      // whole run. Once the ray leaves the wall, continue on a horizontal
      // plane through the start point so the user can route freely at the
      // same elevation (or use angle lock for a deliberate diagonal).
      const working =
        !event.surfaceHit && previous?.surfaceTarget?.kind === 'wall' && currentStart
          ? createRunSurfaceFrame(currentStart, UP)
          : (previous?.frame ?? (currentStart ? createRunSurfaceFrame(currentStart) : null))
      const hasSurface = !!event.surfaceHit || !working || !event.localRay
      const target = hasSurface ? hit.target : null
      const resolved = resolveRunCursorPlane({
        hit: hasSurface ? { point: hit.point, frame: hit.frame } : null,
        working,
        ray: event.localRay,
        fallback: previous?.point ?? currentStart ?? hit.point,
        clearance: adapter.surfaceClearance?.(target) ?? 0,
      })
      const bypass = event.nativeEvent?.altKey === true
      const gridStep = !bypass && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const angleLocked = !bypass && isAngleSnapActive()
      let point = snapRunPointToSurface(resolved.point, resolved.frame, gridStep)
      const forcedDirection = forcedDirectionRef.current
      if (currentStart && forcedDirection) {
        point = projectRunToDirection(currentStart, point, forcedDirection)
      }
      if (currentStart && angleLocked && !forcedDirection) {
        const from = projectRunPointToSurface(currentStart, resolved.frame)
        if (runDistanceSquared(from, currentStart) < 1e-6) {
          point = projectRunToSurfaceAngleLock(currentStart, point, resolved.frame)
        }
      }
      const sample = { frame: resolved.frame, surfaceTarget: target }
      const acceptsConnection = (candidate: RunPoint, checkOcclusion = true): boolean => {
        const levelId = adapter.levelId
        const level = levelId ? sceneRegistry.nodes.get(levelId) : null
        const world = new Vector3(...candidate)
        if (level) level.localToWorld(world)
        const projected = world.clone().project(camera)
        const rect = gl.domElement.getBoundingClientRect()
        const native = event.nativeEvent as unknown as { clientX?: number; clientY?: number }
        if (native.clientX === undefined || native.clientY === undefined) return false
        const x = rect.left + ((projected.x + 1) * rect.width) / 2
        const y = rect.top + ((1 - projected.y) * rect.height) / 2
        if (
          projected.z < -1 ||
          projected.z > 1 ||
          Math.hypot(x - native.clientX, y - native.clientY) > 12
        )
          return false
        if (checkOcclusion && event.surfaceHit) {
          const origin = camera.getWorldPosition(new Vector3())
          if (world.distanceTo(origin) > new Vector3(...event.position).distanceTo(origin) + 0.03)
            return false
        }
        return true
      }
      // Test the camera ray against the displayed directions before a surface
      // projection discards its height. Hover capture releases outside 12 px.
      if (currentStart && event.localRay && !bypass && (forcedDirection || angleLocked)) {
        const source = startConnectionRef.current.port?.direction ?? null
        const candidates = forcedDirection
          ? [forcedDirection]
          : source
            ? run3DDirectionCandidates(source)
            : runHorizontalDirectionCandidates(null)
        const directionHit = projectRunToCameraDirection(
          currentStart,
          event.localRay,
          source ?? X_AXIS,
          adapter.minimumSegmentLength ?? 0.05,
          gridStep,
          candidates,
          event.surfaceHit && !forcedDirection ? resolved.frame : undefined,
        )
        if (directionHit && (forcedDirection || acceptsConnection(directionHit.point, false))) {
          return {
            point:
              Math.abs(directionHit.direction[1]) < 1e-6 && target?.kind !== 'ceiling'
                ? (adapter.resolveFreeEnd?.(
                    currentStart,
                    directionHit.point,
                    startConnectionRef.current,
                  ) ?? directionHit.point)
                : directionHit.point,
            frame:
              event.surfaceHit && !forcedDirection
                ? resolved.frame
                : createRunSurfaceFrame(currentStart),
            surfaceTarget: forcedDirection ? null : target,
            snapped: null,
            directionMode: 'angle',
            port: null,
            body: null,
          }
        }
      }
      if (!bypass && isMagneticSnapActive()) {
        const port = adapter.findPort(point, target)
        const source = startConnectionRef.current.port
        if (
          port &&
          acceptsConnection([...port.position]) &&
          (!source || port.nodeId !== source.nodeId || port.id !== source.id)
        ) {
          return {
            ...sample,
            point: [...port.position],
            snapped: [...port.position],
            directionMode: 'snap',
            port,
            body: null,
          }
        }
        const body = adapter.findBody(point, target)
        if (body && acceptsConnection(body.point) && body.nodeId !== source?.nodeId) {
          return {
            ...sample,
            point: body.point,
            snapped: body.point,
            directionMode: 'snap',
            port: null,
            body,
          }
        }
      }
      if (currentStart && target?.kind !== 'ceiling' && Math.abs(resolved.frame.normal[1]) > 0.98) {
        point = adapter.resolveFreeEnd?.(currentStart, point, startConnectionRef.current) ?? point
      }
      return {
        ...sample,
        point,
        snapped: null,
        directionMode: angleLocked ? 'angle' : 'free',
        port: null,
        body: null,
      }
    }

    const resolveVerticalPoint = (clientY: number): RunPoint | null => {
      const anchor = altAnchorRef.current
      const currentStart = startRef.current
      if (!anchor || !currentStart) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const delta = snapRunValue((anchor.clientY - clientY) / ALT_PIXELS_PER_METER, step)
      const y = anchor.baseY + delta
      return [currentStart[0], y, currentStart[2]]
    }

    const updateCursor = (resolved: ResolvedRunPoint) => {
      if (!resolved.frame && lastResolvedRef.current?.frame)
        resolved = {
          ...resolved,
          frame: { ...lastResolvedRef.current.frame, origin: resolved.point },
          surfaceTarget: null,
        }
      lastResolvedRef.current = resolved
      const currentStart = startRef.current
      const minimumLength = configRef.current.minimumSegmentLength ?? 0.05
      const length = currentStart
        ? Math.hypot(
            resolved.point[0] - currentStart[0],
            resolved.point[1] - currentStart[1],
            resolved.point[2] - currentStart[2],
          )
        : 0
      const typed = lengthInputRef.current
      setValidationMessage(
        currentStart &&
          typed &&
          (!Number.isFinite(Number.parseFloat(typed)) || Number.parseFloat(typed) <= 0)
          ? 'Enter a positive length'
          : currentStart && length < minimumLength
            ? `Run must be at least ${minimumLength.toFixed(2)} m`
            : null,
      )
      setCursor(resolved.point)
      setSnapTarget(resolved.snapped)
      setEndConnection({
        port: resolved.port,
        body: resolved.port ? null : resolved.body,
      })
      setDirectionMode(resolved.directionMode)
      if (resolved.frame)
        publishRunSurface(
          {
            kind: 'surface',
            levelId: configRef.current.levelId as AnyNodeId,
            frame: resolved.frame,
          },
          resolved.point,
          configRef.current.levelId,
        )
    }

    const commit = (end: RunPoint, connection: RunConnection) => {
      const currentStart = startRef.current
      if (!currentStart) return
      if (lengthInputRef.current && !(Number(lengthInputRef.current) > 0)) return
      const minimumLength = configRef.current.minimumSegmentLength ?? 0.05
      const length = Math.hypot(
        end[0] - currentStart[0],
        end[1] - currentStart[1],
        end[2] - currentStart[2],
      )
      if (length < minimumLength) {
        return
      }
      const capturedTarget = lastResolvedRef.current?.surfaceTarget ?? null
      const clearance = configRef.current.surfaceClearance?.(capturedTarget) ?? 0
      const surfaceTarget =
        capturedTarget?.kind === 'wall' &&
        [currentStart, end].some((point) => {
          const projected = projectRunPointToSurface(point, capturedTarget.frame)
          return Math.abs(Math.sqrt(runDistanceSquared(point, projected)) - clearance) > 1e-4
        })
          ? null
          : capturedTarget
      const result = configRef.current.commit({
        start: currentStart,
        end,
        startConnection: startConnectionRef.current,
        endConnection: connection,
        surfaceTarget,
      })
      if (!result) {
        setValidationMessage('Fitting clearance is too small for this connection')
        return
      }
      triggerSFX('sfx:item-place')
      startRef.current = result.nextStart
      setStart(result.nextStart)
      setSnapTarget(null)
      setEndConnection({ port: null, body: null })
      lengthInputRef.current = ''
      setLengthInput('')
      setValidationMessage(null)
      startConnectionRef.current = result.nextConnection
      forcedDirectionRef.current = null
      altAnchorRef.current = null
      setAltActive(false)
    }

    const onMove = (event: RunPointerEvent) => {
      lastPointerRef.current = event
      const clientY = (event.nativeEvent as { clientY?: number } | undefined)?.clientY
      if (typeof clientY === 'number') lastClientYRef.current = clientY
      if (altAnchorRef.current && typeof clientY === 'number') {
        const point = resolveVerticalPoint(clientY)
        if (point) {
          clearDrawAlignment()
          updateCursor({
            point,
            snapped: null,
            port: null,
            body: null,
            directionMode: 'vertical',
          })
          return
        }
      }
      updateCursor(applyTypedLength(resolvePoint(event)))
    }

    const onClick = (event: GridEvent) => {
      event.nativeEvent?.stopPropagation?.()
      const currentStart = startRef.current
      if (altAnchorRef.current && currentStart) {
        const clientY =
          (event.nativeEvent as { clientY?: number } | undefined)?.clientY ?? lastClientYRef.current
        if (typeof clientY === 'number') {
          const point = resolveVerticalPoint(clientY)
          if (point && Math.abs(point[1] - currentStart[1]) >= 1e-4) {
            commit(point, { port: null, body: null })
          }
        }
        return
      }
      const resolved = applyTypedLength(resolvePoint(event))
      updateCursor(resolved)
      if (!currentStart) {
        triggerSFX('sfx:grid-snap')
        const connection = {
          port: resolved.port,
          body: resolved.port ? null : resolved.body,
        }
        startConnectionRef.current = connection
        configRef.current.inheritFromConnection?.(connection)
        startRef.current = resolved.point
        setStart(resolved.point)
        setCursor(resolved.point)
        setSnapTarget(resolved.snapped)
        setEndConnection({ port: null, body: null })
        return
      }
      const typedResolved = applyTypedLength(resolved)
      commit(typedResolved.point, {
        port: resolved.port,
        body: resolved.port ? null : resolved.body,
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const isLengthField = target ? target.closest('[data-run-length-input]') !== null : false
      if (
        (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') &&
        !isLengthField
      )
        return
      if (event.key === 'Escape' && startRef.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onCancel()
        return
      }
      if (event.key === 'Alt') {
        const currentStart = startRef.current
        if (!currentStart || lastClientYRef.current === null || altAnchorRef.current) return
        event.preventDefault()
        altAnchorRef.current = {
          clientY: lastClientYRef.current,
          baseY: currentStart[1],
        }
        setAltActive(true)
        return
      }
      if (startRef.current && isLengthField && /^[0-9.,]$/.test(event.key)) {
        event.stopImmediatePropagation()
        return
      }
      if (startRef.current && !isLengthField && /^[0-9.,]$/.test(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        updateLengthInput(`${lengthInputRef.current}${event.key}`)
        return
      }
      if (startRef.current && event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const resolved = lastResolvedRef.current
        if (resolved) {
          const typedResolved = applyTypedLength(resolved)
          commit(typedResolved.point, {
            port: typedResolved.port,
            body: typedResolved.port ? null : typedResolved.body,
          })
        }
        return
      }
      configRef.current.onShortcut?.(event, startRef.current)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || !altAnchorRef.current) return
      event.preventDefault()
      altAnchorRef.current = null
      setAltActive(false)
      setDirectionMode('free')
    }

    const onCancel = () => {
      clearDrawAlignment()
      if (!startRef.current) return
      markToolCancelConsumed()
      startRef.current = null
      setStart(null)
      setCursor(null)
      setSnapTarget(null)
      setEndConnection({ port: null, body: null })
      lengthInputRef.current = ''
      setLengthInput('')
      setValidationMessage(null)
      startConnectionRef.current = { port: null, body: null }
      forcedDirectionRef.current = null
      lastPointerRef.current = null
      clearPlacementSurface()
      lastResolvedRef.current = null
      altAnchorRef.current = null
      setAltActive(false)
    }

    refreshCursorRef.current = () => {
      if (lastPointerRef.current)
        updateCursor(applyTypedLength(resolvePoint(lastPointerRef.current)))
      else if (lastResolvedRef.current) updateCursor(applyTypedLength(lastResolvedRef.current))
    }
    const unsubscribeSnapping = useEditor.subscribe((state, previous) => {
      const modeChanged = state.snappingModeByContext !== previous.snappingModeByContext
      if (!modeChanged && state.gridSnapStep === previous.gridSnapStep) return
      if (modeChanged) forcedDirectionRef.current = null
      refreshCursorRef.current()
    })
    emitter.on('grid:click', onClick)
    emitter.on('grid:move', onMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      unsubscribeSnapping()
      emitter.off('grid:click', onClick)
      emitter.off('grid:move', onMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      altAnchorRef.current = null
      lastPointerRef.current = null
      refreshCursorRef.current = () => {}
      clearPlacementSurface()
      clearDrawAlignment()
    }
  }, [camera, gl, config.active, updateLengthInput])

  return {
    refreshCursor,
    start,
    cursor,
    snapTarget,
    altActive,
    directionMode,
    lengthInput,
    validationMessage,
    onLengthInputChange: updateLengthInput,
    onDirectionSelect: (direction: RunPoint) => {
      forcedDirectionRef.current = direction
      setDirectionMode('angle')
      refreshCursorRef.current()
    },
    startConnection: startConnectionRef.current,
    endConnection,
    surfaceTarget: lastResolvedRef.current?.surfaceTarget ?? null,
  }
}

export function DistributionRunCursor({
  cursor,
  start,
  snapTarget,
  altActive,
  unit,
  extraParts = [],
  status,
  surfaceLabel,
  cursorRef,
  directionMode,
  startDirection,
  lengthInput,
  validationMessage,
  onLengthInputChange,
  onDirectionSelect,
}: {
  cursor: RunPoint | null
  start: RunPoint | null
  snapTarget: RunPoint | null
  altActive: boolean
  unit: 'metric' | 'imperial'
  extraParts?: DimensionPillPart[]
  status?: ReactNode
  surfaceLabel?: string
  cursorRef?: RefObject<Group | null>
  directionMode: RunDirectionMode
  startDirection?: readonly [number, number, number] | null
  lengthInput?: string
  validationMessage?: string | null
  minimumSegmentLength?: number
  onLengthInputChange?: (value: string) => void
  onDirectionSelect?: (direction: RunPoint) => void
}) {
  const lengthFieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (start) lengthFieldRef.current?.focus()
  }, [start])
  if (!cursor) return null
  const parts: DimensionPillPart[] = [
    ...(start
      ? [
          {
            key: 'length',
            prefix: 'L',
            value: Math.hypot(cursor[0] - start[0], cursor[1] - start[1], cursor[2] - start[2]),
          } satisfies DimensionPillPart,
        ]
      : []),
    {
      key: 'x',
      prefix: 'X',
      value: start ? cursor[0] - start[0] : cursor[0],
      signed: !!start,
    },
    {
      key: 'y',
      prefix: 'Y',
      value: start ? cursor[1] - start[1] : cursor[1],
      signed: !!start,
    },
    {
      key: 'z',
      prefix: 'Z',
      value: start ? cursor[2] - start[2] : cursor[2],
      signed: !!start,
    },
    ...extraParts,
  ]
  const primary = start ? (altActive ? 'y' : 'length') : undefined
  const elevated = cursor[1] > 0.001
  const ground: RunPoint = [cursor[0], 0, cursor[2]]

  return (
    <>
      {start && (
        <RunDirectionFeedback
          cursor={cursor}
          mode={directionMode}
          snapped={!!snapTarget}
          sourceDirection={startDirection ?? null}
          start={start}
          onDirectionSelect={onDirectionSelect}
        />
      )}
      <CursorSphere
        color={snapTarget ? RUN_SNAP_CURSOR_COLOR : undefined}
        dotAtTip={elevated || undefined}
        height={elevated ? cursor[1] : undefined}
        position={elevated ? ground : cursor}
        ref={cursorRef}
      />
      <group position={cursor}>
        <Html
          center
          position={[0, 1.45, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div className="flex flex-col items-center gap-1">
            {surfaceLabel && (
              <div className="rounded-full bg-background/90 px-3 py-1 text-xs text-foreground">
                {surfaceLabel}
              </div>
            )}
            <DimensionPill parts={parts} primary={primary} unit={unit} />
            {start ? (
              <label className="rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[11px] tabular-nums text-muted-foreground shadow-sm backdrop-blur">
                Length:{' '}
                <input
                  className="w-20 bg-transparent text-center text-foreground outline-none"
                  data-run-length-input
                  inputMode="decimal"
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Backspace' ||
                      event.key === 'Delete' ||
                      event.key === 'ArrowLeft' ||
                      event.key === 'ArrowRight'
                    ) {
                      event.stopPropagation()
                    }
                  }}
                  onChange={(event) => onLengthInputChange?.(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  placeholder="type a length"
                  ref={lengthFieldRef}
                  style={{ pointerEvents: 'auto' }}
                  type="text"
                  value={lengthInput ?? ''}
                />{' '}
                m
              </label>
            ) : null}
            {validationMessage ? (
              <div className="rounded-full border border-red-500/50 bg-red-500/10 px-3 py-1 text-[11px] text-red-700 shadow-sm backdrop-blur dark:text-red-300">
                {validationMessage}
              </div>
            ) : null}
            {status}
          </div>
        </Html>
      </group>
    </>
  )
}
