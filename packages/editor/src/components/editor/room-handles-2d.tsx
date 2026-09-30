'use client'

import { type FloorplanGeometry, type Point, roomDrawnFloor, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Minus, Plus } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useMemo, useState } from 'react'
import { useSelectedRoom } from '../../hooks/use-selected-room'
import { formatLinearMeasurement, MEASUREMENT_FLOORPLAN_COLOR } from '../../lib/measurements'
import {
  commitRoomFloorElevation,
  roomRelativeFloorHeight,
  stepRoomFloorElevation,
} from '../../lib/room-construction-commands'
import {
  type MezzanineEdgeHandle,
  mezzanineEdgeHandles,
  type RoomHandleDrag,
  roomPushHandles,
  runFloorplanMezzanineEdge,
  runFloorplanRoomPush,
  useRoomHandleDrag,
  type WallPushHandle,
} from '../../lib/room-handle-drag'
import type { RoomDimension } from '../../lib/room-push-dimensions'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanRender } from '../editor-2d/floorplan-render-context'
import { FloorplanGeometryRenderer } from '../editor-2d/renderers/floorplan-geometry-renderer'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { ActionMenuButton } from './action-menu-button'
import { formatMeasurement } from './measurement-pill'

/**
 * The selected room while its controls may show: structure select, nothing
 * in progress, no element drilled into, the scene editable.
 */
export function useRoomControls() {
  const room = useSelectedRoom()
  const enabled = useEditor((s) => s.phase === 'structure' && s.mode === 'select')
  const idle = useInteractionScope((s) => s.scope.kind === 'idle')
  const readOnly = useScene((s) => s.readOnly)
  const sole = useViewer((s) => s.selection.selectedIds.length === 0)
  return enabled && idle && sole && !readOnly ? room : null
}

/** A room floor's step on the plan's Floor height stepper, m. */
export const FLOOR_HEIGHT_STEP = 0.05

function signed(text: string, value: number) {
  return `${value > 0.0005 ? '+' : value < -0.0005 ? '−' : ''}${text}`
}

/**
 * The plan has no vertical drag: the room pill carries the floor's height
 * above the floor it is measured from, in 5 cm steps, shown even at 0 — the
 * 3D elevation handle's clamp and commit, one undo step a click.
 */
export function RoomFloorHeightStepper({ zoneId }: { zoneId: string }) {
  const nodes = useScene((s) => s.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  // A drawn-slab floor's height is the slab's: the room has no height to step.
  if (roomDrawnFloor(nodes, zoneId)) return null
  const height = roomRelativeFloorHeight(nodes, zoneId)
  const down = stepRoomFloorElevation(nodes, zoneId, -FLOOR_HEIGHT_STEP)
  const up = stepRoomFloorElevation(nodes, zoneId, FLOOR_HEIGHT_STEP)
  const step = (next: number | null) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    if (next !== null)
      commitRoomFloorElevation(zoneId, next, (meters) =>
        formatLinearMeasurement(meters, unit, metricNotation),
      )
  }
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 py-1 pr-1 pl-3 shadow-xl backdrop-blur-md"
      data-room-floor-height
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <span className="mr-1 text-muted-foreground text-xs">Floor height</span>
      <ActionMenuButton
        disabled={down === null}
        disabledReason="The floor can't go lower here"
        label="Lower the floor"
        onClick={step(down)}
      >
        <Minus className="h-4 w-4" />
      </ActionMenuButton>
      <span
        className="min-w-14 text-center font-medium text-foreground text-xs tabular-nums"
        data-room-floor-height-value
      >
        {signed(formatMeasurement(Math.abs(height), unit, metricNotation), height)}
      </span>
      <ActionMenuButton
        disabled={up === null}
        disabledReason="The floor can't go higher here"
        label="Raise the floor"
        onClick={step(up)}
      >
        <Plus className="h-4 w-4" />
      </ActionMenuButton>
    </div>
  )
}

// The plan's push arrow: the wall arrows' shape and indigo, in plan metres.
const SHAFT = 0.1
const HEAD = 0.12
const SHAFT_HALF = 0.04
const HEAD_HALF = 0.1
const INSET = 0.03
const ARROW_PATH = `M ${INSET},${-SHAFT_HALF} L ${INSET + SHAFT},${-SHAFT_HALF} L ${INSET + SHAFT},${-HEAD_HALF} L ${INSET + SHAFT + HEAD},0 L ${INSET + SHAFT},${HEAD_HALF} L ${INSET + SHAFT},${SHAFT_HALF} L ${INSET},${SHAFT_HALF} Z`
const ARROW_FILL = '#8381ed'
const ARROW_HOVER_FILL = '#a5b4fc'

function PlanArrow({
  position,
  outward,
  kind,
  onPointerDown,
}: {
  position: Point
  outward: Point
  kind: 'room-push' | 'mezzanine-edge'
  onPointerDown: (event: ReactPointerEvent<SVGPathElement>) => void
}) {
  const [hover, setHover] = useState(false)
  const angle = (Math.atan2(outward[1], outward[0]) * 180) / Math.PI
  return (
    <g
      data-room-arrow={kind}
      onClick={(event) => event.stopPropagation()}
      transform={`translate(${position[0]} ${position[1]}) rotate(${angle})`}
    >
      <path d={ARROW_PATH} fill={hover ? ARROW_HOVER_FILL : ARROW_FILL} pointerEvents="none" />
      <path
        d={ARROW_PATH}
        fill="transparent"
        onPointerDown={onPointerDown}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        pointerEvents="fill"
        style={{ cursor: 'grab' }}
      />
    </g>
  )
}

function startArrow(event: ReactPointerEvent<SVGPathElement>, run: () => unknown) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  suppressBoxSelectForPointer(event)
  run()
}

/**
 * The selected room's arrows on the plan: one push/pull chevron per boundary
 * span (on the far face, along the normal the handle supplies) and, for a
 * mezzanine, one per plate edge. Mounted after every node's handles so a
 * wall outline never takes the press. The drags are the 3D arrows' own.
 */
export function RoomHandles2D({ levelId }: { levelId: string | null }) {
  const room = useRoomControls()
  const nodes = useScene((s) => s.nodes)
  const onLevel = !!room && room.key.levelId === levelId
  const handles = useMemo(
    () => (onLevel && room ? roomPushHandles(nodes, room.spans) : []),
    [nodes, onLevel, room],
  )
  const edges = useMemo(
    () => (onLevel && room?.mezzanine ? mezzanineEdgeHandles(nodes, room.zoneId) : []),
    [nodes, onLevel, room],
  )
  if (!(onLevel && room)) return null
  const push = (handle: WallPushHandle) => (event: ReactPointerEvent<SVGPathElement>) =>
    startArrow(event, () =>
      runFloorplanRoomPush({
        handle,
        levelId: room.key.levelId,
        zoneId: room.zoneId,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    )
  const edge = (handle: MezzanineEdgeHandle) => (event: ReactPointerEvent<SVGPathElement>) =>
    startArrow(event, () =>
      runFloorplanMezzanineEdge({
        handle,
        levelId: room.key.levelId,
        zoneId: room.zoneId,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    )
  return (
    <g data-room-handles-2d>
      {handles.map((handle) => (
        <PlanArrow
          key={handle.key}
          kind="room-push"
          onPointerDown={push(handle)}
          outward={handle.outward}
          position={handle.position}
        />
      ))}
      {edges.map((handle) => (
        <PlanArrow
          key={handle.key}
          kind="mezzanine-edge"
          onPointerDown={edge(handle)}
          outward={handle.outward}
          position={handle.position}
        />
      ))}
    </g>
  )
}

const READOUT_HEIGHT_PX = 24
const READOUT_CHAR_PX = 6.6
const READOUT_PAD_PX = 12

/** A drag's readout pill on the plan, upright and screen-sized, at `at`. */
function PlanReadout({ at, text, refused }: { at: Point; text: string; refused: boolean }) {
  const context = useFloorplanRender()
  const upp = context?.unitsPerPixel ?? 0.01
  const width = text.length * READOUT_CHAR_PX + READOUT_PAD_PX * 2
  return (
    <g
      data-room-drag-readout
      pointerEvents="none"
      transform={`translate(${at[0]} ${at[1]}) rotate(${-(context?.sceneRotationDeg ?? 0)}) scale(${upp})`}
    >
      <rect
        height={READOUT_HEIGHT_PX}
        rx={READOUT_HEIGHT_PX / 2}
        style={{ fill: 'var(--background)', fillOpacity: 0.92, stroke: 'var(--border)' }}
        width={width}
        x={-width / 2}
        y={-READOUT_HEIGHT_PX - 14}
      />
      <text
        dominantBaseline="central"
        fontSize={12}
        style={{ fill: refused ? '#ef4444' : 'var(--foreground)' }}
        fontWeight={500}
        textAnchor="middle"
        y={-READOUT_HEIGHT_PX / 2 - 14}
      >
        {text}
      </text>
    </g>
  )
}

/**
 * A push's live room widths on the plan, drawn as the measurement tool draws a
 * distance: indigo line, end dots, outlined label along the line.
 */
function PlanRoomDimensions({ dimensions }: { dimensions: RoomDimension[] }) {
  const context = useFloorplanRender()
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const geometry = useMemo<FloorplanGeometry>(
    () => ({
      kind: 'group',
      children: dimensions.flatMap(({ from, to, distance }): FloorplanGeometry[] => [
        {
          kind: 'line',
          x1: from[0],
          y1: from[1],
          x2: to[0],
          y2: to[1],
          stroke: MEASUREMENT_FLOORPLAN_COLOR,
          strokeWidth: 2,
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        },
        ...[from, to].map(
          ([cx, cy]): FloorplanGeometry => ({
            kind: 'circle',
            cx,
            cy,
            r: 0.045,
            fill: MEASUREMENT_FLOORPLAN_COLOR,
          }),
        ),
        {
          kind: 'dimension-label',
          appearance: 'outlined',
          cx: (from[0] + to[0]) / 2,
          cy: (from[1] + to[1]) / 2,
          text: formatLinearMeasurement(distance, unit, metricNotation),
          angle: Math.atan2(to[1] - from[1], to[0] - from[0]),
          offsetPx: 14,
        },
      ]),
    }),
    [dimensions, unit, metricNotation],
  )
  if (!dimensions.length) return null
  return (
    <g data-room-dimensions-2d>
      <FloorplanGeometryRenderer
        geometry={geometry}
        pointerEventsOverride="none"
        sceneRotationDeg={context?.sceneRotationDeg ?? 0}
        screenUnitsPerPixel={context?.unitsPerPixel}
      />
    </g>
  )
}

type PlanDrag = Extract<RoomHandleDrag, { kind: 'push' | 'mezzanine-edge' }>

/**
 * The room drag in flight on the plan: the signed distance or the refusal at
 * the arrow's new spot, and a mezzanine's outline as the push would leave it —
 * the plan twin of `RoomHandleDragPreview3D` (the pushed walls and floors
 * themselves draw from the live overrides and the wall ghosts).
 */
export function RoomHandleDragPreview2D({ levelId }: { levelId: string | null }) {
  const drag = useRoomHandleDrag((s) => s.drag)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  if (!drag || drag.levelId !== levelId || drag.kind === 'elevation') return null
  const plan = drag as PlanDrag
  const at: Point = [
    plan.anchor[0] + plan.outward[0] * plan.distance,
    plan.anchor[1] + plan.outward[1] * plan.distance,
  ]
  const text =
    plan.message ??
    signed(formatMeasurement(Math.abs(plan.distance), unit, metricNotation), plan.distance)
  return (
    <g data-room-drag-preview-2d pointerEvents="none">
      {plan.kind === 'mezzanine-edge' && plan.outline.length >= 3 && (
        <polygon
          fill={plan.message ? '#ef4444' : ARROW_FILL}
          fillOpacity={0.2}
          points={plan.outline.map(([x, z]) => `${x},${z}`).join(' ')}
          stroke={plan.message ? '#ef4444' : ARROW_FILL}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <PlanRoomDimensions dimensions={plan.dimensions} />
      <PlanReadout at={at} refused={!!plan.message} text={text} />
    </g>
  )
}
