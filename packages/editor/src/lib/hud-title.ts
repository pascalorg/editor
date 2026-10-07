import { type IconRef, nodeRegistry, type TerrainVerb } from '@pascal-app/core'
import type { ContinuationMode } from './continuation'
import { getWallDrawVariantInfo, wallDrawVariantOf } from './wall-draw-variant'

/** The contextual helper panel's header: what is in hand, and its key. */
export type HudTitle = {
  label: string
  icon?: IconRef
  shortcut?: string
}

const url = (src: string): IconRef => ({ kind: 'url', src })

/** Tools with a global arming key (`use-keyboard.ts`). */
const TOOL_SHORTCUTS: Record<string, string> = {
  wall: 'B',
  measurement: 'M',
}

export const SELECT_HUD_TITLE: HudTitle = {
  label: 'Select',
  icon: url('/icons/select.webp'),
  shortcut: 'V',
}
export const PAINT_HUD_TITLE: HudTitle = { label: 'Paint', icon: url('/icons/paint.webp') }
export const ERASE_HUD_TITLE: HudTitle = {
  label: 'Erase',
  icon: { kind: 'iconify', name: 'lucide:eraser' },
}
export const PICK_MATERIAL_HUD_TITLE: HudTitle = {
  label: 'Pick material',
  icon: { kind: 'iconify', name: 'lucide:pipette' },
}
export const ROTATE_HUD_TITLE: HudTitle = { label: 'Rotate', icon: url('/icons/rotate.webp') }
export const MOVE_SELECTION_HUD_TITLE: HudTitle = {
  label: 'Move selection',
  icon: url('/icons/pan.webp'),
}
export const MOVE_ROOM_HUD_TITLE: HudTitle = { label: 'Move room', icon: url('/icons/room.webp') }
export const RESIZE_HUD_TITLE: HudTitle = {
  label: 'Resize',
  icon: url('/icons/resize.webp'),
}
export const DIVIDE_ROOM_HUD_TITLE: HudTitle = {
  label: 'Divide room',
  icon: url('/icons/divide-room.webp'),
}
export const MEZZANINE_HUD_TITLE: HudTitle = {
  label: 'Mezzanine',
  icon: url('/icons/mezzanine.webp'),
}
export const OPENING_HUD_TITLE: HudTitle = {
  label: 'Cut opening',
  icon: { kind: 'iconify', name: 'lucide:square-dashed' },
}
export const TERRACE_HUD_TITLE: HudTitle = {
  label: 'Terrace',
  icon: url('/icons/floor.webp'),
}
export const SMART_MEASURE_HUD_TITLE: HudTitle = {
  label: 'Smart measure',
  icon: url('/icons/measure.webp'),
  shortcut: 'M',
}

const PAINT_REGION_LABELS = {
  rectangle: 'Paint a rectangle',
  polygon: 'Paint a shape',
} as const

export function paintRegionHudTitle(mode: keyof typeof PAINT_REGION_LABELS): HudTitle {
  return { label: PAINT_REGION_LABELS[mode], icon: url('/icons/paint.webp') }
}

export function terrainHudTitle(verb: TerrainVerb): HudTitle {
  const label =
    verb === 'raise'
      ? 'Raise terrain'
      : verb === 'lower'
        ? 'Lower terrain'
        : verb === 'flatten'
          ? 'Level terrain'
          : 'Smooth terrain'
  return { label, icon: url(`/icons/terrain-${verb}.webp`) }
}

/** A kind's registry name and icon, optionally behind a verb ("Move door"). */
export function nodeKindHudTitle(kind: string, verb?: string): HudTitle | null {
  const presentation = nodeRegistry.get(kind)?.presentation
  if (!presentation) return null
  const name = presentation.label
  return {
    label: verb ? `${verb} ${name.toLowerCase()}` : name,
    icon: presentation.icon,
    shortcut: verb ? undefined : TOOL_SHORTCUTS[kind],
  }
}

/**
 * The armed build tool. The wall tool is named after the Rooms variant it draws
 * (Rectangle room / Polygon room / Walls) — the tile the user picked.
 */
export function toolHudTitle(tool: string, wallMode: ContinuationMode): HudTitle | null {
  if (tool === 'wall') {
    const variant = getWallDrawVariantInfo(wallDrawVariantOf(wallMode))
    return { label: variant.title, icon: url(variant.iconSrc), shortcut: TOOL_SHORTCUTS.wall }
  }
  return nodeKindHudTitle(tool)
}
