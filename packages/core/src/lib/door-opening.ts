import type { DoorNode } from '../schema'
import { openingHostFacing } from './opening-casing'

/** Leaf centre relative to the full opening centre, in the door's own frame (metres). */
export function getDoorOpeningSize(door: {
  width: number
  height: number
  doorType?: string
  openingKind?: string
  source?: unknown
  sidelightLeft?: number
  sidelightRight?: number
  transomHeight?: number
}): { width: number; height: number; leafOffsetX: number } {
  const swing =
    !door.source &&
    door.openingKind !== 'opening' &&
    (!door.doorType ||
      door.doorType === 'hinged' ||
      door.doorType === 'double' ||
      door.doorType === 'french')
  const left = swing ? (door.sidelightLeft ?? 0) : 0
  const right = swing ? (door.sidelightRight ?? 0) : 0
  return {
    width: door.width + left + right,
    height: door.height + (swing ? (door.transomHeight ?? 0) : 0),
    leafOffsetX: (left - right) / 2,
  }
}

/** Keep the host cutout fixed when the leaf's facing changes. */
export function doorPositionForFacing(
  door: Pick<DoorNode, 'position' | 'rotation'> & Parameters<typeof getDoorOpeningSize>[0],
  nextRotation: DoorNode['rotation'],
): DoorNode['position'] {
  const { leafOffsetX } = getDoorOpeningSize(door)
  return [
    door.position[0] +
      leafOffsetX * (openingHostFacing({ rotation: nextRotation }) - openingHostFacing(door)),
    door.position[1],
    door.position[2],
  ]
}
