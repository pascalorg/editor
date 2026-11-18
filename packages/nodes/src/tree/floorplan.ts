import {
  type FloorplanGeometry,
  floorplanGeometryMetadata,
  type GeometryContext,
  resolveTreeParameters,
  type TreeNode,
} from '@pascal-app/core'

/** Site XZ metres, in the planting bed's line style. */
export function buildTreeFloorplan(node: TreeNode, ctx: GeometryContext): FloorplanGeometry {
  const { spreadM } = resolveTreeParameters(node)
  const view = ctx.viewState
  const marked = view?.selected || view?.highlighted
  const stroke = marked ? (view?.palette?.selectedStroke ?? '#0ea5e9') : '#526443'
  const fill = marked ? (view?.palette?.selectedFill ?? '#dbeafe') : node.foliage
  const [x, , z] = node.position
  return {
    kind: 'group',
    children: [
      {
        kind: 'circle',
        cx: x,
        cy: z,
        r: spreadM / 2,
        fill,
        fillOpacity: 0.35,
        stroke,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
        metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
      },
      {
        kind: 'circle',
        cx: x,
        cy: z,
        r: Math.max(0.06, node.heightM * 0.015),
        fill: stroke,
        stroke: 'none',
        pointerEvents: 'none',
      },
    ],
  }
}
