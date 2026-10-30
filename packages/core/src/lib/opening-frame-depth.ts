import type { AnyNode, DoorNode, WindowNode } from '../schema'
import { DEFAULT_WALL_THICKNESS, getWallThickness } from '../systems/wall/wall-footprint'

/** How far an auto-depth door frame stands proud of each wall face. */
export const OPENING_FRAME_LIP = 0.01

type FrameDepthOpening = Pick<DoorNode | WindowNode, 'type' | 'frameDepth'>

/** An opening without an explicit frame depth follows its host wall. */
export function isAutoFrameDepth(opening: FrameDepthOpening): boolean {
  return opening.frameDepth === undefined
}

/**
 * The depth a door's or window's frame runs through its wall. An explicit
 * `frameDepth` is kept as stored; left out, the frame is the host wall's
 * thickness for a window, or the thickness plus a lip on each face for a door.
 */
export function resolveOpeningFrameDepth(
  opening: FrameDepthOpening,
  wallThickness: number,
): number {
  return opening.frameDepth ?? wallThickness + (opening.type === 'door' ? OPENING_FRAME_LIP * 2 : 0)
}

/**
 * `resolveOpeningFrameDepth` against the opening's host in `nodes`: its parent
 * wall's thickness, or the default wall thickness off a wall (a roof face, a
 * dormer, an unparented preview).
 */
export function resolveHostedOpeningFrameDepth(
  opening: Pick<DoorNode | WindowNode, 'type' | 'frameDepth' | 'parentId'>,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
): number {
  const host = opening.parentId ? nodes[opening.parentId] : undefined
  return resolveOpeningFrameDepth(
    opening,
    host?.type === 'wall' ? getWallThickness(host) : DEFAULT_WALL_THICKNESS,
  )
}
