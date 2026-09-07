'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  type NodeEvent,
  sceneRegistry,
} from '@pascal-app/core'
import {
  CursorSphere,
  DimensionPill,
  type DimensionPillPart,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { type Group, Matrix3, Vector3 } from 'three'
import { alignDrawPoint, clearDrawAlignment } from './draw-alignment'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from './floor-placement'
import type { RunBodyHit, ScenePort } from './ports'
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

type RunPointerEvent = GridEvent | NodeEvent<AnyNode>

type SurfacePointerStamp = {
  nativeEvent: unknown
  x: number
  y: number
  at: number
}

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

/** Lock a wall run to its dominant local axis: along the wall or vertically. */
export function projectRunToSurfaceAxisLock(
  from: readonly number[],
  raw: readonly number[],
  frame: RunSurfaceFrame,
): RunPoint {
  const offset: RunPoint = [raw[0]! - from[0]!, raw[1]! - from[1]!, raw[2]! - from[2]!]
  const along = dotRun(offset, frame.tangent)
  const vertical = dotRun(offset, frame.bitangent)
  const tangentDistance = Math.abs(along) >= Math.abs(vertical) ? along : 0
  const bitangentDistance = Math.abs(vertical) > Math.abs(along) ? vertical : 0
  return [
    from[0]! + frame.tangent[0] * tangentDistance + frame.bitangent[0] * bitangentDistance,
    from[1]! + frame.tangent[1] * tangentDistance + frame.bitangent[1] * bitangentDistance,
    from[2]! + frame.tangent[2] * tangentDistance + frame.bitangent[2] * bitangentDistance,
  ]
}

type DistributionRunToolConfig = {
  active: boolean
  initialStart?: RunPoint | null
  initialConnection?: RunConnection | null
  findPort: (point: RunPoint) => ScenePort | null
  findBody: (point: RunPoint) => RunBodyHit | null
  resolveFirstY?: (x: number, z: number) => number
  resolveFreeEnd?: (start: RunPoint, end: RunPoint, startConnection: RunConnection) => RunPoint
  minimumFreeY?: () => number
  /** Minimum drawable centerline length, including fitting clearance. */
  minimumSegmentLength?: number
  inheritFromConnection?: (connection: RunConnection) => void
  commit: (args: {
    start: RunPoint
    end: RunPoint
    startConnection: RunConnection
    endConnection: RunConnection
  }) => RunCommitResult | null
  onCursorPoint?: (point: RunPoint) => void
  onClear?: () => void
  onShortcut?: (event: KeyboardEvent, start: RunPoint | null) => void
}

const ANGLE_STEP_RAD = Math.PI / 4
const ALT_PIXELS_PER_METER = 100
const ALT_Y_MIN_M = -3
const ALT_Y_MAX_M = 10
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

export function projectRunToCameraDirection(
  from: RunPoint,
  ray: RunCursorRay,
  sourceDirection: readonly [number, number, number],
  minimumDistance: number,
  gridStep: number,
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

  for (const direction of run3DDirectionCandidates(sourceDirection)) {
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

function buildingLocalPoint(point: Vector3): Vector3 {
  const buildingId = useViewer.getState().selection.buildingId
  const building = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  return building ? building.worldToLocal(point) : point
}

function nodeSurfaceFrame(event: NodeEvent<AnyNode>): RunSurfaceFrame {
  const point = new Vector3(...event.position)
  const localPoint = buildingLocalPoint(point.clone())
  event.object.updateWorldMatrix(true, false)
  const normal = new Vector3(...(event.normal ?? UP)).applyNormalMatrix(
    new Matrix3().getNormalMatrix(event.object.matrixWorld),
  )
  const worldNormalPoint = point.clone().add(normal)
  const localNormalPoint = buildingLocalPoint(worldNormalPoint)
  const localNormal = localNormalPoint.sub(localPoint).normalize()
  return createRunSurfaceFrame(
    [localPoint.x, localPoint.y, localPoint.z],
    [localNormal.x, localNormal.y, localNormal.z],
  )
}

function surfacePointFromEvent(event: RunPointerEvent): {
  point: RunPoint
  frame: RunSurfaceFrame
  isHorizontal: boolean
} {
  if ('node' in event) {
    const frame = nodeSurfaceFrame(event)
    return {
      point: [...frame.origin],
      frame,
      isHorizontal: Math.abs(frame.normal[1]) > 0.98,
    }
  }
  const source = event.surfaceLocalPosition ?? event.localPosition
  const point: RunPoint = [source[0], source[1], source[2]]
  const frame = createRunSurfaceFrame(point, event.surfaceNormal ?? UP)
  return {
    point,
    frame,
    isHorizontal: event.surfaceNormal == null || Math.abs(frame.normal[1]) > 0.98,
  }
}

function pointerCoordinates(event: RunPointerEvent): [number, number] | null {
  const native = event.nativeEvent as { clientX?: unknown; clientY?: unknown } | undefined
  return typeof native?.clientX === 'number' && typeof native.clientY === 'number'
    ? [native.clientX, native.clientY]
    : null
}

function isSameSurfacePointerEvent(
  event: RunPointerEvent,
  stamp: SurfacePointerStamp | null,
): boolean {
  if (!stamp) return false
  if (stamp.nativeEvent === event.nativeEvent) return true
  const coordinates = pointerCoordinates(event)
  return (
    coordinates !== null &&
    coordinates[0] === stamp.x &&
    coordinates[1] === stamp.y &&
    Date.now() - stamp.at < 50
  )
}

export function resolveRunCommitFromEvent<T>(
  event: FloorPlacementClickTriggerEvent,
  latestResolved: T | null,
  resolveGridEvent: (event: GridEvent) => T,
): T | null {
  // A node click can arrive before the first node:move (for example when the
  // pointer enters and clicks in one gesture). Resolve it from the surface
  // event instead of dropping the start point. Once movement has established a
  // cursor snapshot, keep using that snapshot so a wall click cannot jump to
  // the clicked mesh's unrelated local frame.
  return 'node' in event
    ? (latestResolved ?? resolveGridEvent(event as GridEvent))
    : resolveGridEvent(event)
}

export function useDistributionRunTool(config: DistributionRunToolConfig) {
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
  const startSurfaceRef = useRef<RunSurfaceFrame | null>(null)
  const lastSurfacePointerRef = useRef<SurfacePointerStamp | null>(null)
  const lastClientYRef = useRef<number | null>(null)
  const lastResolvedRef = useRef<ResolvedRunPoint | null>(null)
  const lengthInputRef = useRef('')

  const updateLengthInput = useCallback((value: string) => {
    const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '')
    const firstDot = normalized.indexOf('.')
    const cleaned =
      firstDot < 0
        ? normalized
        : `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`
    lengthInputRef.current = cleaned.slice(0, 12)
    setLengthInput(lengthInputRef.current)
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
        directionMode: 'free',
      }
    }

    const resolvePoint = (event: FloorPlacementClickTriggerEvent): ResolvedRunPoint => {
      const adapter = configRef.current
      const hit = surfacePointFromEvent(event)
      const currentStart = startRef.current
      const surface = startSurfaceRef.current ?? hit.frame
      const rawEventPoint = currentStart ? projectRunPointToSurface(hit.point, surface) : hit.point
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const bypassConnections = event.nativeEvent?.altKey === true
      const altJointPick = !currentStart && bypassConnections
      const snappedResult = (point: RunPoint, connection: RunConnection): ResolvedRunPoint => {
        clearDrawAlignment()
        return { point, snapped: point, directionMode: 'snap', ...connection }
      }

      if (!currentStart) {
        const raw: RunPoint = [
          rawEventPoint[0],
          hit.isHorizontal
            ? (adapter.resolveFirstY?.(rawEventPoint[0], rawEventPoint[2]) ?? rawEventPoint[1])
            : rawEventPoint[1],
          rawEventPoint[2],
        ]
        if ((!bypassConnections && snapEnabled) || altJointPick) {
          const port = adapter.findPort(raw)
          if (port) {
            const point: RunPoint = [...port.position]
            return snappedResult(point, { port, body: null })
          }
          const probe = snapRunPointToSurface(raw, surface, gridStep)
          const body = adapter.findBody(probe)
          if (body) return snappedResult(body.point, { port: null, body })
        }
        const point = snapRunPointToSurface(raw, surface, gridStep)
        const aligned = hit.isHorizontal
          ? alignDrawPoint(point, {
              applySnap: isMagneticSnapActive(),
              bypass: bypassConnections,
            })
          : point
        return {
          point: aligned,
          snapped: null,
          port: null,
          body: null,
          directionMode: 'free',
        }
      }

      const raw: RunPoint = projectRunPointToSurface(rawEventPoint, surface)
      const angleLocked = isAngleSnapActive()
      const sourceDirection = startConnectionRef.current.port?.direction ?? null
      const localRay = 'localRay' in event ? event.localRay : undefined
      const cameraProjection =
        hit.isHorizontal && sourceDirection && localRay
          ? projectRunToCameraDirection(
              currentStart,
              localRay,
              sourceDirection,
              Math.max(0.05, gridStep),
              gridStep,
            )
          : null
      const angled = cameraProjection
        ? cameraProjection.point
        : !hit.isHorizontal
          ? projectRunToSurfaceAxisLock(currentStart, raw, surface)
          : angleLocked
            ? projectRunToSurfaceAngleLock(currentStart, raw, surface, sourceDirection)
            : raw
      if (!bypassConnections && snapEnabled) {
        const candidatePort = adapter.findPort(raw)
        const sourcePort = startConnectionRef.current.port
        const port =
          candidatePort &&
          (!sourcePort ||
            candidatePort.nodeId !== sourcePort.nodeId ||
            candidatePort.id !== sourcePort.id)
            ? candidatePort
            : null
        if (port) {
          const point: RunPoint = [...port.position]
          return snappedResult(point, { port, body: null })
        }
        const probe = snapRunPointToSurface(raw, surface, gridStep)
        const body = adapter.findBody(probe)
        if (body) return snappedResult(body.point, { port: null, body })
      }

      let point: RunPoint
      if (cameraProjection) {
        point = cameraProjection.point
      } else if (!angleLocked) {
        point = snapRunPointToSurface(angled, surface, gridStep)
      } else {
        point = snapRunPointToSurface(angled, surface, gridStep)
      }
      const connection = { port: null, body: null }
      if (
        hit.isHorizontal &&
        (!cameraProjection || Math.abs(cameraProjection.direction[1]) < 1e-6)
      ) {
        point = adapter.resolveFreeEnd?.(currentStart, point, startConnectionRef.current) ?? point
      }
      if (hit.isHorizontal) point[1] = Math.max(adapter.minimumFreeY?.() ?? ALT_Y_MIN_M, point[1])
      const aligned = hit.isHorizontal
        ? alignDrawPoint(point, {
            applySnap: isMagneticSnapActive() && !angleLocked,
            bypass: bypassConnections,
          })
        : point
      return {
        point: aligned,
        snapped: null,
        directionMode: cameraProjection || angleLocked ? 'angle' : 'free',
        ...connection,
      }
    }

    const resolveVerticalPoint = (clientY: number): RunPoint | null => {
      const anchor = altAnchorRef.current
      const currentStart = startRef.current
      if (!anchor || !currentStart) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const delta = snapRunValue((anchor.clientY - clientY) / ALT_PIXELS_PER_METER, step)
      const minimumY = configRef.current.minimumFreeY?.() ?? ALT_Y_MIN_M
      const y = Math.min(ALT_Y_MAX_M, Math.max(minimumY, anchor.baseY + delta))
      return [currentStart[0], y, currentStart[2]]
    }

    const updateCursor = (resolved: ResolvedRunPoint) => {
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
      configRef.current.onCursorPoint?.(resolved.point)
    }

    const commit = (end: RunPoint, connection: RunConnection) => {
      const currentStart = startRef.current
      if (!currentStart) return
      const minimumLength = configRef.current.minimumSegmentLength ?? 0.05
      const length = Math.hypot(
        end[0] - currentStart[0],
        end[1] - currentStart[1],
        end[2] - currentStart[2],
      )
      if (length < minimumLength) {
        return
      }
      const result = configRef.current.commit({
        start: currentStart,
        end,
        startConnection: startConnectionRef.current,
        endConnection: connection,
      })
      if (!result) {
        setValidationMessage('Fitting clearance is too small for this connection')
        return
      }
      triggerSFX('sfx:item-place')
      setStart(result.nextStart)
      setSnapTarget(null)
      setEndConnection({ port: null, body: null })
      lengthInputRef.current = ''
      setLengthInput('')
      setValidationMessage(null)
      startConnectionRef.current = result.nextConnection
      altAnchorRef.current = null
      setAltActive(false)
    }

    const onMove = (event: RunPointerEvent) => {
      if (!('node' in event) && isSameSurfacePointerEvent(event, lastSurfacePointerRef.current)) {
        return
      }
      if ('node' in event) {
        const coordinates = pointerCoordinates(event)
        if (coordinates) {
          lastSurfacePointerRef.current = {
            nativeEvent: event.nativeEvent,
            x: coordinates[0],
            y: coordinates[1],
            at: Date.now(),
          }
        }
      }
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

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      if (!('node' in event) && isSameSurfacePointerEvent(event, lastSurfacePointerRef.current)) {
        return
      }
      if ('node' in event) {
        const coordinates = pointerCoordinates(event)
        if (coordinates) {
          lastSurfacePointerRef.current = {
            nativeEvent: event.nativeEvent,
            x: coordinates[0],
            y: coordinates[1],
            at: Date.now(),
          }
        }
      }
      stopPlacementCommitPropagation(event)
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
      // A NodeEvent's localPosition is local to the clicked mesh, not the
      // selected building. Commit node-surface clicks at the latest resolved
      // drafting cursor — the same building-local point shown in the preview.
      const altJointClick = !currentStart && event.nativeEvent?.altKey === true
      const resolved =
        altJointClick || !('node' in event)
          ? resolvePoint(event)
          : resolveRunCommitFromEvent(event, lastResolvedRef.current, resolvePoint)
      if (!resolved) return
      if (!currentStart) {
        triggerSFX('sfx:grid-snap')
        const connection = {
          port: resolved.port,
          body: resolved.port ? null : resolved.body,
        }
        startConnectionRef.current = connection
        configRef.current.inheritFromConnection?.(connection)
        startSurfaceRef.current = surfacePointFromEvent(event).frame
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
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !isLengthField) return
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
      setStart(null)
      setCursor(null)
      setSnapTarget(null)
      setEndConnection({ port: null, body: null })
      lengthInputRef.current = ''
      setLengthInput('')
      setValidationMessage(null)
      startConnectionRef.current = { port: null, body: null }
      startSurfaceRef.current = null
      lastSurfacePointerRef.current = null
      lastResolvedRef.current = null
      altAnchorRef.current = null
      setAltActive(false)
      configRef.current.onClear?.()
    }

    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    emitter.on('grid:move', onMove)
    emitter.on('node:move', onMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      unsubscribeClicks()
      emitter.off('grid:move', onMove)
      emitter.off('node:move', onMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      altAnchorRef.current = null
      startSurfaceRef.current = null
      lastSurfacePointerRef.current = null
      clearDrawAlignment()
    }
  }, [config.active, updateLengthInput])

  return {
    start,
    cursor,
    snapTarget,
    altActive,
    directionMode,
    lengthInput,
    validationMessage,
    onLengthInputChange: updateLengthInput,
    startConnection: startConnectionRef.current,
    endConnection,
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
  cursorRef,
  directionMode,
  startDirection,
  lengthInput,
  validationMessage,
  onLengthInputChange,
}: {
  cursor: RunPoint | null
  start: RunPoint | null
  snapTarget: RunPoint | null
  altActive: boolean
  unit: 'metric' | 'imperial'
  extraParts?: DimensionPillPart[]
  status?: ReactNode
  cursorRef?: RefObject<Group | null>
  directionMode: RunDirectionMode
  startDirection?: readonly [number, number, number] | null
  lengthInput?: string
  validationMessage?: string | null
  minimumSegmentLength?: number
  onLengthInputChange?: (value: string) => void
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
