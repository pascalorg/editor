import type { DoorNode } from '@pascal-app/core'

type SwingDoor = Pick<DoorNode, 'doorType' | 'hingesSide' | 'handleSide' | 'swingDirection'> &
  Partial<Pick<DoorNode, 'openingKind' | 'source'>>

const flip = (side: 'left' | 'right') => (side === 'left' ? 'right' : 'left')

/** Whether a door swings on hinges (the panel's Swing section), so its swing can be swapped. */
export function canSwapDoorSwing(door: SwingDoor): boolean {
  return (
    !door.source &&
    door.openingKind !== 'opening' &&
    (door.doorType === 'hinged' || door.doorType === 'double' || door.doorType === 'french')
  )
}

/** Whether a door has one hinge side to swap: a single hinged leaf. */
export function canSwapDoorHinge(door: SwingDoor): boolean {
  return canSwapDoorSwing(door) && door.doorType === 'hinged'
}

/** The leaf hung from the other jamb: hinges and handle trade sides, so the handle stays on the free edge. */
export function swapDoorHingePatch(door: SwingDoor): Partial<DoorNode> {
  return { hingesSide: flip(door.hingesSide), handleSide: flip(door.handleSide) }
}

/** The leaf swinging into the other side of the wall. */
export function swapDoorSwingPatch(door: SwingDoor): Partial<DoorNode> {
  return { swingDirection: door.swingDirection === 'inward' ? 'outward' : 'inward' }
}

/**
 * The swing that opens a door's leaf toward `side` of its wall: the face under the cursor while
 * placing, so the door swings into the side it is placed from (R flips it to the other side). An
 * inward door opens toward the face it is hung facing (`rotationY` 0 faces front, π back), so a
 * door facing that side swings inward and one facing away swings outward. A garage door has no
 * swing and keeps its own.
 */
export function placementSwing(
  door: Pick<DoorNode, 'doorType' | 'swingDirection'>,
  rotationY: number,
  side: 'front' | 'back',
): DoorNode['swingDirection'] {
  if (door.doorType?.startsWith('garage-')) return door.swingDirection
  const facing = Math.cos(rotationY) >= 0 ? 'front' : 'back'
  return facing === side ? 'inward' : 'outward'
}
