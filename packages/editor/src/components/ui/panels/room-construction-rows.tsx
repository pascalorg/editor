'use client'

import {
  type AnyNodeId,
  floorFootprintName,
  floorFootprintSupportClass,
  floorPlateAtGroundContact,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
  roomDrawnFloor,
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
import { roomBuiltOn, separateFloorSummary } from '../../../lib/room-built-on'
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
import { MetricControl } from '../controls/metric-control'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { Switch } from '../primitives/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { RoomOpeningsField } from './room-openings-field'
import { ShapeChoice } from './shape-choice'

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

export const pill =
  'rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50'

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const DRAWN_FLOOR_SWITCH_HINT = 'This floor is a drawn slab: select it to edit or delete it.'

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
              {on ? meta : 'Not included'}
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
        label="Height"
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
        {floor.ambiguous ? 'Floor is several drawn slabs, mostly ' : 'Floor is a drawn slab: '}
        <span className="text-foreground">{floor.name}</span>
        {floor.shared > 0 && ` (shared with ${count(floor.shared, 'room')})`}
      </span>
      <button
        className={cn(pill, 'shrink-0')}
        data-select-drawn-floor
        onClick={() => openFloorFoundation(floor.id)}
        type="button"
      >
        Select
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
      <PartField label="Built on">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Built on"
              className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-0.5 text-foreground text-xs transition-colors hover:bg-accent"
              data-built-on-trigger
              type="button"
            >
              <span className="truncate">{model.current.name}</span>
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
                <span className="flex-1 truncate">{choice.name}</span>
                {choice.plateId === model.current.plateId && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-built-on-choice="new" onSelect={() => choose('new')}>
              + New floor
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
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const summary = useScene(
    useShallow((scene) => {
      const plate = roomFloorOwner(scene.nodes, zoneId) ?? roomFootprint(scene.nodes, zoneId)
      if (!plate) return { id: '', name: '', drawn: false, lift: 0, supported: false }
      if (plate.plateRole !== 'base')
        return {
          id: plate.id as string,
          name: plate.name?.trim() || 'Slab',
          drawn: true,
          lift: 0,
          supported: false,
        }
      return {
        id: plate.id as string,
        name: floorFootprintName(scene.nodes, plate),
        drawn: false,
        ...footprintStanding(scene.nodes, plate),
      }
    }),
  )
  const preset = summary.drawn
    ? 'Drawn slab'
    : Math.abs(summary.lift) > 0.005
      ? `${summary.lift > 0 ? 'Raised' : 'Lowered'} ${formatLinearMeasurement(Math.abs(summary.lift), unit, metricNotation)}`
      : summary.supported
        ? 'On the walls below'
        : 'On the ground'
  if (noFloor)
    return (
      <span className="mb-2 ml-[42px] text-muted-foreground text-xs" data-sits-on="none">
        No floor
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
        Sits on: <span className="text-foreground">{summary.name}</span> · {preset}
      </span>
      <ChevronRight className="size-3 shrink-0" />
    </button>
  )
}

/**
 * The room's floor construction, edited from the room: its thickness, through
 * core's `setRoomFloorConstruction` (the command MCP uses too), on whatever the
 * floor is built as. A drawn slab takes thickness and finishes only — it has
 * no footprint height or foundation, and says so.
 */
export function RoomFloorConstructionField({ zoneId }: { zoneId: string }) {
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
        label="Floor thickness"
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
          A drawn slab: set its thickness and finishes here. It has no footprint height or
          foundation.
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
      ? [node.name?.trim() || 'the next room']
      : [],
  )
}

/**
 * "Built with": the room's floor, walls and ceiling, each included or not
 * with its switch, and its settings a chevron away. Then Add mezzanine.
 */
export function RoomConstructionRows({ room }: { room: RoomSelectionRecord }) {
  const zoneId = room.zoneId
  const state = useScene((scene) => roomConstructionState(scene.nodes, zoneId))
  const nodes = useScene((scene) => scene.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [expanded, setExpanded] = useState<RoomConstructionPart | null>(null)
  const [message, setMessage] = useState<{ text: string; conflict: boolean } | null>(null)
  if (!state) return null
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const report = (result: RoomConstructionResult, unchanged = 'Nothing to change.') =>
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
  const partSwitch = (part: RoomConstructionPart, label: string) => {
    const { state: presence, actions } = state[part]
    if (part === 'walls') {
      const walls = wallsSwitch(state)
      return (
        <Switch
          aria-checked={walls.mixed ? 'mixed' : walls.checked}
          aria-label="Include walls"
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
                aria-label="Include floor"
                checked={state.floor.intent}
                className="disabled:pointer-events-none"
                disabled={!actions.add}
                onCheckedChange={() => report(addRoomConstruction(zoneId, 'floor'))}
              />
            </span>
          </TooltipTrigger>
          {!actions.add && (
            <TooltipContent side="top" sideOffset={6}>
              {DRAWN_FLOOR_SWITCH_HINT}
            </TooltipContent>
          )}
        </Tooltip>
      )
    }
    const on = presence !== 'absent'
    return (
      <Switch
        aria-label={`Include ${label.toLowerCase()}`}
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
      ? `Partial · ${Math.round(state.floor.coverage * 100)}% covered`
      : drawnSlab?.type === 'slab'
        ? `Drawn slab at ${length(drawnSlab.elevation)}`
        : builtOn && builtOn.current.key !== null
          ? separateFloorSummary(
              { ...builtOn, offset: separateFloorOffset(nodes, zoneId) },
              length,
            )
          : Math.abs(floorElevation) < 0.005
            ? 'At floor level'
            : `${length(Math.abs(floorElevation))} ${floorElevation > 0 ? 'up' : 'down'}`
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
      ? `Partial · ${count(wallIds.length, 'wall')}, ${count(openSides, 'open side')}`
      : count(wallIds.length, 'wall')
  const locked = roomOutsideFacesLocked(nodes, wallIds)

  const ceilingHeight = state.ceiling.ceilingId ? roomInsideHeight(room, nodes).ceiling : null
  const ceilingMeta =
    state.ceiling.state === 'partial'
      ? 'Hand-drawn ceiling'
      : ceilingHeight !== null
        ? `At ${length(ceilingHeight)}`
        : 'Flat, at wall height'

  return (
    <div className="flex flex-col" data-room-construction={zoneId}>
      <h3 className="mt-4 mb-1.5 font-medium text-muted-foreground text-xs">Built with</h3>
      <div className="flex flex-col gap-1">
        <ConstructionPart
          control={partSwitch('floor', 'Floor')}
          expanded={expanded === 'floor'}
          icon="/icons/floor.webp"
          label="Floor"
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
          control={partSwitch('walls', 'Walls')}
          expanded={expanded === 'walls'}
          icon="/icons/wall.webp"
          label="Walls"
          meta={wallsMeta}
          on={state.walls.state !== 'absent'}
          onToggleExpanded={toggle('walls')}
          part="walls"
        >
          <PartField label="Walls">
            <span className="font-mono text-foreground tabular-nums">{wallIds.length}</span>
          </PartField>
          {state.walls.state === 'partial' && state.walls.actions.add && (
            <PartField label={`${count(openSides, 'open side')}`}>
              <button
                className={pill}
                onClick={() => report(addRoomConstruction(zoneId, 'walls'))}
                type="button"
              >
                Close with walls
              </button>
            </PartField>
          )}
          {shared.length > 0 && (
            <p data-shared-walls-note>
              Turning walls off keeps the ones shared with {[...new Set(shared)].join(', ')}.
            </p>
          )}
          {locked !== null && (
            <div className="mt-1 flex items-start gap-3" data-lock-outside-faces>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium text-[13px] text-foreground">
                  Keep outside dimensions
                </span>
                <span>Walls thicken inward, so the building's outer size stays the same.</span>
              </span>
              <Switch
                aria-label="Keep outside dimensions"
                checked={locked}
                onCheckedChange={(next) =>
                  report(next ? lockRoomOutsideFaces(zoneId) : unlockRoomOutsideFaces(wallIds))
                }
              />
            </div>
          )}
        </ConstructionPart>
        <ConstructionPart
          control={partSwitch('ceiling', 'Ceiling')}
          expanded={expanded === 'ceiling'}
          icon="/icons/ceiling.webp"
          label="Ceiling"
          meta={ceilingMeta}
          on={state.ceiling.state !== 'absent'}
          onToggleExpanded={toggle('ceiling')}
          part="ceiling"
        >
          {ceilingHeight !== null && (
            <PartField label="Height">
              <span className="font-mono text-foreground tabular-nums">
                {length(ceilingHeight)}
              </span>
            </PartField>
          )}
          {state.ceiling.ceilingId && (
            <PartField label="Shape">
              <button className={pill} onClick={() => startCeilingEdit(zoneId)} type="button">
                Edit shape
              </button>
            </PartField>
          )}
          {state.ceiling.ceilingId && <RoomOpeningsField surface="ceiling" zoneId={zoneId} />}
          {(state.ceiling.actions.useExisting || state.ceiling.actions.replace) && (
            <div className="flex items-center gap-2" data-construction-manual-ceiling>
              <span className="flex-1">Hand-drawn ceiling</span>
              {state.ceiling.actions.useExisting && (
                <button
                  className={pill}
                  onClick={() => report(adoptExistingCeiling(zoneId))}
                  type="button"
                >
                  Use existing
                </button>
              )}
              {state.ceiling.actions.replace && (
                <button
                  className={pill}
                  onClick={() => report(replaceRoomCeiling(zoneId))}
                  type="button"
                >
                  Replace
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
        label="+ Add mezzanine"
        onPick={(shape) => startMezzanineDraft(zoneId, shape)}
      />
    </div>
  )
}
