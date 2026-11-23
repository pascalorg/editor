import type {
  ElevatorDoorPanelStyle,
  ElevatorDoorStyle,
  ElevatorNode,
  ElevatorShaftStyle,
} from '../../schema'

export type ElevatorDoorSide = 'left' | 'right'

const DEFAULT_ELEVATOR_SHAFT_WALL_THICKNESS = 0.09
export const ELEVATOR_MIN_CAB_DIMENSION = 0.8
export const ELEVATOR_MIN_CAB_HEIGHT = 1.8
export const ELEVATOR_MIN_WALL_THICKNESS = 0.04

export function getResolvedElevatorDoorStyle(
  doorStyle: ElevatorNode['doorStyle'] | undefined,
): ElevatorDoorStyle {
  return doorStyle ?? 'center-opening'
}

export function getResolvedElevatorDoorPanelStyle(
  doorPanelStyle: ElevatorNode['doorPanelStyle'] | undefined,
): ElevatorDoorPanelStyle {
  return doorPanelStyle ?? 'glass-frame'
}

export function getResolvedElevatorShaftStyle(
  shaftStyle: ElevatorNode['shaftStyle'] | undefined,
): ElevatorShaftStyle {
  return shaftStyle ?? 'solid'
}

export function getElevatorDoorLeafSides(
  doorStyle: ElevatorNode['doorStyle'] | undefined,
): ElevatorDoorSide[] {
  const resolvedDoorStyle = getResolvedElevatorDoorStyle(doorStyle)
  if (resolvedDoorStyle === 'single-left') return ['left']
  if (resolvedDoorStyle === 'single-right') return ['right']
  return ['left', 'right']
}

export function getElevatorDoorLeafX(
  side: ElevatorDoorSide,
  openingWidth: number,
  doorOpen: number,
  doorStyle: ElevatorNode['doorStyle'] | undefined,
) {
  const resolvedDoorStyle = getResolvedElevatorDoorStyle(doorStyle)
  const amount = Math.min(1, Math.max(0, doorOpen))
  const leafWidth = getElevatorDoorLeafWidth(openingWidth, doorStyle)
  const openCenter = (openingWidth + leafWidth) / 2
  if (resolvedDoorStyle === 'center-opening') {
    const direction = side === 'left' ? -1 : 1
    return direction * (openingWidth / 4 + amount * (openCenter - openingWidth / 4))
  }
  return (resolvedDoorStyle === 'single-left' ? -1 : 1) * amount * openCenter
}

export function getElevatorDoorLeafWidth(
  openingWidth: number,
  doorStyle: ElevatorNode['doorStyle'] | undefined,
) {
  return getResolvedElevatorDoorStyle(doorStyle) === 'center-opening'
    ? Math.max(openingWidth / 2 - 0.018, 0.12)
    : Math.max(openingWidth - 0.018, 0.18)
}

export function getElevatorCabWidth(node: ElevatorNode) {
  return Math.max(node.width, ELEVATOR_MIN_CAB_DIMENSION)
}

export function getElevatorCabDepth(node: ElevatorNode) {
  return Math.max(node.depth, ELEVATOR_MIN_CAB_DIMENSION)
}

export function getElevatorShaftWallThickness(node: ElevatorNode) {
  return Math.max(
    node.shaftWallThickness ?? DEFAULT_ELEVATOR_SHAFT_WALL_THICKNESS,
    ELEVATOR_MIN_WALL_THICKNESS,
  )
}

export function getElevatorShaftWidth(node: ElevatorNode, cabWidth = getElevatorCabWidth(node)) {
  return Math.max(node.shaftWidth ?? cabWidth, cabWidth, ELEVATOR_MIN_CAB_DIMENSION)
}

export function getElevatorShaftDepth(node: ElevatorNode, cabDepth = getElevatorCabDepth(node)) {
  return Math.max(node.shaftDepth ?? cabDepth, cabDepth, ELEVATOR_MIN_CAB_DIMENSION)
}

export function getElevatorCabCenterZ(node: ElevatorNode) {
  return -getElevatorShaftDepth(node) / 2 + getElevatorCabDepth(node) / 2
}

/** Shared effective dimensions keep legacy scenes readable without rewriting stored data. */
export function resolveElevatorDimensions(node: ElevatorNode) {
  const width = getElevatorCabWidth(node)
  const depth = getElevatorCabDepth(node)
  const cabHeight = Math.max(node.cabHeight, ELEVATOR_MIN_CAB_HEIGHT)
  const shaftWidth = getElevatorShaftWidth(node, width)
  const shaftDepth = getElevatorShaftDepth(node, depth)
  return {
    width,
    depth,
    cabHeight,
    shaftWidth,
    shaftDepth,
    shaftWallThickness: getElevatorShaftWallThickness(node),
    doorWidth: Math.min(Math.max(node.doorWidth, 0.45), width - 0.18, shaftWidth - 0.18),
    doorHeight: Math.min(Math.max(node.doorHeight, 1.2), cabHeight - 0.1),
  }
}

/** Apply on dimension edits only; absent shaft dimensions retain automatic cab sizing. */
export function normalizeElevatorDimensions(node: ElevatorNode) {
  const dimensions = resolveElevatorDimensions(node)
  return {
    ...dimensions,
    shaftWidth: node.shaftWidth === undefined ? undefined : dimensions.shaftWidth,
    shaftDepth: node.shaftDepth === undefined ? undefined : dimensions.shaftDepth,
  }
}
