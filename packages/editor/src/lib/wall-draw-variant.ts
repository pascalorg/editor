import {
  emitter,
  type MessageDescriptor,
  railingWallDefaults,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import useEditor from '../store/use-editor'
import type { ContinuationMode } from './continuation'
import { levelSeparatorLines } from './separator-lines'

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
      lead: 'Draw one wall at a time.',
      rest: 'Close a loop and it becomes a room; leave it open for partitions.',
    },
  },
]

export const WALL_DRAW_IDLE_CAPTION =
  'Pick a shape to start. Every room brings its own walls, floor and ceiling.'

export function getWallDrawVariantInfo(variant: WallDrawVariant): WallDrawVariantInfo {
  return WALL_DRAW_VARIANTS.find((info) => info.id === variant) ?? WALL_DRAW_VARIANTS[1]!
}

export function wallDrawVariantOf(mode: ContinuationMode): WallDrawVariant {
  return WALL_DRAW_VARIANTS.find((info) => info.mode === mode)?.id ?? 'rectangle'
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
  const editor = useEditor.getState()
  const { mode } = getWallDrawVariantInfo(variant)
  if (editor.getContinuation('wall') === mode) return
  if (editor.mode === 'build' && editor.tool === 'wall') emitter.emit('tool:cancel')
  editor.setContinuation('wall', mode)
}

/**
 * What the wall tool draws in place of plain walls: invisible walls (room separators no wall
 * stands on) or railings.
 */
export type WallLineKind = 'invisible' | 'railing'

/**
 * The Walls variant's kinds, its sub-row in the Build panel: a plain wall (room detection
 * sides it exterior or interior), an invisible wall, or a railing.
 */
export type WallKind = 'standard' | WallLineKind

export const WALL_KINDS: ReadonlyArray<{ id: WallKind; label: MessageDescriptor }> = [
  {
    id: 'standard',
    label: /* i18n */ { id: 'editor.lib.wallDrawVariant.kind.standard', message: 'Standard' },
  },
  {
    id: 'invisible',
    label: /* i18n */ { id: 'editor.lib.wallDrawVariant.kind.invisible', message: 'Invisible' },
  },
  {
    id: 'railing',
    label: /* i18n */ { id: 'editor.lib.wallDrawVariant.kind.railing', message: 'Railing' },
  },
]

/** The line an invisible wall's draft is drawn at, metres. */
export const INVISIBLE_WALL_DRAFT_THICKNESS = 0.01

// Session-only, so it lives beside the persisted editor store, not in it.
const useWallLineKindStore = create<{ lineKind: WallLineKind | null }>(() => ({
  lineKind: null,
}))

export function getWallLineKind(): WallLineKind | null {
  return useWallLineKindStore.getState().lineKind
}

/** The kind the Walls variant draws, for the Build panel's sub-row. */
export function useWallKind(): WallKind {
  return useWallLineKindStore((state) => state.lineKind ?? 'standard')
}

/**
 * Pick what the Walls variant draws, for this session: it lasts while the wall tool draws
 * Walls (`subscribeWallKindReset`). Switching while the tool is armed drops the in-flight
 * draft, so a half-drawn wall never lands as another kind.
 */
export function selectWallKind(kind: WallKind): void {
  const lineKind = kind === 'standard' ? null : kind
  if (getWallLineKind() === lineKind) return
  const editor = useEditor.getState()
  if (editor.mode === 'build' && editor.tool === 'wall') emitter.emit('tool:cancel')
  useWallLineKindStore.setState({ lineKind })
}

/** Back to plain walls once the wall tool is left or draws another variant. */
export function subscribeWallKindReset(): () => void {
  return useEditor.subscribe((state) => {
    if (
      state.mode === 'build' &&
      state.tool === 'wall' &&
      state.getContinuation('wall') === 'single'
    )
      return
    if (getWallLineKind() !== null) useWallLineKindStore.setState({ lineKind: null })
  })
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

/**
 * The thickness the wall tool's drafts draw at: an invisible wall's line, a railing's, a
 * placed preset's (`toolDefaults.wall`), else `fallback` (a plain wall).
 */
export function useWallDraftThickness(fallback: number): number {
  const lineKind = useWallLineKindStore((state) => state.lineKind)
  const seeded = useEditor((state) => state.toolDefaults.wall?.thickness)
  if (lineKind === 'invisible') return INVISIBLE_WALL_DRAFT_THICKNESS
  if (lineKind === 'railing') return railingWallDefaults().thickness
  return typeof seeded === 'number' ? seeded : fallback
}
