import {
  type IconRef,
  type MessageDescriptor,
  nodeRegistry,
  type TerrainVerb,
} from '@pascal-app/core'
import { nodeLabelDescriptor } from '../i18n/node-messages'
import type { ContinuationMode } from './continuation'
import { getWallDrawVariantInfo, wallDrawVariantOf } from './wall-draw-variant'

/** The contextual helper panel's header: what is in hand, and its key. */
export type HudTitle = {
  /** May use `{kind}`, filled with the translated, lower-cased name of `kind`. */
  label: MessageDescriptor
  /** The node kind whose display name the label refers to. */
  kind?: { kind: string; english: string }
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
  label: /* i18n */ { id: 'editor.lib.hudTitle.select', message: 'Select' },
  icon: url('/icons/select.webp'),
  shortcut: 'V',
}
export const PAINT_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.paint', message: 'Paint' },
  icon: url('/icons/paint.webp'),
}
export const ERASE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.erase', message: 'Erase' },
  icon: { kind: 'iconify', name: 'lucide:eraser' },
}
export const PICK_MATERIAL_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.pickMaterial', message: 'Pick material' },
  icon: { kind: 'iconify', name: 'lucide:pipette' },
}
export const ROTATE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.rotate', message: 'Rotate' },
  icon: url('/icons/rotate.webp'),
}
export const MOVE_SELECTION_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.moveSelection', message: 'Move selection' },
  icon: url('/icons/pan.webp'),
}
export const MOVE_ROOM_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.moveRoom', message: 'Move room' },
  icon: url('/icons/room.webp'),
}
export const RESIZE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.resize', message: 'Resize' },
  icon: url('/icons/resize.webp'),
}
export const DIVIDE_ROOM_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.divideRoom', message: 'Divide room' },
  icon: url('/icons/divide-room.webp'),
}
export const MEZZANINE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.mezzanine', message: 'Mezzanine' },
  icon: url('/icons/mezzanine.webp'),
}
export const OPENING_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.cutOpening', message: 'Cut opening' },
  icon: { kind: 'iconify', name: 'lucide:square-dashed' },
}
export const TERRACE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.terrace', message: 'Terrace' },
  icon: url('/icons/floor.webp'),
}
export const SMART_MEASURE_HUD_TITLE: HudTitle = {
  label: /* i18n */ { id: 'editor.lib.hudTitle.smartMeasure', message: 'Smart measure' },
  icon: url('/icons/measure.webp'),
  shortcut: 'M',
}

const PAINT_REGION_LABELS = {
  rectangle: /* i18n */ { id: 'editor.lib.hudTitle.paintARectangle', message: 'Paint a rectangle' },
  polygon: /* i18n */ { id: 'editor.lib.hudTitle.paintAShape', message: 'Paint a shape' },
} as const

export function paintRegionHudTitle(mode: keyof typeof PAINT_REGION_LABELS): HudTitle {
  return { label: PAINT_REGION_LABELS[mode], icon: url('/icons/paint.webp') }
}

export function terrainHudTitle(verb: TerrainVerb): HudTitle {
  const label =
    verb === 'raise'
      ? /* i18n */ { id: 'editor.lib.hudTitle.raiseTerrain', message: 'Raise terrain' }
      : verb === 'lower'
        ? /* i18n */ { id: 'editor.lib.hudTitle.lowerTerrain', message: 'Lower terrain' }
        : verb === 'flatten'
          ? /* i18n */ { id: 'editor.lib.hudTitle.levelTerrain', message: 'Level terrain' }
          : /* i18n */ { id: 'editor.lib.hudTitle.smoothTerrain', message: 'Smooth terrain' }
  return { label, icon: url(`/icons/terrain-${verb}.webp`) }
}

const KIND_VERBS = {
  edit: /* i18n */ { id: 'editor.lib.hudTitle.editKind', message: 'Edit {kind}' },
  move: /* i18n */ { id: 'editor.lib.hudTitle.moveKind', message: 'Move {kind}' },
  split: /* i18n */ { id: 'editor.lib.hudTitle.splitKind', message: 'Split {kind}' },
} as const

/** A kind's registry name and icon, optionally behind a verb ("Move door"). */
export function nodeKindHudTitle(kind: string, verb?: keyof typeof KIND_VERBS): HudTitle | null {
  const presentation = nodeRegistry.get(kind)?.presentation
  if (!presentation) return null
  return {
    label: verb ? KIND_VERBS[verb] : nodeLabelDescriptor(kind, presentation.label),
    kind: verb ? { kind, english: presentation.label } : undefined,
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
