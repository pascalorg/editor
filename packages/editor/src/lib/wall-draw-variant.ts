import {
  type AnyNode,
  type AnyNodeId,
  type DrawnWallTypes,
  detectSpacesForLevel,
  emitter,
  type MessageDescriptor,
  pointInPolygon2D,
  railingWallDefaults,
  useScene,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { create } from 'zustand'
import useEditor from '../store/use-editor'
import { useFloorplanDraftPreview } from '../store/use-floorplan-draft-preview'
import type { ContinuationMode } from './continuation'
import { levelSeparatorLines } from './separator-lines'
import {
  availableWallType,
  drawnWallTypesOf,
  type WallTypePlacement,
  type WallTypes,
  wallTypeThickness,
} from './wall-type'

/**
 * How the wall tool draws, picked from the Build panel's Rooms group before
 * drawing starts. Stored as the wall's continuation mode (persisted with the
 * editor preferences), so the choice survives tool switches and reloads.
 */
export type WallDrawVariant = 'rectangle' | 'polygon' | 'walls'

export type WallDrawVariantInfo = {
  id: WallDrawVariant
  /** The wall continuation mode the tool reads. */
  mode: ContinuationMode
  /** Tile label. */
  label: string
  /** The name the HUD shows while the variant is armed. */
  title: MessageDescriptor
  iconSrc: string
  /** Caption under the Rooms tiles: a bold lead, then the rest. */
  caption: { lead: string; rest: string }
}

export const WALL_DRAW_VARIANTS: readonly WallDrawVariantInfo[] = [
  {
    id: 'rectangle',
    mode: 'rectangle',
    label: 'Rectangle',
    title: /* i18n */ { id: 'editor.lib.wallDrawVariant.rectangleRoom', message: 'Rectangle room' },
    iconSrc: '/icons/room.webp',
    caption: {
      lead: 'Click two corners',
      rest: 'on the grid. Walls, floor and ceiling are created together.',
    },
  },
  {
    id: 'polygon',
    mode: 'room',
    label: 'Polygon',
    title: /* i18n */ { id: 'editor.lib.wallDrawVariant.polygonRoom', message: 'Polygon room' },
    iconSrc: '/icons/polygon-room.webp',
    caption: {
      lead: 'Click each corner,',
      rest: 'then the first one again to close. For L-shapes and angled rooms.',
    },
  },
  {
    id: 'walls',
    mode: 'single',
    label: 'Walls',
    title: /* i18n */ { id: 'editor.lib.wallDrawVariant.walls', message: 'Walls' },
    iconSrc: '/icons/wall.webp',
    caption: {
      lead: 'Click each corner;',
      rest: 'every wall starts where the last ended. Esc or double-click ends the run; close a loop and it becomes a room.',
    },
  },
]

export const WALL_DRAW_IDLE_CAPTION =
  'Pick a shape to start. Every room brings its own walls, floor and ceiling.'

export function getWallDrawVariantInfo(variant: WallDrawVariant): WallDrawVariantInfo {
  return WALL_DRAW_VARIANTS.find((info) => info.id === variant) ?? WALL_DRAW_VARIANTS[1]!
}

export function wallDrawVariantOf(mode: ContinuationMode): WallDrawVariant {
  return WALL_DRAW_VARIANTS.find((info) => info.mode === mode)?.id ?? 'polygon'
}

export function getWallDrawVariant(): WallDrawVariant {
  return wallDrawVariantOf(useEditor.getState().getContinuation('wall'))
}

export function useWallDrawVariant(): WallDrawVariant {
  return useEditor((state) => wallDrawVariantOf(state.getContinuation('wall')))
}

/**
 * Pick how the wall tool draws. Callers arm the wall tool themselves; switching
 * while it is armed drops the in-flight draft so a half-drawn chain never
 * finishes as a rectangle.
 */
export function selectWallDrawVariant(variant: WallDrawVariant): void {
  // Picking a shape, even the one in hand, goes back to choosing the wall type
  // by placement.
  setWallTypeOverride(null)
  const editor = useEditor.getState()
  const { mode } = getWallDrawVariantInfo(variant)
  if (editor.getContinuation('wall') === mode) return
  if (editor.mode === 'build' && editor.tool === 'wall') emitter.emit('tool:cancel')
  editor.setContinuation('wall', mode)
}

/**
 * The construction Rectangle, Polygon and Walls give the walls they draw: the
 * Build panel's exterior and interior wall types, with the finishes picked
 * beside them. A preset the host placed (`toolDefaults.wall` with its own
 * thickness or assembly) keeps its own.
 */
export function getDrawnWallTypes(): DrawnWallTypes {
  const { wallTypes, wallFinishes } = useEditor.getState()
  const override = useWallTypeOverride.getState().placement
  if (!override) return drawnWallTypesOf(wallTypes, wallFinishes)
  const forced = availableWallType(wallTypes[override], override)
  return drawnWallTypesOf({ exterior: forced, interior: forced }, wallFinishes)
}

/**
 * What the wall tool draws in place of walls of a type: invisible walls (room dividers,
 * room separators no wall stands on) or railings.
 */
export type WallLineKind = 'invisible' | 'railing'

/** The line an invisible wall's draft is drawn at, metres. */
export const INVISIBLE_WALL_DRAFT_THICKNESS = 0.01

// Session-only, so it lives beside the persisted editor store, not in it.
const useWallTypeOverride = create<{
  placement: WallTypePlacement | null
  lineKind: WallLineKind | null
}>(() => ({
  placement: null,
  lineKind: null,
}))

/**
 * For this session only: draw every wall with the exterior or the interior
 * type, wherever it lands (null goes back to choosing by placement). Not
 * persisted; the Build panel's picks are unchanged. It ends any invisible wall
 * or railing run.
 */
export function setWallTypeOverride(placement: WallTypePlacement | null): void {
  useWallTypeOverride.setState({ placement, lineKind: null })
}

/** For this session only: the wall tool draws invisible walls or railings (null: walls again). */
export function setWallLineKind(lineKind: WallLineKind | null): void {
  useWallTypeOverride.setState({ lineKind, placement: null })
}

export function getWallLineKind(): WallLineKind | null {
  return useWallTypeOverride.getState().lineKind
}

/** The line kind the wall tool draws, for the Build panel to light its tile; null when walls. */
export function useWallLineKind(): WallLineKind | null {
  return useWallTypeOverride((state) => state.lineKind)
}

/**
 * What an invisible-wall draft snaps to besides walls: the current level's
 * invisible walls, as lines (`separatorWallLine`), so a new one closes onto
 * their ends and bodies — its old corner. Nothing while walls or railings draw.
 */
export function invisibleWallDraftSnapLines(): WallNode[] {
  if (getWallLineKind() !== 'invisible') return []
  return levelSeparatorLines(useScene.getState().nodes, useViewer.getState().selection.levelId)
}

export function getWallTypeOverride(): WallTypePlacement | null {
  return useWallTypeOverride.getState().placement
}

/** The forced wall type placement, for the Build panel to show; null when none. */
export function useWallTypeOverridePlacement(): WallTypePlacement | null {
  return useWallTypeOverride((state) => state.placement)
}

// A level's rooms, once per scene state: the draft asks on every pointer move.
const levelRoomsCache = new WeakMap<object, Map<string, Array<Array<[number, number]>>>>()

function levelRooms(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string,
): Array<Array<[number, number]>> {
  let byLevel = levelRoomsCache.get(nodes)
  if (!byLevel) {
    byLevel = new Map()
    levelRoomsCache.set(nodes, byLevel)
  }
  const cached = byLevel.get(levelId)
  if (cached) return cached
  const level = nodes[levelId as AnyNodeId]
  const walls =
    level?.type === 'level'
      ? level.children
          .map((id) => nodes[id as AnyNodeId])
          .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
      : []
  const rooms = detectSpacesForLevel(levelId, walls)
    .spaces.filter((space) => !space.isExterior)
    .map((space) => space.polygon)
  byLevel.set(levelId, rooms)
  return rooms
}

/**
 * The wall type a wall drawn `start` → `end` on `levelId` gets, as the commit decides it
 * (`DrawnWallTypes`): interior inside a room the level's walls close (a partition), exterior
 * elsewhere (the outline, an open run, the first walls of a plan).
 */
export function drawnWallPlacement(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string,
  start: WallPlanPoint,
  end: WallPlanPoint,
): WallTypePlacement {
  const middle: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  return levelRooms(nodes, levelId).some((room) =>
    pointInPolygon2D(middle, room, { includeBoundary: false }),
  )
    ? 'interior'
    : 'exterior'
}

function draftThickness(
  seeded: unknown,
  wallTypes: WallTypes,
  placement: WallTypePlacement,
  fallback: number,
): number {
  if (typeof seeded === 'number') return seeded
  return wallTypeThickness(wallTypes[placement], placement) ?? fallback
}

function draftPlacement(start: WallPlanPoint, end: WallPlanPoint): WallTypePlacement {
  const levelId = useViewer.getState().selection.levelId
  return levelId ? drawnWallPlacement(useScene.getState().nodes, levelId, start, end) : 'exterior'
}

/**
 * The thickness the wall tool's line draft draws at: a placed preset's, else
 * the wall type it draws with (the override's, or the one the drafted segment
 * gets where it lies), else `fallback` (a plain wall).
 */
export function useWallDraftThickness(fallback: number): number {
  const override = useWallTypeOverride((state) => state.placement)
  // Read once per draft move: the scene and level stay put while a segment is drafted.
  const drawn = useFloorplanDraftPreview((state) =>
    state.wallDraftStart && state.wallDraftEnd
      ? draftPlacement(state.wallDraftStart, state.wallDraftEnd)
      : 'exterior',
  )
  const placement = override ?? drawn
  const lineKind = useWallTypeOverride((state) => state.lineKind)
  const thickness = useEditor((state) =>
    draftThickness(state.toolDefaults.wall?.thickness, state.wallTypes, placement, fallback),
  )
  if (lineKind === 'invisible') return INVISIBLE_WALL_DRAFT_THICKNESS
  return lineKind === 'railing' ? railingWallDefaults().thickness : thickness
}

/**
 * The same thickness for each side of a Rectangle or Polygon room draft, which
 * has no line draft to judge by: the commit types every side by where it lies,
 * so a closet drawn inside a room is all partition.
 */
export function useWallSegmentDraftThickness(
  fallback: number,
): (start: WallPlanPoint, end: WallPlanPoint) => number {
  const override = useWallTypeOverride((state) => state.placement)
  const seeded = useEditor((state) => state.toolDefaults.wall?.thickness)
  const wallTypes = useEditor((state) => state.wallTypes)
  return useCallback(
    (start, end) =>
      draftThickness(seeded, wallTypes, override ?? draftPlacement(start, end), fallback),
    [fallback, override, seeded, wallTypes],
  )
}
