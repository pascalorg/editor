import type { DoorNode } from '@pascal-app/core'

/**
 * Pascal door family → IfcDoorTypeOperationEnum. The inverse of
 * `doorStyleFromIfcOperation` (door-semantics.ts), so an exported door
 * re-imports as the same family.
 */
export function doorOperationForIfc(door: DoorNode): {
  operationType: string
  userDefined?: string
} {
  const doubleLeaf = (door.leafCount ?? 1) >= 2
  switch (door.doorType) {
    case 'double':
    case 'french':
      return { operationType: 'DOUBLE_DOOR_SINGLE_SWING' }
    case 'sliding':
    case 'pocket':
    case 'barn':
      if (doubleLeaf) return { operationType: 'DOUBLE_DOOR_SLIDING' }
      return {
        operationType: door.slideDirection === 'right' ? 'SLIDING_TO_RIGHT' : 'SLIDING_TO_LEFT',
      }
    case 'folding':
      return { operationType: doubleLeaf ? 'DOUBLE_DOOR_FOLDING' : 'FOLDING_TO_LEFT' }
    case 'garage-rollup':
      return { operationType: 'ROLLINGUP' }
    case 'garage-sectional':
    case 'garage-tiltup':
      return { operationType: 'USERDEFINED', userDefined: door.doorType }
    default:
      if (doubleLeaf) return { operationType: 'DOUBLE_DOOR_SINGLE_SWING' }
      return {
        operationType: door.hingesSide === 'right' ? 'SINGLE_SWING_RIGHT' : 'SINGLE_SWING_LEFT',
      }
  }
}

/** Share of the leaf height that is glazed, for Pset_DoorCommon.GlazingAreaFraction. */
export function doorGlazingFraction(door: DoorNode): number {
  const segments = door.segments ?? []
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.heightRatio), 0)
  const glass = segments
    .filter((segment) => segment.type === 'glass')
    .reduce((sum, segment) => sum + Math.max(0, segment.heightRatio), 0)
  if (total > 0 && glass > 0) return Math.min(1, glass / total)
  return door.doorType === 'french' ? 1 : 0
}
