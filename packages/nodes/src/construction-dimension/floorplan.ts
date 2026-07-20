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

  const start = resolveMeasurementAnchor(node.anchors[0], (id) => ctx.resolve(id))
  const end = resolveMeasurementAnchor(node.anchors[1], (id) => ctx.resolve(id))
  const anchors: [MeasurementPoint, MeasurementPoint] = [start.point, end.point]
  const layout = resolveConstructionDimensionLayout(node, anchors)
  const dangling = Boolean(start.dangling || end.dangling)
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = dangling
    ? '#dc2626'
    : selected
      ? (ctx.viewState?.palette.selectedStroke ?? '#2563eb')
      : (ctx.viewState?.palette.measurementStroke ?? '#334155')
  const editable = ctx.viewState?.selected === true

  return {
    kind: 'group',
    children: [
      {
        kind: 'dimension',
        start: layout.witnessStart,
        end: layout.witnessEnd,
        dimensionStart: layout.dimensionStart,
        dimensionEnd: layout.dimensionEnd,
        offsetNormal: layout.normal,
        offsetDistance: 0,
        extensionOvershoot: 0.12,
        text: `${dangling ? 'UNLINKED · ' : ''}${formatConstructionLength(
          layout.value,
          ctx.viewState?.unit ?? 'metric',
        )}`,
        stroke,
      },
      {
        kind: 'hit-line',
        x1: layout.dimensionStart[0],
        y1: layout.dimensionStart[1],
        x2: layout.dimensionEnd[0],
        y2: layout.dimensionEnd[1],
        strokeWidthPx: 12,
      },
      ...(editable
        ? [
            {
              kind: 'endpoint-handle' as const,
              point: layout.midpoint,
              state: 'idle' as const,
              variant: 'curve' as const,
              affordance: 'move-construction-dimension-baseline',
              payload: null,
            },
          ]
        : []),
    ],
  }
}
