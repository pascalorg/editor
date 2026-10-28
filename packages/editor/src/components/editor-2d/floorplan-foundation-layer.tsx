'use client'

import {
  type AnyNode,
  calculateLevelMiters,
  type FloorplanGeometry,
  type FoundationPlanShape,
  foundationPlan,
  foundationViewOf,
  getWallPlanFootprint,
  traceFoundationOutlines,
  union,
  usePascalI18n,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useMemo } from 'react'
import {
  foundationDimensionStrings,
  foundationOutlineRings,
} from '../../lib/floorplan/foundation-dimensions'
import { editFoundationOutline, houseFoundationOutlines } from '../../lib/foundation-view'
import { formatLinearMeasurement } from '../../lib/measurements'
import useEditor from '../../store/use-editor'
import {
  useFloorplanSceneRotation,
  useFloorplanStaticUnitsPerPixel,
} from './floorplan-render-context'
import { FloorplanDimensionStringRenderer } from './renderers/floorplan-dimension-renderer'

type P = [number, number]

/** Concrete in plan: grey that reads on the light and the dark plan alike. */
const CONCRETE = { fill: '#9ca3af', stroke: '#6b7280' } as const
/** The walls over the foundation, a faint ghost: dashes are the foundation's hidden lines alone. */
const WALLS_OVER = '#64748b'
/** Concrete under other concrete (a slab's turned-down edge, a footing under its stem, a pile) is dashed. */
const HIDDEN_DASH = '6 4'
/** The dimension rows stand this far out of the foundation and apart, on screen, pixels. */
const DIMENSION_ROW_PX = 30
/** An extension line runs this far past its dimension line, pixels. */
const DIMENSION_OVERSHOOT_PX = 6
/** The dimensions' text and ticks at this many pixels a point: about 12 px text. */
const DIMENSION_PX_PER_PT = 1.5

const FILL_OPACITY: Record<FoundationPlanShape['kind'], number> = {
  slab: 0.12,
  turndown: 0,
  footing: 0,
  'grade-beam': 0.35,
  stem: 0.45,
  // Over its stem: the plan draws the stem it stands on.
  cripple: 0,
  pile: 0,
}

export type FoundationPlanDrawing = {
  shapes: FoundationPlanShape[]
  /** The walls the foundation carries, merged: rings drawn as one shape. */
  walls: P[][]
}

/** The walls of `levelId` as one merged footprint: no seams where they meet at the corners. */
function wallsFootprint(nodes: Record<string, AnyNode>, levelId: string | null): P[][] {
  if (!levelId) return []
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.visible !== false,
  )
  if (walls.length === 0) return []
  const miters = calculateLevelMiters(walls)
  const footprints = walls
    .map((wall) => getWallPlanFootprint(wall, miters).map(({ x, y }) => [x, y] as P))
    .filter((ring) => ring.length >= 3)
  return union(footprints).flatMap((polygon) => [polygon.outer, ...polygon.holes])
}

/** What the foundation view draws for `buildingId`: its foundation plan, and the walls it carries. */
export function foundationPlanDrawing(
  nodes: Record<string, AnyNode>,
  buildingId: string,
): FoundationPlanDrawing {
  const graph = nodes as Parameters<typeof foundationPlan>[0]
  return {
    shapes: foundationPlan(graph, buildingId),
    walls: wallsFootprint(nodes, foundationViewOf(graph, buildingId).wallLevelId),
  }
}

/** Closed rings as one SVG path. */
function pathOf(rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): string {
  return rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M ${ring.map(([x, z]) => `${x} ${z}`).join(' L ')} Z`)
    .join(' ')
}

function Shape({ shape }: { shape: FoundationPlanShape }) {
  const common = {
    'data-foundation-hidden': shape.hidden ? '' : undefined,
    'data-foundation-member': shape.kind,
    fill: shape.filled ? CONCRETE.fill : 'none',
    fillOpacity: shape.filled ? FILL_OPACITY[shape.kind] : undefined,
    stroke: CONCRETE.stroke,
    strokeDasharray: shape.hidden ? HIDDEN_DASH : undefined,
    strokeWidth: shape.hidden ? 1.1 : 1.2,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  if (shape.kind === 'pile')
    return <circle {...common} cx={shape.center[0]} cy={shape.center[1]} r={shape.radius} />
  return <path {...common} d={pathOf(shape.rings)} fillRule="evenodd" strokeLinejoin="miter" />
}

/**
 * The foundation view's plan (`useViewer.foundationView`): the concrete the engine draws under the
 * building, from above, under the walls it carries ghosted faintly. A slab is outlined, its
 * turned-down edge dashed where it ends inside; a stem wall is drawn solid, its footing dashed.
 * The outlines and footings drawn on the level stay the registry layer's, selectable and editable
 * over it; while the house's outline follows the walls, a click on it makes it one of its own to
 * drag (`editFoundationOutline`). Dimensioned all round (`foundationDimensionStrings`).
 */
export const FloorplanFoundationLayer = memo(function FloorplanFoundationLayer() {
  const i18n = usePascalI18n()
  const on = useViewer((state) => state.foundationView)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const selecting = useEditor((state) => state.mode === 'select')
  const nodes = useScene((state) => state.nodes)
  const drawing = useMemo(
    () =>
      on && buildingId ? foundationPlanDrawing(nodes as Record<string, AnyNode>, buildingId) : null,
    [on, buildingId, nodes],
  )
  const traced = useMemo(() => {
    if (!(on && selecting && buildingId)) return []
    const graph = nodes as Parameters<typeof traceFoundationOutlines>[0]
    return houseFoundationOutlines(graph, buildingId).length === 0
      ? traceFoundationOutlines(graph, buildingId)
      : []
  }, [on, selecting, buildingId, nodes])
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const unitsPerPixel = useFloorplanStaticUnitsPerPixel()
  const rings = useMemo(
    () =>
      on && buildingId ? foundationOutlineRings(nodes as Record<string, AnyNode>, buildingId) : [],
    [on, buildingId, nodes],
  )
  // Sized on screen: the rows, the text and the ticks keep their size in pixels at any zoom.
  const dimensions = useMemo(
    () =>
      foundationDimensionStrings(
        rings,
        (meters) => formatLinearMeasurement(meters, unit, metricNotation),
        {
          rows: [DIMENSION_ROW_PX * unitsPerPixel, 2 * DIMENSION_ROW_PX * unitsPerPixel],
          overshoot: DIMENSION_OVERSHOOT_PX * unitsPerPixel,
        },
      ),
    [rings, unit, metricNotation, unitsPerPixel],
  )
  const sceneRotationDeg = useFloorplanSceneRotation()
  if (!(drawing && buildingId)) return null
  return (
    <>
      <FoundationPlanGroup drawing={drawing} />
      <FoundationDimensionsGroup
        annotationUnitsPerPoint={unitsPerPixel * DIMENSION_PX_PER_PT}
        sceneRotationDeg={sceneRotationDeg}
        strings={dimensions}
      />
      {traced.length > 0 && (
        <path
          d={pathOf(traced)}
          data-foundation-edit-hit=""
          fill="none"
          onClick={(event) => {
            // The plan's background click would clear the selection the edit makes.
            event.stopPropagation()
            editFoundationOutline(buildingId)
          }}
          pointerEvents="stroke"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: 'pointer' }}
          vectorEffect="non-scaling-stroke"
        >
          <title>
            {i18n._({
              id: 'editor.editor2d.floorplanFoundationLayer.clickToEditTheFoundationS',
              message: 'Click to edit the foundation’s outline',
            })}
          </title>
        </path>
      )}
    </>
  )
})

/** The foundation plan's dimension strings, drawn as the plan draws every dimension. */
export function FoundationDimensionsGroup({
  strings,
  sceneRotationDeg = 0,
  annotationUnitsPerPoint,
}: {
  strings: readonly Extract<FloorplanGeometry, { kind: 'dimension-string' }>[]
  sceneRotationDeg?: number
  /** Plan units a point: sizes the text and ticks on screen. */
  annotationUnitsPerPoint?: number
}) {
  if (strings.length === 0) return null
  return (
    <g data-foundation-dimensions="" pointerEvents="none">
      {strings.map((geometry, index) => (
        // Strings have no ids of their own: their order is the sides', round the foundation.
        <FloorplanDimensionStringRenderer
          annotationUnitsPerPoint={annotationUnitsPerPoint}
          geometry={geometry}
          key={index}
          sceneRotationDeg={sceneRotationDeg}
        />
      ))}
    </g>
  )
}

/** The drawing itself, in plan metres: the walls' ghost, then the concrete bottom to top. */
export function FoundationPlanGroup({ drawing }: { drawing: FoundationPlanDrawing }) {
  return (
    <g data-foundation-plan="" pointerEvents="none">
      {drawing.walls.length > 0 && (
        <path
          d={pathOf(drawing.walls)}
          data-foundation-walls=""
          fill={WALLS_OVER}
          fillOpacity={0.1}
          fillRule="evenodd"
          stroke={WALLS_OVER}
          strokeOpacity={0.35}
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {drawing.shapes.map((shape, index) => (
        // Shapes have no ids of their own; their order is the plan's, bottom to top.
        <Shape key={index} shape={shape} />
      ))}
    </g>
  )
}
