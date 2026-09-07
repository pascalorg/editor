'use client'

import { emitter, type GridEvent, type NodeEvent } from '@pascal-app/core'
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
import { Html } from '@react-three/drei'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { alignDrawPoint, clearDrawAlignment } from './draw-alignment'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from './floor-placement'
import type { RunBodyHit, ScenePort } from './ports'
import {
  type RunDirectionMode,
  RunDirectionFeedback,
  run3DDirectionCandidates,
  runHorizontalDirectionCandidates,
} from './run-direction-feedback'

export type RunPoint = [number, number, number]

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

type DistributionRunToolConfig = {
  active: boolean
  initialStart?: RunPoint | null
  initialConnection?: RunConnection | null
  findPort: (point: RunPoint) => ScenePort | null
  findBody: (point: RunPoint) => RunBodyHit | null
  resolveFirstY?: (x: number, z: number) => number
  resolveFreeEnd?: (start: RunPoint, end: RunPoint, startConnection: RunConnection) => RunPoint
  minimumFreeY?: () => number
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

function eventPoint(event: GridEvent | NodeEvent): RunPoint {
  return [event.localPosition[0], event.localPosition[1], event.localPosition[2]]
}

export function resolveRunCommitFromEvent<T>(
  event: FloorPlacementClickTriggerEvent,
  latestResolved: T | null,
  resolveGridEvent: (event: GridEvent) => T,
): T | null {
  return 'node' in event ? latestResolved : resolveGridEvent(event)
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

  const configRef = useRef(config)
  configRef.current = config
  const startRef = useRef(start)
  startRef.current = start
  const startConnectionRef = useRef<RunConnection>(initialConnectionRef.current)
  const altAnchorRef = useRef<{ clientY: number; baseY: number } | null>(null)
  const lastClientYRef = useRef<number | null>(null)
  const lastResolvedRef = useRef<ResolvedRunPoint | null>(null)

  useEffect(() => {
    if (!config.active) return

    const resolvePoint = (event: FloorPlacementClickTriggerEvent): ResolvedRunPoint => {
      const adapter = configRef.current
      const rawEventPoint = eventPoint(event)
      const currentStart = startRef.current
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive() || isAngleSnapActive()
      const gridStep = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const bypassConnections = event.nativeEvent?.altKey === true
      const snappedResult = (point: RunPoint, connection: RunConnection): ResolvedRunPoint => {
        clearDrawAlignment()
        return { point, snapped: point, directionMode: 'snap', ...connection }
      }

      if (!currentStart) {
        const raw: RunPoint = [
          rawEventPoint[0],
          adapter.resolveFirstY?.(rawEventPoint[0], rawEventPoint[2]) ?? 0,
          rawEventPoint[2],
        ]
        if (!bypassConnections && snapEnabled) {
          const port = adapter.findPort(raw)
          if (port) {
            const point: RunPoint = [...port.position]
            return snappedResult(point, { port, body: null })
          }
          const probe: RunPoint = [
            snapRunValue(raw[0], gridStep),
            raw[1],
            snapRunValue(raw[2], gridStep),
          ]
          const body = adapter.findBody(probe)
          if (body) return snappedResult(body.point, { port: null, body })
        }
        const x = snapRunValue(raw[0], gridStep)
        const z = snapRunValue(raw[2], gridStep)
        const point = alignDrawPoint([x, adapter.resolveFirstY?.(x, z) ?? 0, z], {
          applySnap: isMagneticSnapActive(),
          bypass: bypassConnections,
        })
        return {
          point,
          snapped: null,
          port: null,
          body: null,
          directionMode: 'free',
        }
      }

      const raw: RunPoint = [rawEventPoint[0], currentStart[1], rawEventPoint[2]]
      const angleLocked = isAngleSnapActive()
      const sourceDirection = startConnectionRef.current.port?.direction ?? null
      const localRay = 'localRay' in event ? event.localRay : undefined
      const cameraProjection =
        sourceDirection && localRay
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
        : angleLocked
          ? projectRunToAngleLock(currentStart, raw, sourceDirection)
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
        const probe: RunPoint = [
          snapRunValue(raw[0], gridStep),
          raw[1],
          snapRunValue(raw[2], gridStep),
        ]
        const body = adapter.findBody(probe)
        if (body) return snappedResult(body.point, { port: null, body })
      }

      let point: RunPoint
      if (cameraProjection) {
        point = cameraProjection.point
      } else if (!angleLocked) {
        point = [snapRunValue(angled[0], gridStep), angled[1], snapRunValue(angled[2], gridStep)]
      } else {
        const dx = angled[0] - currentStart[0]
        const dz = angled[2] - currentStart[2]
        const length = Math.hypot(dx, dz)
        if (length < 1e-6) point = angled
        else {
          const scale = snapRunValue(length, gridStep) / length
          point = [currentStart[0] + dx * scale, angled[1], currentStart[2] + dz * scale]
        }
      }
      const connection = { port: null, body: null }
      if (!cameraProjection || Math.abs(cameraProjection.direction[1]) < 1e-6) {
        point = adapter.resolveFreeEnd?.(currentStart, point, startConnectionRef.current) ?? point
      }
      point[1] = Math.max(adapter.minimumFreeY?.() ?? ALT_Y_MIN_M, point[1])
      const aligned = alignDrawPoint(point, {
        applySnap: isMagneticSnapActive() && !angleLocked,
        bypass: bypassConnections,
      })
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
      const result = configRef.current.commit({
        start: currentStart,
        end,
        startConnection: startConnectionRef.current,
        endConnection: connection,
      })
      if (!result) return
      triggerSFX('sfx:item-place')
      setStart(result.nextStart)
      setSnapTarget(null)
      setEndConnection({ port: null, body: null })
      startConnectionRef.current = result.nextConnection
      altAnchorRef.current = null
      setAltActive(false)
    }

    const onMove = (event: GridEvent) => {
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
      updateCursor(resolvePoint(event))
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
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
      const resolved = resolveRunCommitFromEvent(event, lastResolvedRef.current, resolvePoint)
      if (!resolved) return
      if (!currentStart) {
        triggerSFX('sfx:grid-snap')
        const connection = {
          port: resolved.port,
          body: resolved.port ? null : resolved.body,
        }
        startConnectionRef.current = connection
        configRef.current.inheritFromConnection?.(connection)
        setStart(resolved.point)
        return
      }
      commit(resolved.point, {
        port: resolved.port,
        body: resolved.port ? null : resolved.body,
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
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
      startConnectionRef.current = { port: null, body: null }
      lastResolvedRef.current = null
      altAnchorRef.current = null
      setAltActive(false)
      configRef.current.onClear?.()
    }

    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    emitter.on('grid:move', onMove)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      unsubscribeClicks()
      emitter.off('grid:move', onMove)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      altAnchorRef.current = null
      clearDrawAlignment()
    }
  }, [config.active])

  return {
    start,
    cursor,
    snapTarget,
    altActive,
    directionMode,
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
}) {
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
            {status}
          </div>
        </Html>
      </group>
    </>
  )
}
