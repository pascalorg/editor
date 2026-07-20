import type {
  ConstructionDimensionNode,
  FloorplanGeometry,
  GeometryContext,
  MeasurementPoint,
} from '@pascal-app/core'
import { resolveMeasurementAnchor } from '../measurement/resolve'
import { formatConstructionLength } from '../shared/construction-length'
import { resolveConstructionDimensionLayout } from './geometry'

export function buildConstructionDimensionFloorplan(
  node: ConstructionDimensionNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  if (node.visible === false) return null

  const resolved = node.anchors.map((anchor) =>
    resolveMeasurementAnchor(anchor, (id) => ctx.resolve(id)),
  )
  const layout = resolveConstructionDimensionLayout(
    node,
    resolved.map((anchor) => anchor.point) as MeasurementPoint[],
  )
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = selected
    ? (ctx.viewState?.palette.selectedStroke ?? '#2563eb')
    : (ctx.viewState?.palette.measurementStroke ?? '#334155')
  const editable = ctx.viewState?.selected === true
  const children: FloorplanGeometry[] = []

  for (let index = 0; index < layout.segments.length; index += 1) {
    const segment = layout.segments[index]!
    const dangling = Boolean(resolved[index]?.dangling || resolved[index + 1]?.dangling)
    children.push(
      {
        kind: 'dimension',
        start: segment.witnessStart,
        end: segment.witnessEnd,
        dimensionStart: segment.dimensionStart,
        dimensionEnd: segment.dimensionEnd,
        offsetNormal: layout.normal,
        offsetDistance: 0,
        extensionOvershoot: 0.12,
        text: `${dangling ? 'UNLINKED · ' : ''}${formatConstructionLength(
          segment.value,
          ctx.viewState?.unit ?? 'metric',
        )}`,
        stroke: dangling ? '#dc2626' : stroke,
      },
      {
        kind: 'hit-line',
        x1: segment.dimensionStart[0],
        y1: segment.dimensionStart[1],
        x2: segment.dimensionEnd[0],
        y2: segment.dimensionEnd[1],
        strokeWidthPx: 12,
      },
    )
  }

  if (editable) {
    children.push({
      kind: 'endpoint-handle',
      point: layout.midpoint,
      state: 'idle',
      variant: 'curve',
      affordance: 'move-construction-dimension-baseline',
      payload: null,
    })
  }

  return { kind: 'group', children }
}
