import type { PanelNode } from '../schema/nodes/panel'
import type { WallNode } from '../schema/nodes/wall'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'

/**
 * How far a panel's centre sits from its wall's centreline, toward its face.
 * A wall's front is its local +Z. Derived from the wall at build time, so a
 * panel stays on the face when the wall is thickened.
 */
export function panelDepthOffset(
  panel: Pick<PanelNode, 'side' | 'offset' | 'thickness'>,
  wall: Pick<WallNode, 'thickness'> | null,
): number {
  const halfWall = (wall?.thickness ?? DEFAULT_WALL_THICKNESS) / 2
  const sign = panel.side === 'front' ? 1 : -1
  return sign * (halfWall + panel.offset + panel.thickness / 2)
}
