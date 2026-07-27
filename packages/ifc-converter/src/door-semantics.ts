import type { DoorNode } from '@pascal-app/core'

type DoorStyle = Partial<DoorNode>

const glazedSegments: DoorNode['segments'] = [
  {
    type: 'glass',
    heightRatio: 1,
    columnRatios: [1],
    dividerThickness: 0.025,
    panelDepth: 0.008,
    panelInset: 0.035,
  },
]

/** Map standardized IfcDoor operation values to Pascal door families. */
export function doorStyleFromIfcOperation(operationType: unknown): DoorStyle {
  const operation = String(operationType ?? '').toUpperCase()
  const leafCount = operation.startsWith('DOUBLE_DOOR') ? 2 : 1

  if (operation.includes('SLIDING')) {
    return {
      doorType: 'sliding',
      leafCount,
      slideDirection: operation.includes('RIGHT') ? 'right' : 'left',
      trackStyle: 'visible',
      threshold: false,
    }
  }

  if (operation.includes('FOLDING')) {
    return {
      doorType: 'folding',
      leafCount: 2,
    }
  }

  if (operation === 'ROLLINGUP') {
    return {
      doorCategory: 'garage',
      doorType: 'garage-rollup',
      trackStyle: 'overhead',
    }
  }

  if (operation.startsWith('DOUBLE_DOOR')) {
    return { doorType: 'double', leafCount: 2 }
  }

  if (operation.includes('SWING_RIGHT')) return { hingesSide: 'right' }
  if (operation.includes('SWING_LEFT')) return { hingesSide: 'left' }
  return {}
}

/** Apply the standardized Pset_DoorCommon glazing fraction after psets load. */
export function doorGlazingStyle(door: DoorNode, glazingAreaFraction: unknown): DoorStyle {
  const fraction = Number(glazingAreaFraction)
  if (!Number.isFinite(fraction) || fraction <= 0) return {}

  return {
    doorType: door.doorType === 'double' ? 'french' : door.doorType,
    segments: glazedSegments,
    contentPadding: [0.04, 0.05],
  }
}
