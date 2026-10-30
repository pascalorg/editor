'use client'

import {
  type AnyNode,
  type AnyNodeId,
  BEAM_SIZE_PRESETS,
  floorFootprintSupportClass,
  formatList,
  floorPlateAtGroundContact,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
  type MessageDescriptor,
  type OutdoorRoomType,
  type PorchFramingSettings,
  porchFramingSettings,
  porchPartOf,
  roomDrawnFloor,
  setZoneIntent,
  type PascalI18n,
  useLocale,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { startCeilingEdit } from '../../../lib/ceiling-edit-session'
import {
  applyRoomFloorConstruction,
  floorLift,
  foundationHeight,
  openFloorFoundation,
  roomFloorOwner,
  roomFootprint,
} from '../../../lib/floor-footprints'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { startMezzanineDraft } from '../../../lib/mezzanine-draft'
import { resolveRoomAssemblyHeights } from '../../../lib/room-assembly-overlay'
import { type FloorChoice, roomBuiltOn, separateFloorSummary } from '../../../lib/room-built-on'
import type { RoomConstructionState } from '../../../lib/room-construction'
import { roomConstructionState } from '../../../lib/room-construction'
import {
  addRoomConstruction,
  adoptExistingCeiling,
  floorHeightRefusalText,
  lockRoomOutsideFaces,
  type RoomConstructionPart,
  type RoomConstructionResult,
  removeRoomConstruction,
  replaceRoomCeiling,
  roomFloorBase,
  roomOutsideFacesLocked,
  roomRelativeFloorHeight,
  separateFloorOffset,
  setRoomFloor,
  setRoomRelativeFloorHeight,
  unlockRoomOutsideFaces,
} from '../../../lib/room-construction-commands'
import { ownFloorElevationBounds } from '../../../lib/room-handle-drag'
import type { RoomSelectionRecord } from '../../../lib/room-selection'
import { cn } from '../../../lib/utils'
import { applyRoomPlan } from '../../../lib/room-structure-commands'
import { MetricControl } from '../controls/metric-control'
import { SegmentedControl } from '../controls/segmented-control'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { Switch } from '../primitives/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { localizedFloorFootprintName } from '../../../i18n/floor-footprint-name'
import { messageWithSlot } from '../../../i18n/message-slot'
import { nodeLabel } from '../../../i18n/node-messages'
import { DeckBoardsFields } from './deck-boards-fields'
import { RoomOpeningsField } from './room-openings-field'
import { ShapeChoice } from './shape-choice'
import { displayRoomName } from '../../../lib/room-name-messages'

/** The buttons a row offers — derived together with its presence. */
export function constructionActions(state: RoomConstructionState, part: RoomConstructionPart) {
  return state[part].actions
}

/**
 * The Walls switch reads three ways. A full ring is on and a click takes the
 * room's own walls away (shared ones stay); a partial ring shows half on and
 * a click closes every open side; no walls is off and a click builds them.
 */
export function wallsSwitch(state: RoomConstructionState) {
  const { state: presence, actions } = state.walls
  const full = presence === 'present'
  return {
    checked: full,
    mixed: presence === 'partial',
    command: full ? ('remove' as const) : ('add' as const),
    disabled: full ? !actions.remove : !actions.add,
  }
}

/** A "Built on" choice in the UI language: its plate's footprint name, or the shared floor. */
function floorChoiceName(
  nodes: Readonly<Record<string, AnyNode>>,
  choice: Pick<FloorChoice, 'plateId' | 'name'>,
  i18n: PascalI18n,
): string {
  const plate = choice.plateId ? nodes[choice.plateId] : undefined
  if (plate?.type === 'slab') return localizedFloorFootprintName(nodes, plate, i18n)
  return choice.plateId
    ? choice.name
    : i18n._({ id: 'editor.floorFootprint.shared', message: 'Shared floor' })
}

export const pill =
  'rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50'


/**
 * One "Built with" row: its icon, name and one-line summary, a chevron that
 * opens its settings, and the switch (or button) on the right. An excluded
 * part reads "Not included" and has nothing to open.
 */
export function ConstructionPart({
  part,
  label,
  icon,
  on,
  meta,
  expanded,
  onToggleExpanded,
  control,
  footer,
  children,
}: {
  part: string
  label: string
  icon: string
  on: boolean
  meta: string
  expanded: boolean
  onToggleExpanded: () => void
  /** The switch, or a button, at the end of the row. */
  control?: ReactNode
  /** Always shown under the row (open or not). */
  footer?: ReactNode
  /** The settings the chevron opens; none means the row does not open. */
  children?: ReactNode
}) {
  const i18n = usePascalI18n()
  const opens = on && !!children
  const open = opens && expanded
  return (
    <div
      className={cn(
        'rounded-lg bg-accent/30 transition-colors hover:bg-accent/50',
        open && 'bg-accent/50',
      )}
      data-construction-row={part}
      data-expanded={open || undefined}
    >
      <div className="flex items-center gap-1 pr-2.5">
        <button
          aria-expanded={opens ? open : undefined}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-1 pl-2.5 text-left disabled:cursor-default"
          disabled={!opens}
          onClick={onToggleExpanded}
          type="button"
        >
          <Image
            alt=""
            className={cn('shrink-0 object-contain', !on && 'opacity-40')}
            height={20}
            src={icon}
            width={20}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-[13px] text-foreground">{label}</span>
            <span className="text-pretty text-muted-foreground text-xs">
              {on ? meta : i18n._({ id: 'editor.panels.roomConstructionRows.notIncluded', message: 'Not included' })}
            </span>
          </span>
          {opens && (
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90',
              )}
            />
          )}
        </button>
        {control}
      </div>
      {footer}
      {open && (
        <div className="flex flex-col gap-2 pr-2.5 pb-3 pl-[42px] text-muted-foreground text-xs">
          {children}
        </div>
      )}
    </div>
  )
}

/** A label and its value (or control) on one line inside an open row. */
export function PartField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  )
}

/**
 * The room floor's height above the floor it stands on (its footprint's floor;
 * for a mezzanine, the room below): typing 0.15 on a raised house lifts the
 * room 15 cm above the house floor. A refused height says why, right here.
 */
export function FloorHeightField({
  zoneId,
  bounds,
}: {
  zoneId: string
  /** Allowed heights, in the same relative terms. */
  bounds?: { min: number; max: number } | null
}) {
  const i18n = usePascalI18n()
  const height = useScene((scene) => roomRelativeFloorHeight(scene.nodes, zoneId))
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const [draft, setDraft] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <MetricControl
        className="h-8 text-xs"
        label={i18n._({ id: 'editor.panels.roomConstructionRows.height', message: 'Height' })}
        max={bounds?.max}
        min={bounds?.min ?? -3}
        onChange={setDraft}
        onCommit={(value) => {
          setDraft(null)
          if (Math.abs(value - height) <= 1e-6) return
          const result = setRoomRelativeFloorHeight(zoneId, value)
          setError(result.status === 'conflict' ? floorHeightRefusalText(result, length) : null)
        }}
        precision={2}
        step={0.05}
        unit="m"
        value={draft ?? height}
      />
      {error && (
        <p className="text-destructive text-xs" data-floor-height-error role="status">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A room standing on a drawn slab has no height of its own — the slab's
 * elevation is the floor's — so instead of a height it names that slab (and
 * how many other rooms stand on it) and selects it, as the tree would.
 */
export function DrawnFloorRow({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const floor = useScene(
    useShallow((scene) => {
      const drawn = roomDrawnFloor(scene.nodes, zoneId)
      if (!drawn) return null
      const slab = scene.nodes[drawn.slabId as AnyNodeId]
      return {
        id: drawn.slabId,
        name: (slab?.type === 'slab' && slab.name?.trim()) || 'Slab',
        shared: drawn.sharedZoneIds.length,
        ambiguous: drawn.ambiguous,
      }
    }),
  )
  if (!floor) return null
  return (
    <div className="flex min-h-7 items-center justify-between gap-3" data-drawn-floor={floor.id}>
      <span className="min-w-0">
        {messageWithSlot(
          i18n,
          /* i18n */ {
            id: 'editor.panels.roomConstructionRows.drawnFloor',
            message:
              '{ambiguous, select, yes {Floor is several drawn slabs, mostly {name}} other {Floor is a drawn slab: {name}}}{shared, plural, =0 {} one { (shared with {sharedCount} room)} other { (shared with {sharedCount} rooms)}}',
            values: {
              ambiguous: floor.ambiguous ? 'yes' : 'no',
              shared: floor.shared,
              sharedCount: String(floor.shared),
            },
          },
          'name',
          <span className="text-foreground">{floor.name}</span>,
        )}
      </span>
      <button
        className={cn(pill, 'shrink-0')}
        data-select-drawn-floor
        onClick={() => openFloorFoundation(floor.id)}
        type="button"
      >
        {i18n._({ id: 'editor.panels.roomConstructionRows.select', message: 'Select' })}
      </button>
    </div>
  )
}

/**
 * "Built on: Shared floor ▾" — the floor the room stands on, picked from the
 * floors it touches on its level (each by its footprint name: "Shared floor",
 * "Lanai floor", a name the user gave it) or a new floor of its own. Hidden
 * where there is no choice (see `roomBuiltOn`). A refused move says why,
 * right here.
 */
export function BuiltOnField({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const nodes = useScene((scene) => scene.nodes)
  const model = useMemo(() => roomBuiltOn(nodes, zoneId), [nodes, zoneId])
  const [error, setError] = useState<string | null>(null)
  if (!model) return null
  const choose = (key: string | null) => {
    const result = setRoomFloor(zoneId, key)
    setError(result.status === 'conflict' ? result.message : null)
  }
  return (
    <div className="flex flex-col gap-1" data-built-on={model.current.key ?? 'shared'}>
      <PartField label={i18n._({ id: 'editor.panels.roomConstructionRows.builtOn', message: 'Built on' })}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={i18n._({ id: 'editor.panels.roomConstructionRows.builtOn', message: 'Built on' })}
              className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-0.5 text-foreground text-xs transition-colors hover:bg-accent"
              data-built-on-trigger
              type="button"
            >
              <span className="truncate">{floorChoiceName(nodes, model.current, i18n)}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {model.choices.map((choice) => (
              <DropdownMenuItem
                data-built-on-choice={choice.key ?? 'shared'}
                key={choice.plateId ?? 'shared'}
                onSelect={() => {
                  if (choice.plateId !== model.current.plateId) choose(choice.key)
                }}
              >
                <span className="flex-1 truncate">{floorChoiceName(nodes, choice, i18n)}</span>
                {choice.plateId === model.current.plateId && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-built-on-choice="new" onSelect={() => choose('new')}>
              {i18n._({ id: 'editor.panels.roomConstructionRows.newFloor', message: '+ New floor' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PartField>
      {error && (
        <p className="text-destructive text-xs" data-built-on-error role="status">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * How tall the room is inside: floor to its ceiling, or to its walls' tops
 * without one. Null when neither exists.
 */
export function roomInsideHeight(
  room: RoomSelectionRecord,
  nodes: Record<string, import('@pascal-app/core').AnyNode>,
): { floor: number; ceiling: number | null; height: number | null } {
  const { floorY, wallTops, ceiling } = resolveRoomAssemblyHeights(room, nodes)
  const top = ceiling?.y ?? (wallTops.size ? Math.max(...wallTops.values()) : null)
  return {
    floor: floorY,
    ceiling: ceiling ? ceiling.y - floorY : null,
    height: top === null ? null : top - floorY,
  }
}

/**
 * "Sits on: Shared floor · Raised 0.30 m ›" — what the room's floor is built
 * as and how it stands, opening its panel: the footprint's Floor & foundation
 * (a room on its own floor, its own plate: "Lanai floor"), or the drawn slab
 * the floor was taken from ("· Drawn slab"). A room without a floor says so
 * rather than naming the footprint next to it.
 */
function SitsOn({ zoneId, noFloor }: { zoneId: string; noFloor: boolean }) {
  const i18n = usePascalI18n()
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const summary = useScene(
    useShallow((scene) => {
      const plate = roomFloorOwner(scene.nodes, zoneId) ?? roomFootprint(scene.nodes, zoneId)
      if (!plate) return { id: '', name: '', drawn: false, lift: 0, supported: false }
      if (plate.plateRole !== 'base')
        return {
          id: plate.id as string,
          name: plate.name?.trim() || nodeLabel('slab', 'Slab', i18n),
          drawn: true,
          lift: 0,
          supported: false,
        }
      return {
        id: plate.id as string,
        name: localizedFloorFootprintName(scene.nodes, plate, i18n),
        drawn: false,
        ...footprintStanding(scene.nodes, plate),
      }
    }),
  )
  const lift = formatLinearMeasurement(Math.abs(summary.lift), unit, metricNotation)
  const preset = summary.drawn
    ? i18n._({ id: 'editor.panels.roomConstructionRows.drawnSlab', message: 'Drawn slab' })
    : Math.abs(summary.lift) > 0.005
      ? summary.lift > 0
        ? i18n._({ id: 'editor.panels.roomConstructionRows.raised', message: 'Raised {lift}', values: { lift } })
        : i18n._({ id: 'editor.panels.roomConstructionRows.lowered', message: 'Lowered {lift}', values: { lift } })
      : summary.supported
        ? i18n._({ id: 'editor.panels.roomConstructionRows.onTheWallsBelow', message: 'On the walls below' })
        : i18n._({ id: 'editor.panels.roomConstructionRows.onTheGround', message: 'On the ground' })
  if (noFloor)
    return (
      <span className="mb-2 ml-[42px] text-muted-foreground text-xs" data-sits-on="none">
        {i18n._({ id: 'editor.panels.roomConstructionRows.noFloor', message: 'No floor' })}
      </span>
    )
  if (!summary.id) return null
  return (
    <button
      className="mb-2 ml-[42px] flex items-center gap-1 text-left text-muted-foreground text-xs transition-colors hover:text-foreground"
      data-sits-on={summary.id}
      onClick={() => openFloorFoundation(summary.id)}
      type="button"
    >
      <span>
        {messageWithSlot(
          i18n,
          /* i18n */ {
            id: 'editor.panels.roomConstructionRows.sitsOnPreset',
            message: 'Sits on: {name} · {preset}',
            values: { preset },
          },
          'name',
          <span className="text-foreground">{summary.name}</span>,
        )}
      </span>
      <ChevronRight className="size-3 shrink-0" />
    </button>
  )
}

const ROOM_TYPE_OPTIONS: ReadonlyArray<{
  label: MessageDescriptor
  value: 'room' | OutdoorRoomType
}> = [
  {
    label: /* i18n */ { id: 'editor.panels.roomConstructionRows.roomTypeRoom', message: 'Room' },
    value: 'room',
  },
  {
    label: /* i18n */ { id: 'editor.panels.roomConstructionRows.roomTypePorch', message: 'Porch' },
    value: 'porch',
  },
  {
    label: /* i18n */ { id: 'editor.panels.roomConstructionRows.roomTypeDeck', message: 'Deck' },
    value: 'deck',
  },
  {
    label: /* i18n */ { id: 'editor.panels.roomConstructionRows.roomTypePatio', message: 'Patio' },
    value: 'patio',
  },
]

const ROOM_TYPE_HINTS: Record<'room' | OutdoorRoomType, MessageDescriptor> = {
  room: /* i18n */ {
    id: 'editor.panels.roomConstructionRows.roomTypeRoomHint',
    message: 'An ordinary room inside the house.',
  },
  porch: /* i18n */ {
    id: 'editor.panels.roomConstructionRows.roomTypePorchHint',
    message:
      'Outdoors under a ceiling: a concrete slab 1½ in down from the house, ceiling at the house’s.',
  },
  deck: /* i18n */ {
    id: 'editor.panels.roomConstructionRows.roomTypeDeckHint',
    message:
      'Outdoors: deck boards on a wood frame and posts, 1 in down from the house; no ceiling.',
  },
  patio: /* i18n */ {
    id: 'editor.panels.roomConstructionRows.roomTypePatioHint',
    message: 'Outdoors and open: a concrete slab 1½ in down from the house, no ceiling.',
  },
}

/**
 * "Room | Porch | Deck | Patio": the room type (`roomType`, through core's
 * `setZoneIntent`). A porch, deck or patio is outdoors whatever covers it, steps its floor down
 * from the house's and takes its floor and ceiling defaults in the same step; each stays
 * adjustable below.
 */
export function RoomTypeChoice({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const value = useScene((scene) => {
    const zone = scene.nodes[zoneId as AnyNodeId]
    return zone?.type === 'zone' ? (zone.roomType ?? 'room') : null
  })
  if (!value) return null
  return (
    <div className="mt-3 flex flex-col gap-1" data-room-type={value}>
      <h3 className="font-medium text-muted-foreground text-xs">
        {i18n._({ id: 'editor.panels.roomConstructionRows.roomType', message: 'Room type' })}
      </h3>
      <SegmentedControl
        onChange={(next: 'room' | OutdoorRoomType) =>
          applyRoomPlan(
            setZoneIntent(useScene.getState().nodes, {
              zoneId,
              patch: { roomType: next === 'room' ? null : next },
            }),
          )
        }
        options={ROOM_TYPE_OPTIONS.map((option) => ({
          label: i18n._(option.label),
          value: option.value,
        }))}
        value={value}
      />
      <p className="text-muted-foreground text-xs">{i18n._(ROOM_TYPE_HINTS[value])}</p>
    </div>
  )
}

const POST_SIZE_OPTIONS: ReadonlyArray<{
  label: string
  value: PorchFramingSettings['postSize']
}> = [
  { label: '4x4', value: '4x4' },
  { label: '6x6', value: '6x6' },
  { label: '8x8', value: '8x8' },
]

type PorchFramingMode = 'off' | 'auto' | 'manual'

/**
 * A covered porch's posts and beam (`porchFraming`, through core's `setZoneIntent`), and a deck's
 * or patio's once switched on, to carry a roof over it (Off by default): while Automatic the
 * structure kernel keeps a post on each outside corner, more at most the spacing apart, and a beam
 * along each open side under the ceiling. A size or the spacing rebuilds them; a post or beam
 * edited by hand turns the room to Manual, and Automatic rebuilds them again.
 */
export function PorchFramingFields({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const porch = useScene(
    useShallow((scene) => {
      const zone = scene.nodes[zoneId as AnyNodeId]
      if (zone?.type !== 'zone') return null
      const optional = zone.roomType === 'deck' || zone.roomType === 'patio'
      if (!(optional || (zone.roomType === 'porch' && zone.hasCeiling !== false))) return null
      const level = zone.parentId ? scene.nodes[zone.parentId as AnyNodeId] : undefined
      let posts = 0
      let beams = 0
      for (const id of level?.type === 'level' ? level.children : []) {
        const node = scene.nodes[id as AnyNodeId]
        if (porchPartOf(node)?.porchOf !== zoneId) continue
        if (node?.type === 'column') posts++
        else beams++
      }
      const auto = zone.porchFraming?.auto
      const mode: PorchFramingMode =
        auto === false ? 'manual' : optional && auto !== true ? 'off' : 'auto'
      return {
        mode,
        optional,
        room: zone.roomType ?? 'porch',
        ...porchFramingSettings(zone),
        posts,
        beams,
      }
    }),
  )
  const [spacing, setSpacing] = useState<number | null>(null)
  if (!porch) return null
  const set = (porchFraming: NonNullable<Parameters<typeof setZoneIntent>[1]['patch']['porchFraming']>) =>
    applyRoomPlan(setZoneIntent(useScene.getState().nodes, { zoneId, patch: { porchFraming } }))
  const beam = BEAM_SIZE_PRESETS.find((preset) => preset.id === porch.beamSize)
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-porch-framing={porch.mode}>
      <h3 className="font-medium text-muted-foreground text-xs">
        {i18n._({ id: 'editor.panels.roomConstructionRows.postsAndBeam', message: 'Posts and beam' })}
      </h3>
      <SegmentedControl
        onChange={(next: PorchFramingMode) =>
          set({ auto: next === 'off' ? null : next === 'auto' })
        }
        options={[
          ...(porch.optional
            ? [
                {
                  label: i18n._({
                    id: 'editor.panels.roomConstructionRows.framingOff',
                    message: 'Off',
                  }),
                  value: 'off' as const,
                },
              ]
            : []),
          {
            label: i18n._({
              id: 'editor.panels.roomConstructionRows.framingAutomatic',
              message: 'Automatic',
            }),
            value: 'auto' as const,
          },
          {
            label: i18n._({
              id: 'editor.panels.roomConstructionRows.framingManual',
              message: 'Manual',
            }),
            value: 'manual' as const,
          },
        ]}
        value={porch.mode}
      />
      <p className="text-muted-foreground text-xs">
        {porch.mode === 'off'
          ? i18n._({
              id: 'editor.panels.roomConstructionRows.framingOffHint',
              message:
                'None. Automatic puts a post on each outside corner and a beam on them, to carry a roof over {room, select, deck {the deck} patio {the patio} other {the porch}}.',
              values: { room: porch.room },
            })
          : porch.mode === 'auto'
            ? i18n._({
                id: 'editor.panels.roomConstructionRows.framingAutoHint',
                message:
                  '{posts, plural, one {{postCount} post} other {{postCount} posts}} and {beams, plural, one {{beamCount} beam} other {{beamCount} beams}}, a post on each outside corner, kept with {room, select, deck {the deck} patio {the patio} other {the porch}}.',
                values: {
                  posts: porch.posts,
                  postCount: String(porch.posts),
                  beams: porch.beams,
                  beamCount: String(porch.beams),
                  room: porch.room,
                },
              })
            : i18n._({
                id: 'editor.panels.roomConstructionRows.framingManualHint',
                message: 'Kept as you edited them. Automatic rebuilds them from these settings.',
              })}
      </p>
      {porch.mode !== 'off' && (
        <>
          <PartField
            label={i18n._({ id: 'editor.panels.roomConstructionRows.postSize', message: 'Post size' })}
          >
            <SegmentedControl
              onChange={(postSize: PorchFramingSettings['postSize']) => set({ postSize })}
              options={[...POST_SIZE_OPTIONS]}
              value={porch.postSize}
            />
          </PartField>
          <MetricControl
            className="h-8 text-xs"
            label={i18n._({
              id: 'editor.panels.roomConstructionRows.postSpacingMax',
              message: 'Post spacing (max)',
            })}
            max={6}
            min={0.6}
            onChange={setSpacing}
            onCommit={(value) => {
              setSpacing(null)
              if (Math.abs(value - porch.postSpacing) > 1e-6) set({ postSpacing: value })
            }}
            precision={2}
            step={0.05}
            unit="m"
            value={spacing ?? porch.postSpacing}
          />
          <PartField
            label={i18n._({ id: 'editor.panels.roomConstructionRows.beam', message: 'Beam' })}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={i18n._({
                    id: 'editor.panels.roomConstructionRows.beamSize',
                    message: 'Beam size',
                  })}
                  className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-0.5 text-foreground text-xs transition-colors hover:bg-accent"
                  data-porch-beam-size
                  type="button"
                >
                  <span className="truncate">{beam?.label ?? porch.beamSize}</span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 min-w-40 overflow-y-auto">
                {BEAM_SIZE_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    data-porch-beam-choice={preset.id}
                    key={preset.id}
                    onSelect={() => {
                      if (preset.id !== porch.beamSize) set({ beamSize: preset.id })
                    }}
                  >
                    <span className="flex-1 truncate">{preset.label}</span>
                    {preset.id === porch.beamSize && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </PartField>
        </>
      )}
    </div>
  )
}

/**
 * The room's floor construction, edited from the room: its thickness, through
 * core's `setRoomFloorConstruction` (the command MCP uses too), on whatever the
 * floor is built as. A drawn slab takes thickness and finishes only — it has
 * no footprint height or foundation, and says so.
 */
export function RoomFloorConstructionField({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const owner = useScene(
    useShallow((scene) => {
      // Several drawn slabs show in the room: no one thickness to edit here.
      if (roomDrawnFloor(scene.nodes, zoneId)?.ambiguous) return null
      const plate = roomFloorOwner(scene.nodes, zoneId)
      return plate
        ? {
            id: plate.id as string,
            thickness: plate.thickness,
            drawn: plate.plateRole !== 'base',
            // A slab on the ground has nothing under it to z-fight; it may be thinner.
            min:
              plate.plateRole === 'base' && floorPlateAtGroundContact(scene.nodes, plate)
                ? MIN_GROUND_FLOOR_THICKNESS
                : MIN_SLAB_THICKNESS,
          }
        : null
    }),
  )
  const [draft, setDraft] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!owner) return null
  return (
    <div className="flex flex-col gap-1" data-room-floor-construction={owner.id}>
      <MetricControl
        className="h-8 text-xs"
        label={i18n._({ id: 'editor.panels.roomConstructionRows.floorThickness', message: 'Floor thickness' })}
        max={1}
        min={owner.min}
        onChange={setDraft}
        onCommit={(value) => {
          setDraft(null)
          if (Math.abs(value - owner.thickness) <= 1e-6) return
          setError(applyRoomFloorConstruction(zoneId, { thickness: value }, owner.id))
        }}
        precision={2}
        step={0.01}
        unit="m"
        value={draft ?? owner.thickness}
      />
      {owner.drawn && (
        <p data-drawn-slab-note>
          {i18n._({ id: 'editor.panels.roomConstructionRows.aDrawnSlabSetItsThickness', message: 'A drawn slab: set its thickness and finishes here. It has no footprint height or foundation.' })}
        </p>
      )}
      {error && (
        <p className="text-destructive text-xs" data-floor-construction-error role="status">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * How a footprint stands: on the ground, its foundation height ("Raised 0.30 m"
 * or on the ground); upstairs, its lift above resting on the walls below.
 */
function footprintStanding(
  nodes: Record<string, import('@pascal-app/core').AnyNode>,
  plate: import('@pascal-app/core').SlabNode,
) {
  const supported = floorFootprintSupportClass(nodes, plate) === 'supported'
  return {
    supported,
    lift: supported ? floorLift(nodes, plate) : foundationHeight(nodes, plate),
  }
}

/** Rooms sharing any of `wallIds` with `zoneId`, by name. */
function sharingRoomNames(
  nodes: Record<string, import('@pascal-app/core').AnyNode>,
  zoneId: string,
  wallIds: readonly string[],
) {
  return Object.values(nodes).flatMap((node) =>
    node.type === 'zone' &&
    node.id !== zoneId &&
    node.spaceRole === 'room' &&
    node.boundaryWallIds.some((id) => wallIds.includes(id))
      ? [node.name?.trim() ?? '']
      : [],
  )
}

/**
 * "Built with": the room's floor, walls and ceiling, each included or not
 * with its switch, and its settings a chevron away. Then Add mezzanine.
 */
export function RoomConstructionRows({ room }: { room: RoomSelectionRecord }) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const zoneId = room.zoneId
  const state = useScene((scene) => roomConstructionState(scene.nodes, zoneId))
  const nodes = useScene((scene) => scene.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [expanded, setExpanded] = useState<RoomConstructionPart | null>(null)
  const [message, setMessage] = useState<{ text: string; conflict: boolean } | null>(null)
  if (!state) return null
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const report = (
    result: RoomConstructionResult,
    unchanged = i18n._({ id: 'editor.panels.roomConstructionRows.nothingToChange', message: 'Nothing to change.' }),
  ) =>
    setMessage(
      result.status === 'conflict'
        ? { text: result.message, conflict: true }
        : result.status === 'unchanged'
          ? { text: unchanged, conflict: false }
          : null,
    )
  const toggle = (part: RoomConstructionPart) => () =>
    setExpanded((current) => (current === part ? null : part))
  const drawnFloor = roomDrawnFloor(nodes, zoneId)
  const partSwitch = (part: RoomConstructionPart) => {
    const { state: presence, actions } = state[part]
    if (part === 'walls') {
      const walls = wallsSwitch(state)
      return (
        <Switch
          aria-checked={walls.mixed ? 'mixed' : walls.checked}
          aria-label={i18n._({ id: 'editor.panels.roomConstructionRows.includeWalls', message: 'Include walls' })}
          checked={walls.checked}
          className={cn(
            walls.mixed && 'data-[state=unchecked]:bg-primary/45 [&>span]:translate-x-2!',
          )}
          data-walls-switch={presence}
          disabled={walls.disabled}
          onCheckedChange={() =>
            report(
              walls.command === 'remove'
                ? removeRoomConstruction(zoneId, 'walls')
                : addRoomConstruction(zoneId, 'walls'),
            )
          }
        />
      )
    }
    if (part === 'floor' && drawnFloor) {
      // A drawn-slab floor is the slab: the switch only brings back a floor
      // switched off before; the slab itself is edited or deleted on its own.
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The span takes the hover: a disabled switch gets no pointer events. */}
            <span
              className={cn('inline-flex', !actions.add && 'cursor-not-allowed')}
              data-drawn-floor-switch
            >
              <Switch
                aria-label={i18n._({ id: 'editor.panels.roomConstructionRows.includeFloor', message: 'Include floor' })}
                checked={state.floor.intent}
                className="disabled:pointer-events-none"
                disabled={!actions.add}
                onCheckedChange={() => report(addRoomConstruction(zoneId, 'floor'))}
              />
            </span>
          </TooltipTrigger>
          {!actions.add && (
            <TooltipContent side="top" sideOffset={6}>
              {i18n._({
                id: 'editor.panels.roomConstructionRows.drawnFloorSwitchHint',
                message: 'This floor is a drawn slab: select it to edit or delete it.',
              })}
            </TooltipContent>
          )}
        </Tooltip>
      )
    }
    const on = presence !== 'absent'
    return (
      <Switch
        aria-label={i18n._({
          id: 'editor.panels.roomConstructionRows.includePart',
          message: '{part, select, floor {Include floor} walls {Include walls} other {Include ceiling}}',
          values: { part },
        })}
        checked={on}
        disabled={on ? !actions.remove : !actions.add}
        onCheckedChange={(next) =>
          report(next ? addRoomConstruction(zoneId, part) : removeRoomConstruction(zoneId, part))
        }
      />
    )
  }

  const floorElevation = roomRelativeFloorHeight(nodes, zoneId)
  const drawnSlab = drawnFloor ? nodes[drawnFloor.slabId as AnyNodeId] : undefined
  const builtOn = roomBuiltOn(nodes, zoneId)
  const floorMeta =
    state.floor.state === 'partial'
      ? i18n._({
          id: 'editor.panels.roomConstructionRows.partialCovered',
          message: 'Partial · {coverage, number, percent} covered',
          values: { coverage: state.floor.coverage },
        })
      : drawnSlab?.type === 'slab'
        ? i18n._({
            id: 'editor.panels.roomConstructionRows.drawnSlabAt',
            message: 'Drawn slab at {height}',
            values: { height: length(drawnSlab.elevation) },
          })
        : builtOn && builtOn.current.key !== null
          ? separateFloorSummary(
              {
                current: { name: floorChoiceName(nodes, builtOn.current, i18n) },
                shared: builtOn.shared && { name: floorChoiceName(nodes, builtOn.shared, i18n) },
                offset: separateFloorOffset(nodes, zoneId),
              },
              length,
              i18n,
            )
          : Math.abs(floorElevation) < 0.005
            ? i18n._({ id: 'editor.panels.roomConstructionRows.atFloorLevel', message: 'At floor level' })
            : floorElevation > 0
              ? i18n._({
                  id: 'editor.panels.roomConstructionRows.floorUp',
                  message: '{distance} up',
                  values: { distance: length(Math.abs(floorElevation)) },
                })
              : i18n._({
                  id: 'editor.panels.roomConstructionRows.floorDown',
                  message: '{distance} down',
                  values: { distance: length(Math.abs(floorElevation)) },
                })
  // A room on its own floor moves within its plate's range (on the ground, its foundation's).
  const ownBounds = ownFloorElevationBounds(nodes, zoneId)
  const floorBase = ownBounds ? roomFloorBase(nodes, zoneId) : 0
  const heightBounds = ownBounds && {
    min: ownBounds.min - floorBase,
    max: ownBounds.max - floorBase,
  }

  const wallIds = room.boundaryWallIds
  const openSides = state.walls.separators.length
  const shared = sharingRoomNames(nodes, zoneId, state.walls.sharedWallIds)
  const wallsMeta =
    state.walls.state === 'partial'
      ? i18n._({
          id: 'editor.panels.roomConstructionRows.partialWalls',
          message:
            'Partial · {walls, plural, one {{wallCount} wall} other {{wallCount} walls}}, {openSides, plural, one {{openSideCount} open side} other {{openSideCount} open sides}}',
          values: {
            walls: wallIds.length,
            openSides,
            wallCount: String(wallIds.length),
            openSideCount: String(openSides),
          },
        })
      : i18n._({
          id: 'editor.panels.roomConstructionRows.wallCount',
          message: '{walls, plural, one {{wallCount} wall} other {{wallCount} walls}}',
          values: { walls: wallIds.length, wallCount: String(wallIds.length) },
        })
  const locked = roomOutsideFacesLocked(nodes, wallIds)

  const ceilingHeight = state.ceiling.ceilingId ? roomInsideHeight(room, nodes).ceiling : null
  const ceilingMeta =
    state.ceiling.state === 'partial'
      ? i18n._({ id: 'editor.panels.roomConstructionRows.handDrawnCeiling', message: 'Hand-drawn ceiling' })
      : ceilingHeight !== null
        ? i18n._({
            id: 'editor.panels.roomConstructionRows.ceilingAt',
            message: 'At {height}',
            values: { height: length(ceilingHeight) },
          })
        : i18n._({ id: 'editor.panels.roomConstructionRows.flatAtWallHeight', message: 'Flat, at wall height' })

  return (
    <div className="flex flex-col" data-room-construction={zoneId}>
      <RoomTypeChoice zoneId={zoneId} />
      <DeckBoardsFields zoneId={zoneId} />
      <PorchFramingFields zoneId={zoneId} />
      <h3 className="mt-4 mb-1.5 font-medium text-muted-foreground text-xs">{i18n._({ id: 'editor.panels.roomConstructionRows.builtWith', message: 'Built with' })}</h3>
      <div className="flex flex-col gap-1">
        <ConstructionPart
          control={partSwitch('floor')}
          expanded={expanded === 'floor'}
          icon="/icons/floor.webp"
          label={i18n._({ id: 'editor.panels.roomConstructionRows.floor', message: 'Floor' })}
          meta={floorMeta}
          on={state.floor.state !== 'absent'}
          footer={<SitsOn noFloor={state.floor.state === 'absent'} zoneId={zoneId} />}
          onToggleExpanded={toggle('floor')}
          part="floor"
        >
          <BuiltOnField zoneId={zoneId} />
          {drawnFloor ? (
            <DrawnFloorRow zoneId={zoneId} />
          ) : (
            <FloorHeightField bounds={heightBounds} zoneId={zoneId} />
          )}
          <RoomFloorConstructionField zoneId={zoneId} />
          <RoomOpeningsField surface="floor" zoneId={zoneId} />
        </ConstructionPart>
        <ConstructionPart
          control={partSwitch('walls')}
          expanded={expanded === 'walls'}
          icon="/icons/wall.webp"
          label={i18n._({ id: 'editor.panels.roomConstructionRows.walls', message: 'Walls' })}
          meta={wallsMeta}
          on={state.walls.state !== 'absent'}
          onToggleExpanded={toggle('walls')}
          part="walls"
        >
          <PartField label={i18n._({ id: 'editor.panels.roomConstructionRows.walls', message: 'Walls' })}>
            <span className="font-mono text-foreground tabular-nums">{wallIds.length}</span>
          </PartField>
          {state.walls.state === 'partial' && state.walls.actions.add && (
            <PartField
              label={i18n._({
                id: 'editor.panels.roomConstructionRows.openSides',
                message:
                  '{openSides, plural, one {{openSideCount} open side} other {{openSideCount} open sides}}',
                values: { openSides, openSideCount: String(openSides) },
              })}
            >
              <button
                className={pill}
                onClick={() => report(addRoomConstruction(zoneId, 'walls'))}
                type="button"
              >
                {i18n._({ id: 'editor.panels.roomConstructionRows.closeWithWalls', message: 'Close with walls' })}
              </button>
            </PartField>
          )}
          {shared.length > 0 && (
            <p data-shared-walls-note>
              {i18n._({
                id: 'editor.panels.roomConstructionRows.sharedWallsNote',
                message: 'Turning walls off keeps the ones shared with {rooms}.',
                values: {
                  rooms: formatList(
                    [
                      ...new Set(
                        shared.map((name) =>
                          name
                            ? displayRoomName(name, i18n)
                            : i18n._({
                                id: 'editor.panels.roomConstructionRows.theNextRoom',
                                message: 'the next room',
                              }),
                        ),
                      ),
                    ],
                    locale,
                  ),
                },
              })}
            </p>
          )}
          {locked !== null && (
            <div className="mt-1 flex items-start gap-3" data-lock-outside-faces>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium text-[13px] text-foreground">
                  {i18n._({ id: 'editor.panels.roomConstructionRows.keepOutsideDimensions', message: 'Keep outside dimensions' })}
                </span>
                <span>{i18n._({ id: 'editor.panels.roomConstructionRows.wallsThickenInwardSoTheBuilding', message: 'Walls thicken inward, so the building\'s outer size stays the same.' })}</span>
              </span>
              <Switch
                aria-label={i18n._({ id: 'editor.panels.roomConstructionRows.keepOutsideDimensions', message: 'Keep outside dimensions' })}
                checked={locked}
                onCheckedChange={(next) =>
                  report(next ? lockRoomOutsideFaces(zoneId) : unlockRoomOutsideFaces(wallIds))
                }
              />
            </div>
          )}
        </ConstructionPart>
        <ConstructionPart
          control={partSwitch('ceiling')}
          expanded={expanded === 'ceiling'}
          icon="/icons/ceiling.webp"
          label={i18n._({ id: 'editor.panels.roomConstructionRows.ceiling', message: 'Ceiling' })}
          meta={ceilingMeta}
          on={state.ceiling.state !== 'absent'}
          onToggleExpanded={toggle('ceiling')}
          part="ceiling"
        >
          {ceilingHeight !== null && (
            <PartField label={i18n._({ id: 'editor.panels.roomConstructionRows.height', message: 'Height' })}>
              <span className="font-mono text-foreground tabular-nums">
                {length(ceilingHeight)}
              </span>
            </PartField>
          )}
          {state.ceiling.ceilingId && (
            <PartField label={i18n._({ id: 'editor.panels.roomConstructionRows.shape', message: 'Shape' })}>
              <button className={pill} onClick={() => startCeilingEdit(zoneId)} type="button">
                {i18n._({ id: 'editor.panels.roomConstructionRows.editShape', message: 'Edit shape' })}
              </button>
            </PartField>
          )}
          {state.ceiling.ceilingId && <RoomOpeningsField surface="ceiling" zoneId={zoneId} />}
          {(state.ceiling.actions.useExisting || state.ceiling.actions.replace) && (
            <div className="flex items-center gap-2" data-construction-manual-ceiling>
              <span className="flex-1">{i18n._({ id: 'editor.panels.roomConstructionRows.handDrawnCeiling', message: 'Hand-drawn ceiling' })}</span>
              {state.ceiling.actions.useExisting && (
                <button
                  className={pill}
                  onClick={() => report(adoptExistingCeiling(zoneId))}
                  type="button"
                >
                  {i18n._({ id: 'editor.panels.roomConstructionRows.useExisting', message: 'Use existing' })}
                </button>
              )}
              {state.ceiling.actions.replace && (
                <button
                  className={pill}
                  onClick={() => report(replaceRoomCeiling(zoneId))}
                  type="button"
                >
                  {i18n._({ id: 'editor.panels.roomConstructionRows.replace', message: 'Replace' })}
                </button>
              )}
            </div>
          )}
        </ConstructionPart>
      </div>
      {message && (
        <span
          className={cn(
            'mt-2 text-xs',
            message.conflict ? 'text-destructive' : 'text-muted-foreground',
          )}
          role="status"
        >
          {message.text}
        </span>
      )}
      <ShapeChoice
        className="mt-3 rounded-full border border-border border-dashed py-1.5 pr-1.5 pl-3.5 font-medium text-[13px] text-foreground"
        data="add-mezzanine"
        label={i18n._({ id: 'editor.panels.roomConstructionRows.addMezzanine', message: '+ Add mezzanine' })}
        onPick={(shape) => startMezzanineDraft(zoneId, shape)}
      />
    </div>
  )
}
