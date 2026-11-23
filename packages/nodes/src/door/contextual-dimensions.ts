import type { DoorNode, FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { getDoorOpeningSize, openingHostFacing } from '@pascal-app/core'
import { buildWallHostedOpeningContextualDimensions } from '../wall/contextual-dimensions'

export function buildDoorContextualDimensions(
  node: DoorNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const size = getDoorOpeningSize(node)
  return buildWallHostedOpeningContextualDimensions(
    {
      ...node,
      width: size.width,
      position: [
        node.position[0] - size.leafOffsetX * openingHostFacing(node),
        node.position[1],
        node.position[2],
      ],
    },
    ctx,
    {
      showClearancesWhileMoving: false,
      useExteriorNormal: false,
    },
  )
}
