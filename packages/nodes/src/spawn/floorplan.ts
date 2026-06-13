import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import type { SpawnNode } from './schema'

const SPAWN_COLOR = '#818cf8'
const SPAWN_MARKER_HIT_RADIUS = 0.52
const FOOTPRINT_ICON_SCALE = 0.045
const FOOTPRINT_ICON_CENTER = 12
const ROTATE_ARROW_CORNER_OFFSET = 0.22

const iconPoint = (x: number, y: number) =>
  `${formatIconCoord(x - FOOTPRINT_ICON_CENTER)} ${formatIconCoord(y - FOOTPRINT_ICON_CENTER)}`
const iconY = (y: number) => formatIconCoord(y - FOOTPRINT_ICON_CENTER)
const iconX = (x: number) => formatIconCoord(x - FOOTPRINT_ICON_CENTER)
const iconArcRadius = formatIconCoord(2)

const FOOTPRINT_LEFT_PATH = [
  `M ${iconPoint(4, 16)}`,
  `V ${iconY(13.62)}`,
  `C ${iconPoint(4, 11.5)} ${iconPoint(2.97, 10.5)} ${iconPoint(3, 8)}`,
  `C ${iconPoint(3.03, 5.28)} ${iconPoint(4.49, 2)} ${iconPoint(7.5, 2)}`,
  `C ${iconPoint(9.37, 2)} ${iconPoint(10, 3.8)} ${iconPoint(10, 5.5)}`,
  `C ${iconPoint(10, 8.61)} ${iconPoint(8, 11.16)} ${iconPoint(8, 14.18)}`,
  `V ${iconY(16)}`,
  `A ${iconArcRadius} ${iconArcRadius} 0 1 1 ${iconPoint(4, 16)}`,
  'Z',
].join(' ')

const FOOTPRINT_RIGHT_PATH = [
  `M ${iconPoint(20, 20)}`,
  `V ${iconY(17.62)}`,
  `C ${iconPoint(20, 15.5)} ${iconPoint(21.03, 14.5)} ${iconPoint(21, 12)}`,
  `C ${iconPoint(20.97, 9.28)} ${iconPoint(19.51, 6)} ${iconPoint(16.5, 6)}`,
  `C ${iconPoint(14.63, 6)} ${iconPoint(14, 7.8)} ${iconPoint(14, 9.5)}`,
  `C ${iconPoint(14, 12.61)} ${iconPoint(16, 15.16)} ${iconPoint(16, 18.18)}`,
  `V ${iconY(20)}`,
  `A ${iconArcRadius} ${iconArcRadius} 0 1 0 ${iconPoint(20, 20)}`,
  'Z',
].join(' ')

/**
 * 2D floor-plan marker for a spawn point. Uses the same footprint icon
 * as the walkthrough-mode control and rotates it toward the spawn's
 * first-person starting view.
 *
 * Color matches the 3D renderer's indigo spawn material so the user
 * sees the same visual identity in both views.
 *
 * Coordinates are level-local meters; rotation is radians.
 */
export function buildSpawnFloorplan(node: SpawnNode, ctx: GeometryContext): FloorplanGeometry {
  const [px, , pz] = node.position
  const ry = node.rotation
  const planRotation = -ry
  const isSelected = ctx.viewState?.selected ?? false

  const children: FloorplanGeometry[] = [
    {
      kind: 'group',
      transform: { translate: [px, pz], rotate: planRotation },
      children: [
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: SPAWN_MARKER_HIT_RADIUS,
          fill: 'transparent',
          pointerEvents: 'all',
        },
        {
          kind: 'path',
          d: FOOTPRINT_LEFT_PATH,
          stroke: SPAWN_COLOR,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        },
        {
          kind: 'path',
          d: FOOTPRINT_RIGHT_PATH,
          stroke: SPAWN_COLOR,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        },
        {
          kind: 'line',
          x1: iconX(16),
          y1: iconY(17),
          x2: iconX(20),
          y2: iconY(17),
          stroke: SPAWN_COLOR,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          strokeLinecap: 'round',
        },
        {
          kind: 'line',
          x1: iconX(4),
          y1: iconY(13),
          x2: iconX(8),
          y2: iconY(13),
          stroke: SPAWN_COLOR,
          strokeWidth: 2,
          vectorEffect: 'non-scaling-stroke',
          strokeLinecap: 'round',
        },
      ],
    },
  ]

  if (isSelected) {
    children.push({
      kind: 'move-handle',
      point: [px, pz],
    })

    const cornerLocalX = 0.34 + ROTATE_ARROW_CORNER_OFFSET
    const cornerLocalZ = 0.34 + ROTATE_ARROW_CORNER_OFFSET
    const [cornerX, cornerZ] = rotatePlanVector(cornerLocalX, cornerLocalZ, planRotation)
    const [radialX, radialZ] = rotatePlanVector(1, 1, planRotation)
    children.push({
      kind: 'rotate-arrow',
      point: [px + cornerX, pz + cornerZ],
      angle: Math.atan2(radialZ, radialX),
      affordance: 'spawn-rotate',
      pivot: [px, pz],
    })
  }

  return {
    kind: 'group',
    children,
  }
}

function rotatePlanVector(x: number, y: number, rotation: number): FloorplanPoint {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  return [x * c - y * s, x * s + y * c]
}

function formatIconCoord(value: number): number {
  const scaled = value * FOOTPRINT_ICON_SCALE
  return Number(scaled.toFixed(4))
}
