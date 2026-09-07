'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import { OrthographicCamera, Quaternion, Vector3 } from 'three'
import type { RunPoint } from './distribution-run-tool'

export type RunDirectionMode = 'free' | 'angle' | 'snap' | 'vertical'

export type RunDirectionCandidate = {
  direction: RunPoint
  active: boolean
}

type RunVector = readonly [number, number, number]

const WORLD_DIRECTIONS: RunPoint[] = Array.from({ length: 8 }, (_, index) => {
  const angle = (index * Math.PI) / 4
  return [Math.cos(angle), 0, Math.sin(angle)]
})

function horizontalDirection(direction: RunVector): RunPoint | null {
  const length = Math.hypot(direction[0], direction[2])
  return length < 1e-6 ? null : [direction[0] / length, 0, direction[2] / length]
}

function normalizedDirection(direction: RunVector): RunPoint | null {
  const length = Math.hypot(direction[0], direction[1], direction[2])
  if (length < 1e-6) return null
  const normalized = direction.map((component) => component / length) as RunPoint
  return normalized.map((component) => (Math.abs(component) < 1e-12 ? 0 : component)) as RunPoint
}

function cross(a: RunVector, b: RunVector): RunPoint {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function run3DDirectionCandidates(sourceDirection: RunVector): RunPoint[] {
  const source = normalizedDirection(sourceDirection)
  if (!source) return []
  const reference: RunPoint = Math.abs(source[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]
  const lateral = normalizedDirection(cross(source, reference))
  if (!lateral) return [source]
  const upright = normalizedDirection(cross(lateral, source))
  if (!upright) return [source]

  const candidates: RunPoint[] = [source]
  for (const perpendicular of [upright, lateral]) {
    for (const sign of [1, -1] as const) {
      const turn: RunPoint = [
        perpendicular[0] * sign,
        perpendicular[1] * sign,
        perpendicular[2] * sign,
      ].map((component) => (Math.abs(component) < 1e-12 ? 0 : component)) as RunPoint
      candidates.push(turn)
      const diagonal = normalizedDirection([
        source[0] + turn[0],
        source[1] + turn[1],
        source[2] + turn[2],
      ])
      if (diagonal) candidates.push(diagonal)
    }
  }
  return candidates
}

export function runHorizontalDirectionCandidates(sourceDirection: RunVector | null): RunPoint[] {
  if (!sourceDirection) return WORLD_DIRECTIONS
  const source = horizontalDirection(sourceDirection)
  if (!source) return WORLD_DIRECTIONS
  const angle = Math.atan2(source[2], source[0])
  return [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2].map((offset) => [
    Math.cos(angle + offset),
    0,
    Math.sin(angle + offset),
  ])
}

export function resolveRunDirectionCandidates(
  start: RunPoint,
  cursor: RunPoint,
  sourceDirection: RunVector | null,
  mode: RunDirectionMode,
): RunDirectionCandidate[] {
  const delta: RunPoint = [cursor[0] - start[0], cursor[1] - start[1], cursor[2] - start[2]]
  if (mode === 'vertical') {
    const activeSign = delta[1] < 0 ? -1 : 1
    return ([1, -1] as const).map((sign) => ({
      direction: [0, sign, 0],
      active: sign === activeSign,
    }))
  }

  const directions = sourceDirection
    ? run3DDirectionCandidates(sourceDirection)
    : runHorizontalDirectionCandidates(null)
  let activeIndex = -1
  const pointerDirection = normalizedDirection(delta)
  if (pointerDirection && mode === 'angle') {
    let bestDot = Number.NEGATIVE_INFINITY
    for (let index = 0; index < directions.length; index++) {
      const direction = directions[index]!
      const dot =
        direction[0] * pointerDirection[0] +
        direction[1] * pointerDirection[1] +
        direction[2] * pointerDirection[2]
      if (dot > bestDot) {
        bestDot = dot
        activeIndex = index
      }
    }
  }
  return directions.map((direction, index) => ({ direction, active: index === activeIndex }))
}

export function RunDirectionFeedback({
  start,
  cursor,
  sourceDirection,
  mode,
  snapped,
  onDirectionSelect,
}: {
  start: RunPoint
  cursor: RunPoint
  sourceDirection: RunVector | null
  mode: RunDirectionMode
  snapped: boolean
  onDirectionSelect?: (direction: RunPoint) => void
}) {
  const candidates = useMemo(
    () => resolveRunDirectionCandidates(start, cursor, sourceDirection, mode),
    [cursor, mode, sourceDirection, start],
  )
  const distance = Math.hypot(cursor[0] - start[0], cursor[1] - start[1], cursor[2] - start[2])
  const candidateLength = Math.min(1.8, Math.max(0.7, distance * 0.7))
  const activeColor = snapped ? '#22c55e' : '#818cf8'

  return (
    <group>
      {candidates.map((candidate, index) => (
        <DirectionRay
          active={candidate.active}
          color={candidate.active ? activeColor : '#818cf8'}
          direction={candidate.direction}
          key={`${index}:${candidate.direction.join(':')}`}
          length={candidate.active ? Math.max(distance, candidateLength) : candidateLength}
          origin={start}
          onDirectionSelect={onDirectionSelect}
        />
      ))}
      {distance > 0.01 && mode !== 'angle' && mode !== 'vertical' && (
        <DirectionRay
          active
          color={activeColor}
          direction={[
            (cursor[0] - start[0]) / distance,
            (cursor[1] - start[1]) / distance,
            (cursor[2] - start[2]) / distance,
          ]}
          length={distance}
          origin={start}
          onDirectionSelect={onDirectionSelect}
        />
      )}
    </group>
  )
}

function DirectionRay({
  origin,
  direction,
  length,
  active,
  color,
  onDirectionSelect,
}: {
  origin: RunPoint
  direction: RunPoint
  length: number
  active: boolean
  color: string
  onDirectionSelect?: (direction: RunPoint) => void
}) {
  const { camera } = useThree()
  const zoomScale = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const placement = useMemo(() => {
    const axis = new Vector3(direction[0], direction[1], direction[2]).normalize()
    const start = new Vector3(origin[0], origin[1] + 0.015, origin[2])
    const end = start.clone().addScaledVector(axis, length)
    return {
      midpoint: start.clone().add(end).multiplyScalar(0.5).toArray() as RunPoint,
      tip: end.toArray() as RunPoint,
      rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis),
    }
  }, [direction, length, origin])
  const radius = (active ? 0.012 : 0.006) * zoomScale
  const arrowLength = (active ? 0.1 : 0.07) * zoomScale
  const arrowRadius = (active ? 0.04 : 0.025) * zoomScale
  const opacity = active ? 0.9 : 0.18

  return (
    <group>
      <mesh
        layers={EDITOR_LAYER}
        position={placement.midpoint}
        quaternion={placement.rotation}
        renderOrder={active ? 4 : 2}
        onPointerDown={(event) => {
          if (!onDirectionSelect) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          onDirectionSelect([...direction])
        }}
      >
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={opacity}
          transparent
        />
      </mesh>
      <mesh
        layers={EDITOR_LAYER}
        position={placement.tip}
        quaternion={placement.rotation}
        renderOrder={active ? 4 : 2}
        onPointerDown={(event) => {
          if (!onDirectionSelect) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          onDirectionSelect([...direction])
        }}
      >
        <coneGeometry args={[arrowRadius, arrowLength, 10]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          depthWrite={false}
          opacity={opacity}
          transparent
        />
      </mesh>
    </group>
  )
}
