import type { DoorNode, DoorSegment } from '../schema'
import { type DoorType, defaultDoorSegments } from '../schema/nodes/opening-types'
import { type DoorStyle, doorStyleLook, doorStylesOf } from './opening-style-presets'

/** A door type's own size: the door panel's Type row sets it, and add_door takes it when none is given. */
export const DOOR_TYPE_SIZES: Record<DoorType, { width: number; height: number }> = {
  hinged: { width: 0.9, height: 2.1 },
  double: { width: 1.5, height: 2.1 },
  french: { width: 1.5, height: 2.1 },
  folding: { width: 1.8, height: 2.1 },
  pocket: { width: 0.9, height: 2.1 },
  barn: { width: 1, height: 2.1 },
  sliding: { width: 1.5, height: 2.1 },
  'garage-sectional': { width: 2.7, height: 2.4 },
  'garage-rollup': { width: 2.7, height: 2.4 },
  'garage-tiltup': { width: 2.7, height: 2.4 },
}

const frenchSegments = (): DoorSegment[] => [
  {
    type: 'glass',
    heightRatio: 0.76,
    columnRatios: [1, 1],
    dividerThickness: 0.025,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
  {
    type: 'panel',
    heightRatio: 0.24,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.012,
    panelInset: 0.035,
  },
]

const foldingSegments = (): DoorSegment[] => [
  {
    type: 'panel',
    heightRatio: 1,
    columnRatios: [1],
    dividerThickness: 0.02,
    panelDepth: 0.008,
    panelInset: 0.025,
  },
]

const segmentsOf = (type: DoorType): DoorSegment[] =>
  type === 'hinged' || type === 'double'
    ? defaultDoorSegments()
    : type === 'french' || type === 'sliding'
      ? frenchSegments()
      : foldingSegments()

type TypeSource = Partial<Pick<DoorNode, 'operationState' | 'slideDirection' | 'garagePanelCount'>>

/**
 * What a door type writes besides its size, for the door panel's Type row and add_door alike: its
 * leaves, its track and the leaf it comes with (an agent's sliding door had no track, as the agent
 * set doorType alone).
 */
export function doorTypeFields(type: DoorType, door: TypeSource = {}): Partial<DoorNode> {
  const segments = segmentsOf(type)
  const sliding = {
    leafCount: 1 as const,
    openingShape: 'rectangle' as const,
    handle: true,
    handleSide: 'right' as const,
    slideDirection: door.slideDirection ?? 'left',
    operationState: door.operationState ?? 0,
    threshold: false,
    contentPadding: [0.035, 0.045] as [number, number],
  }
  const garage = {
    doorCategory: 'garage' as const,
    leafCount: 1 as const,
    handle: false,
    threshold: false,
    openingShape: 'rectangle' as const,
    trackStyle: 'overhead' as const,
    operationState: 0,
    garagePanelCount: 4,
    contentPadding: [0.04, 0.04] as [number, number],
  }
  switch (type) {
    case 'double':
    case 'french':
      return {
        doorCategory: 'interior',
        doorType: type,
        leafCount: 2,
        handleSide: 'right',
        segments,
        ...(type === 'french' ? { contentPadding: [0.045, 0.055] as [number, number] } : {}),
      }
    case 'folding':
      return {
        doorCategory: 'interior',
        doorType: type,
        leafCount: 4,
        openingShape: 'rectangle',
        handle: true,
        handleSide: 'right',
        trackStyle: 'visible',
        operationState: Math.max(door.operationState ?? 0, 0.65),
        threshold: false,
        contentPadding: [0.03, 0.04],
        segments,
      }
    case 'pocket':
      return {
        doorCategory: 'interior',
        doorType: type,
        ...sliding,
        trackStyle: 'pocket',
        segments,
      }
    case 'barn':
      return {
        doorCategory: 'interior',
        doorType: type,
        ...sliding,
        trackStyle: 'visible',
        segments,
      }
    case 'sliding':
      return {
        doorCategory: 'interior',
        doorType: type,
        ...sliding,
        leafCount: 2,
        trackStyle: 'visible',
        contentPadding: [0.03, 0.04],
        segments,
      }
    case 'garage-sectional':
      return {
        ...garage,
        doorType: type,
        garagePanelCount: Math.max(3, Math.min(8, door.garagePanelCount ?? 4)),
        segments,
      }
    case 'garage-rollup':
    case 'garage-tiltup':
      return { ...garage, doorType: type, segments }
    case 'hinged':
      return { doorCategory: 'interior', doorType: type, leafCount: 1, segments, threshold: true }
  }
}

/** The style a door keeps through a type change: one chosen over the leaf its type came with. */
function chosenStyle(door: DoorNode): DoorStyle | undefined {
  const [style] = doorStylesOf(door)
  if (!style) return undefined
  const own = doorTypeFields(door.doorType, door)
  const ownPadding = own.contentPadding ?? door.contentPadding
  const isOwn = doorStylesOf({ segments: own.segments ?? [], contentPadding: ownPadding }).includes(
    style,
  )
  return isOwn ? undefined : style
}

/**
 * The door panel's Type row: the type's fields and size, the door kept on the floor, and a style
 * the person chose kept (a modern door made sliding stays modern; a plain one made French takes
 * the French glazing).
 */
export function doorTypeChange(door: DoorNode, type: DoorType): Partial<DoorNode> {
  const { width, height } = DOOR_TYPE_SIZES[type]
  const kept = chosenStyle(door)
  return {
    ...doorTypeFields(type, door),
    width,
    height,
    position: [door.position[0], height / 2, door.position[2]],
    ...(kept ? doorStyleLook(kept) : {}),
  }
}
