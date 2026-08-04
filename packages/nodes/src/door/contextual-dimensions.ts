import type { DoorNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { buildWallHostedOpeningContextualDimensions } from '../wall/contextual-dimensions'

export function buildDoorContextualDimensions(
  node: DoorNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  return buildWallHostedOpeningContextualDimensions(node, ctx, {
    showClearancesWhileMoving: false,
    useExteriorNormal: false,
  })
}
