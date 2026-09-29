import type { DoorNode, WindowNode } from '@pascal-app/core'

type PlanarOpening = Pick<DoorNode | WindowNode, 'position' | 'wallId' | 'parentId'>

/**
 * The wall-local plane offset (`position[2]`) a moved door / window keeps on
 * `targetWallId`. The offset is measured from the centre plane of the wall the
 * opening stands on (a photo-profiled slider can sit wholly outside one face),
 * so it survives a slide along that same wall and resets to the centre plane on
 * any other host, whose faces it says nothing about.
 */
export function openingPlaneOffsetOnWall(opening: PlanarOpening, targetWallId: string): number {
  const hostWallId = opening.wallId ?? opening.parentId
  return hostWallId === targetWallId ? (opening.position[2] ?? 0) : 0
}

/**
 * Where an opening's plan symbol sits across its wall. A centred opening keeps
 * the long-standing symbol: centred in the cutout, as deep as the wall. An
 * opening offset from the centre plane draws its frame at that offset with its
 * own `frameDepth`, like the 3D renderer; the builder then also draws the
 * cutout, because the wall is still cut through its whole thickness.
 */
export function resolveOpeningPlanPlane(
  opening: Pick<DoorNode | WindowNode, 'position' | 'frameDepth'>,
  wallThickness: number,
): { offset: number; depth: number } {
  const offset = opening.position[2] ?? 0
  if (offset === 0 || !(opening.frameDepth > 0)) return { offset: 0, depth: wallThickness }
  return { offset, depth: opening.frameDepth }
}
