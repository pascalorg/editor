'use client'

import {
  type AnyNode,
  type AnyNodeId,
  StructuralGridNode,
  type StructuralGridNode as StructuralGridNodeType,
} from '@pascal-app/core'
import {
  clearSurfacePlanSnapFeedback,
  type FloorplanToolContext,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  resolveSurfacePlanPointSnap,
  triggerSFX,
  useFloorplanRender,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_GRID_LENGTH = 0.01
const GRID_BUBBLE_RADIUS = 0.22
const GRID_LABEL_SIZE = 0.18
const ANGLE_INCREMENT = Math.PI / 4

type PlanPoint = [number, number]
export type StructuralGridLabelFamily = 'numeric' | 'alphabetic'

export function shouldConsumeStructuralGridPointerEvent(event: {
  type: string
  button: number
  buttons: number
}): boolean {
  if (event.type === 'pointerdown') return event.button === 0
  return (event.buttons & 0b110) === 0
}

function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

export function structuralGridLabelFamily(
  start: PlanPoint,
  end: PlanPoint,
): StructuralGridLabelFamily {
  return Math.abs(end[1] - start[1]) >= Math.abs(end[0] - start[0]) ? 'numeric' : 'alphabetic'
}

export function alphabeticGridLabel(index: number): string {
  let value = Math.max(0, Math.floor(index))
  let label = ''
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

export function nextStructuralGridLabel(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
  start: PlanPoint,
  end: PlanPoint,
): string {
  const family = structuralGridLabelFamily(start, end)
  const used = new Set(
    Object.values(nodes)
      .filter(
        (node): node is StructuralGridNodeType =>
          node.type === 'structural-grid' &&
          node.parentId === levelId &&
          structuralGridLabelFamily(node.start, node.end) === family,
      )
      .map((node) => node.label.toUpperCase()),
  )

  for (let index = 0; ; index += 1) {
    const candidate = family === 'numeric' ? String(index + 1) : alphabeticGridLabel(index)
    if (!used.has(candidate)) return candidate
  }
}

export function snapStructuralGridAngle(start: PlanPoint, point: PlanPoint): PlanPoint {
  const dx = point[0] - start[0]
  const dz = point[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_GRID_LENGTH) return point
  const angle = Math.round(Math.atan2(dz, dx) / ANGLE_INCREMENT) * ANGLE_INCREMENT
  return [start[0] + Math.cos(angle) * length, start[1] + Math.sin(angle) * length]
}

export function FloorplanStructuralGridToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const groupRef = useRef<SVGGElement>(null)
  const startRef = useRef<PlanPoint | null>(null)
  const [start, setStart] = useState<PlanPoint | null>(null)
  const [hover, setHover] = useState<PlanPoint | null>(null)
  const renderContext = useFloorplanRender()

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'structural-grid' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'structural-grid')
  }, [])

  const updateStart = useCallback((point: PlanPoint | null) => {
    startRef.current = point
    setStart(point)
  }, [])

  useEffect(() => {
    updateStart(null)
    setHover(null)
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(activeLevelId && group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolveEvent = (event: MouseEvent | PointerEvent): PlanPoint | null => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const anglePoint =
        startRef.current && !event.altKey && isAngleSnapActive()
          ? snapStructuralGridAngle(startRef.current, raw)
          : raw
      const step = !event.altKey && isGridSnapActive() ? gridSnapStep : 0
      const fallback: PlanPoint = [snap(anglePoint[0], step), snap(anglePoint[1], step)]
      const snapped = resolveSurfacePlanPointSnap({
        rawPoint: anglePoint,
        fallbackPoint: fallback,
        levelId: activeLevelId,
        magnetic: !event.altKey && isMagneticSnapActive(),
        align: isMagneticSnapActive(),
      })
      return snapped.point
    }
    const onPointerDown = (event: PointerEvent) => {
      if (shouldConsumeStructuralGridPointerEvent(event)) consume(event)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (shouldConsumeStructuralGridPointerEvent(event)) consume(event)
      setHover(resolveEvent(event))
    }
    const onPointerLeave = () => {
      clearSurfacePlanSnapFeedback()
      setHover(null)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const point = resolveEvent(event)
      if (!point) return
      const currentStart = startRef.current
      if (!currentStart) {
        updateStart(point)
        triggerSFX('sfx:grid-snap')
        return
      }
      if (Math.hypot(point[0] - currentStart[0], point[1] - currentStart[1]) < MIN_GRID_LENGTH) {
        return
      }

      const label = nextStructuralGridLabel(sceneApi.nodes(), activeLevelId, currentStart, point)
      const node = StructuralGridNode.parse({
        name: `Grid ${label}`,
        start: currentStart,
        end: point,
        label,
      })
      sceneApi.upsert(node, activeLevelId as AnyNodeId)
      selectNode(node.id)
      triggerSFX('sfx:structure-build')
      updateStart(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      if (startRef.current) {
        updateStart(null)
        return
      }
      finishTool()
    }
    const onBlur = () => clearSurfacePlanSnapFeedback()

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerleave', onPointerLeave, true)
    svg.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearSurfacePlanSnapFeedback()
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerleave', onPointerLeave, true)
      svg.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [activeLevelId, finishTool, gridSnapStep, sceneApi, selectNode, updateStart])

  if (!activeLevelId) return null
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const reticleRadius = 9 * unitsPerPixel
  const label =
    start && hover ? nextStructuralGridLabel(sceneApi.nodes(), activeLevelId, start, hover) : null

  const renderBubble = (point: PlanPoint, key: string) => (
    <g key={key} pointerEvents="none">
      <circle
        cx={point[0]}
        cy={point[1]}
        fill="#ffffff"
        r={GRID_BUBBLE_RADIUS}
        stroke="#0ea5e9"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <g
        transform={`translate(${point[0]} ${point[1]}) rotate(${-(renderContext?.sceneRotationDeg ?? 0)})`}
      >
        <text
          dominantBaseline="middle"
          fill="#0369a1"
          fontSize={GRID_LABEL_SIZE}
          fontWeight={700}
          textAnchor="middle"
          x={0}
          y={0}
        >
          {label}
        </text>
      </g>
    </g>
  )

  return (
    <g ref={groupRef}>
      {start && hover && label ? (
        <g pointerEvents="none">
          <line
            stroke="#0ea5e9"
            strokeDasharray="10 4 2 4"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            x1={start[0]}
            x2={hover[0]}
            y1={start[1]}
            y2={hover[1]}
          />
          {renderBubble(start, 'start')}
          {renderBubble(hover, 'end')}
        </g>
      ) : null}
      {hover ? (
        <g pointerEvents="none">
          <circle
            cx={hover[0]}
            cy={hover[1]}
            fill="none"
            r={reticleRadius}
            stroke="#0ea5e9"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            stroke="#0ea5e9"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            x1={hover[0] - reticleRadius * 1.4}
            x2={hover[0] + reticleRadius * 1.4}
            y1={hover[1]}
            y2={hover[1]}
          />
          <line
            stroke="#0ea5e9"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            x1={hover[0]}
            x2={hover[0]}
            y1={hover[1] - reticleRadius * 1.4}
            y2={hover[1] + reticleRadius * 1.4}
          />
        </g>
      ) : null}
    </g>
  )
}

export default FloorplanStructuralGridToolLayer
