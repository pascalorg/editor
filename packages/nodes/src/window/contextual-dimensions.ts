import type { FloorplanGeometry, GeometryContext, WindowNode } from '@pascal-app/core'
import { buildWallHostedOpeningContextualDimensions } from '../wall/contextual-dimensions'

export function buildWindowContextualDimensions(
  node: WindowNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  return buildWallHostedOpeningContextualDimensions(node, ctx, {
    showClearancesWhileMoving: true,
    useExteriorNormal: true,
  })
}
