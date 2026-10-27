'use client'

import {
  type AnyNode,
  type AnyNodeId,
  area,
  runAsSingleSceneHistoryStep,
  useScene,
  type ZoneNode, usePascalI18n,
  type PascalI18n,
  useLocale,
} from '@pascal-app/core'
import { setRoomFloorScript } from '@pascal-app/core/agent-operations'
import { useViewer } from '@pascal-app/viewer'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { startCeilingEdit } from '../../../lib/ceiling-edit-session'
import { resolveOverlayPolicy } from '../../../lib/interaction/overlay-policy'
import { finishScriptCode } from '../../../lib/geometry-script/finish-scripts'
import { formatAreaLabel, formatLinearMeasurement } from '../../../lib/measurements'
import { addMezzanineStairs } from '../../../lib/mezzanine-stairs'
import { roomFloorBase, roomRelativeFloorHeight } from '../../../lib/room-construction-commands'
import { mezzanineElevationBounds } from '../../../lib/room-handle-drag'
import type { RoomSelectionRecord } from '../../../lib/room-selection'
import {
  baseRoomName,
  type RoomNameSection,
  roomNameSections,
  roomNameUseCount,
} from '../../../lib/room-name-catalog'
import { renameRoom, requestRoomDeletion } from '../../../lib/room-structure-commands'
import { addZoneToNewUnit, assignZoneToUnit, zoneUnits } from '../../../lib/units'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { ColorDot } from '../primitives/color-dot'
import { Popover, PopoverAnchor, PopoverContent } from '../primitives/popover'
import { ShortcutToken } from '../primitives/shortcut-token'
import { PanelWrapper } from './panel-wrapper'
import { RoomOpeningsField } from './room-openings-field'
import {
  ConstructionPart,
  FloorHeightField,
  PartField,
  pill,
  RoomConstructionRows,
  roomInsideHeight,
} from './room-construction-rows'
import { pickedRoomName, type RoomNameOption, roomNameOptions } from './room-name-options'
import { localizedLevelName } from '../../../i18n/level-name'
import { messageWithSlot } from '../../../i18n/message-slot'
import {
  displayRoomName,
  localizedRoomNameSections,
  storedRoomName,
} from '../../../lib/room-name-messages'

/** "Room · Ground floor", "Mezzanine · in Kitchen", "Room · not enclosed". */
export function roomKicker(
  nodes: Record<string, AnyNode>,
  zoneId: string,
  i18n: PascalI18n,
  locale: string,
  options: { mezzanine?: boolean; open?: boolean } = {},
): string {
  const zone = nodes[zoneId]
  if (options.mezzanine && zone?.type === 'zone') {
    const host = zone.hostZoneId ? nodes[zone.hostZoneId] : undefined
    const hostName = host?.type === 'zone' ? host.name?.trim() : ''
    return hostName
      ? i18n._({
          id: 'editor.panels.roomPanel.kickerMezzanineIn',
          message: 'Mezzanine · in {room}',
          values: { room: displayRoomName(hostName, i18n) },
        })
      : i18n._({ id: 'editor.panels.roomPanel.mezzanine', message: 'Mezzanine' })
  }
  if (options.open)
    return i18n._({ id: 'editor.panels.roomPanel.kickerNotEnclosed', message: 'Room · not enclosed' })
  const level = zone?.parentId ? nodes[zone.parentId] : undefined
  return level?.type === 'level'
    ? i18n._({
        id: 'editor.panels.roomPanel.kickerLevel',
        message: 'Room · {level}',
        values: { level: localizedLevelName(level, i18n, locale) },
      })
    : i18n._({ id: 'editor.panels.roomPanel.room', message: 'Room' })
}

export function RoomPanel({
  room,
  onClose = () => useEditor.getState().clearRoom(),
}: {
  room: RoomSelectionRecord
  onClose?: () => void
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const nodes = useScene((state) => state.nodes)
  const catalogVersion = i18n.getVersion()
  const sections = useMemo(
    () => localizedRoomNameSections(roomNameSections(nodes, room.zoneId), i18n),
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-translate on a catalog change
    [i18n, catalogVersion, nodes, room.zoneId],
  )
  const name = useScene((state) => state.nodes[room.zoneId as AnyNodeId]?.name ?? '')
  const visible = useInteractionScope(
    (state) => resolveOverlayPolicy(state.scope).conflictingControls === 'shown',
  )
  if (!visible) return null
  const mezzanine = !!room.mezzanine
  return (
    <PanelWrapper
      kicker={roomKicker(nodes, room.zoneId, i18n, locale, { mezzanine })}
      onClose={onClose}
      title={(name.trim() && displayRoomName(name, i18n)) || (mezzanine ? i18n._({ id: 'editor.panels.roomPanel.mezzanine', message: 'Mezzanine' }) : i18n._({ id: 'editor.panels.roomPanel.room', message: 'Room' }))}
      titleContent={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <RoomColorDot zoneId={room.zoneId} />
          <RoomName
            key={room.zoneId}
            mezzanine={mezzanine}
            name={name}
            sections={sections}
            zoneId={room.zoneId}
          />
        </div>
      }
    >
      <div className="flex flex-col px-4 pt-3 pb-4 text-sm" data-room-panel={room.key.zoneId}>
        {!mezzanine && <RoomSubline room={room} />}
        <RoomStats room={room} />
        <RoomUnitRow zoneId={room.zoneId} />
        {mezzanine ? (
          <MezzanineRows key={room.zoneId} room={room} />
        ) : (
          <RoomConstructionRows key={room.zoneId} room={room} />
        )}
        <RoomFloorScriptRow key={`floor-script-${room.zoneId}`} zoneId={room.zoneId} />
      </div>
    </PanelWrapper>
  )
}

/**
 * A room the walls do not close (yet): the same title and kicker, and what
 * needs no closed outline — its name, its unit, deleting it.
 */
export function OpenRoomPanel({ zoneId, onClose }: { zoneId: string; onClose: () => void }) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const nodes = useScene((state) => state.nodes)
  const catalogVersion = i18n.getVersion()
  const sections = useMemo(
    () => localizedRoomNameSections(roomNameSections(nodes, zoneId), i18n),
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-translate on a catalog change
    [i18n, catalogVersion, nodes, zoneId],
  )
  const name = useScene((state) => state.nodes[zoneId as AnyNodeId]?.name ?? '')
  const unit = useViewer((s) => s.unit)
  const zone = nodes[zoneId as AnyNodeId]
  if (zone?.type !== 'zone') return null
  return (
    <PanelWrapper
      kicker={roomKicker(nodes, zoneId, i18n, locale, { open: true })}
      onClose={onClose}
      title={
        (name.trim() && displayRoomName(name, i18n)) ||
        i18n._({ id: 'editor.panels.roomPanel.room', message: 'Room' })
      }
      titleContent={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <RoomColorDot zoneId={zoneId} />
          <RoomName
            key={zoneId}
            mezzanine={false}
            name={name}
            sections={sections}
            zoneId={zoneId}
          />
        </div>
      }
    >
      <div className="flex flex-col px-4 pt-3 pb-4 text-sm" data-open-room-panel={zoneId}>
        <p className="text-muted-foreground text-xs">
          {i18n._({
            id: 'editor.panels.roomPanel.openRoomArea',
            message: '{area} · Close its walls to build its floor and ceiling.',
            values: { area: formatAreaLabel(area([{ outer: zone.polygon, holes: zone.holes }]), unit, 2) },
          })}
        </p>
        <RoomUnitRow zoneId={zoneId} />
        <button
          className="mt-3 w-full rounded-full border border-border/50 py-2 font-medium text-[13px] text-foreground transition-colors hover:bg-accent/50"
          data-delete-open-room
          onClick={() => requestRoomDeletion(zoneId)}
          type="button"
        >
          {i18n._({ id: 'editor.panels.roomPanel.deleteRoom', message: 'Delete room' })}
        </button>
      </div>
    </PanelWrapper>
  )
}

/** "Unit: Flat A ›" — which unit the room belongs to; change it, add it to one, or take it out. */
export function RoomUnitRow({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const nodes = useScene((scene) => scene.nodes)
  const { buildingId, units, current } = useMemo(() => zoneUnits(nodes, zoneId), [nodes, zoneId])
  if (!buildingId) return null
  return (
    <div className="mt-3 flex min-h-8 items-center justify-between gap-3" data-room-unit={zoneId}>
      <span className="text-muted-foreground text-xs">{i18n._({ id: 'editor.panels.roomPanel.unit', message: 'Unit' })}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={i18n._({ id: 'editor.panels.roomPanel.unit', message: 'Unit' })}
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent"
            type="button"
          >
            {current && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
            )}
            <span className="truncate">
              {current ? current.name || i18n._({ id: 'editor.panels.roomPanel.unit', message: 'Unit' }) : units.length ? i18n._({ id: 'editor.panels.roomPanel.none', message: 'None' }) : i18n._({ id: 'editor.panels.roomPanel.addToAUnit', message: 'Add to a unit' })}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {units.map((unit) => (
            <DropdownMenuItem
              key={unit.id}
              onSelect={() => assignZoneToUnit(zoneId as ZoneNode['id'], unit.id)}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: unit.color }}
              />
              <span className="flex-1 truncate">{unit.name || i18n._({ id: 'editor.panels.roomPanel.unit', message: 'Unit' })}</span>
              {unit.id === current?.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          {units.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => addZoneToNewUnit(zoneId as ZoneNode['id'])}>
            {i18n._({ id: 'editor.panels.roomPanel.newUnit', message: 'New unit' })}
          </DropdownMenuItem>
          {current && (
            <DropdownMenuItem onSelect={() => assignZoneToUnit(zoneId as ZoneNode['id'], null)}>
              {current.name
                ? i18n._({
                    id: 'editor.panels.roomPanel.removeFromUnitNamed',
                    message: 'Remove from {unit}',
                    values: { unit: current.name },
                  })
                : i18n._({ id: 'editor.panels.roomPanel.removeFromUnit', message: 'Remove from unit' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * "Scripted finish": a floor a script builds (it owns the floor's colours, so Paint leaves it),
 * with its code to read and a way to take it off, back to the floor's own finish.
 */
function RoomFloorScriptRow({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const sha = useScene((scene) => {
    const zone = scene.nodes[zoneId as AnyNodeId]
    return zone?.type === 'zone' ? zone.floor?.script?.script : undefined
  })
  const [code, setCode] = useState<{ sha: string; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  if (!sha) return null
  const unreadable = i18n._({
    id: 'editor.panels.scriptUnreadable',
    message: 'The script could not be read.',
  })
  const toggleCode = () => {
    setOpen((shown) => !shown)
    if (code?.sha === sha) return
    finishScriptCode(sha).then(
      (text) => setCode({ sha, text: text ?? unreadable }),
      () => setCode({ sha, text: unreadable }),
    )
  }
  const remove = () => {
    const { changes } = setRoomFloorScript(
      useScene.getState().nodes,
      { zoneId, remove: true },
      { activeLevelId: null },
    )
    runAsSingleSceneHistoryStep(useScene, () => {
      for (const { id, data } of changes?.update ?? [])
        useScene.getState().updateNode(id as AnyNodeId, data)
    })
  }
  return (
    <div className="mt-3 flex flex-col gap-2" data-room-floor-script={zoneId}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">{i18n._({ id: 'editor.panels.roomPanel.scriptedFinish', message: 'Scripted finish' })}</span>
        <div className="flex items-center gap-1.5">
          <button
            className="rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent"
            onClick={toggleCode}
            type="button"
          >
            {open ? i18n._({ id: 'editor.panels.roomPanel.hideCode', message: 'Hide code' }) : i18n._({ id: 'editor.panels.roomPanel.viewCode', message: 'View code' })}
          </button>
          <button
            className="rounded-full border border-border/50 px-2.5 py-0.5 text-xs transition-colors hover:bg-accent"
            onClick={remove}
            type="button"
          >
            {i18n._({ id: 'editor.panels.roomPanel.remove', message: 'Remove' })}
          </button>
        </div>
      </div>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre rounded-lg border border-border/50 p-2 font-mono text-[11px] text-foreground">
          {code?.sha === sha ? code.text : i18n._({ id: 'editor.panels.roomPanel.loading', message: 'Loading…' })}
        </pre>
      )}
    </div>
  )
}

/** "2 doors · 3 windows" (the level is in the kicker). */
function RoomSubline({ room }: { room: RoomSelectionRecord }) {
  const i18n = usePascalI18n()
  const counts = useScene((scene) => {
    const walls = new Set(room.boundaryWallIds)
    let doors = 0
    let windows = 0
    for (const node of Object.values(scene.nodes)) {
      if (node.type !== 'door' && node.type !== 'window') continue
      const wallId = node.parentId ?? ('wallId' in node ? (node.wallId as string) : '')
      if (!walls.has(wallId)) continue
      if (node.type === 'door') doors++
      else windows++
    }
    return `${doors}:${windows}`
  })
  const [doors, windows] = counts.split(':').map(Number)
  const text = i18n._({
    id: 'editor.panels.roomPanel.openingCounts',
    message:
      '{doors, plural, one {# door} other {# doors}} · {windows, plural, one {# window} other {# windows}}',
    values: { doors, windows },
  })
  return (
    <p className="text-muted-foreground text-xs" data-room-subline>
      {text}
    </p>
  )
}

function ringPerimeter(ring: readonly (readonly [number, number])[]) {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

/** Area, perimeter and inside height, in the user's units. */
function RoomStats({ room }: { room: RoomSelectionRecord }) {
  const i18n = usePascalI18n()
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const nodes = useScene((scene) => scene.nodes)
  const zone = nodes[room.zoneId as AnyNodeId]
  const perimeter =
    zone?.type === 'zone'
      ? [zone.polygon, ...(zone.holes ?? [])].reduce((sum, ring) => sum + ringPerimeter(ring), 0)
      : 0
  const { height } = roomInsideHeight(room, nodes)
  const stats = [
    { label: i18n._({ id: 'editor.panels.roomPanel.area', message: 'Area' }), value: formatAreaLabel(room.area, unit, 2) },
    { label: i18n._({ id: 'editor.panels.roomPanel.perimeter', message: 'Perimeter' }), value: formatLinearMeasurement(perimeter, unit, metricNotation) },
    {
      label: i18n._({ id: 'editor.panels.roomPanel.height', message: 'Height' }),
      value: height === null ? '—' : formatLinearMeasurement(height, unit, metricNotation),
    },
  ]
  return (
    <div
      className="mt-3 grid grid-cols-3 divide-x divide-border/50 rounded-lg border border-border/50"
      data-room-stats
    >
      {stats.map((stat) => (
        <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2" key={stat.label}>
          <span className="text-[11px] text-muted-foreground">{stat.label}</span>
          <span className="truncate font-medium font-mono text-[13px] text-foreground tabular-nums">
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A mezzanine is built the same way, adapted: its own floor at its height
 * (editable within what core accepts), stairs up to it, and the ceiling over
 * it when there is headroom. No walls of its own, so no walls row.
 */
function MezzanineRows({ room }: { room: RoomSelectionRecord }) {
  const i18n = usePascalI18n()
  const zoneId = room.zoneId
  const nodes = useScene((scene) => scene.nodes)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [expanded, setExpanded] = useState<'floor' | 'ceiling' | null>(null)
  const [stairMessage, setStairMessage] = useState<string | null>(null)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const elevation = roomRelativeFloorHeight(nodes, zoneId)
  const base = roomFloorBase(nodes, zoneId)
  const absoluteBounds = mezzanineElevationBounds(nodes, zoneId)
  const bounds = absoluteBounds && {
    min: absoluteBounds.min - base,
    max: absoluteBounds.max - base,
  }
  const hasCeiling = Object.values(nodes).some(
    (node) => node.type === 'ceiling' && node.zoneId === zoneId,
  )
  const { ceiling } = roomInsideHeight(room, nodes)
  const toggle = (part: 'floor' | 'ceiling') => () =>
    setExpanded((current) => (current === part ? null : part))
  return (
    <div className="flex flex-col" data-mezzanine-rows={zoneId}>
      <h3 className="mt-4 mb-1.5 font-medium text-muted-foreground text-xs">{i18n._({ id: 'editor.panels.roomPanel.builtWith', message: 'Built with' })}</h3>
      <div className="flex flex-col gap-1">
        <ConstructionPart
          expanded={expanded === 'floor'}
          icon="/icons/floor.webp"
          label={i18n._({ id: 'editor.panels.roomPanel.floor', message: 'Floor' })}
          meta={`${length(elevation)} up`}
          on
          onToggleExpanded={toggle('floor')}
          part="floor"
        >
          <FloorHeightField bounds={bounds} zoneId={zoneId} />
          <RoomOpeningsField surface="floor" zoneId={zoneId} />
        </ConstructionPart>
        <ConstructionPart
          control={
            <button
              className={pill}
              data-add-mezzanine-stairs
              onClick={() => {
                const result = addMezzanineStairs(zoneId)
                setStairMessage(result.ok ? null : result.message)
              }}
              type="button"
            >
              {i18n._({ id: 'editor.panels.roomPanel.addStairs', message: 'Add stairs' })}
            </button>
          }
          expanded={false}
          icon="/icons/stairs.webp"
          label={i18n._({ id: 'editor.panels.roomPanel.stairs', message: 'Stairs' })}
          meta="Up from the floor below"
          on
          onToggleExpanded={() => {}}
          part="stairs"
        />
        <ConstructionPart
          expanded={expanded === 'ceiling'}
          icon="/icons/ceiling.webp"
          label={i18n._({ id: 'editor.panels.roomPanel.ceiling', message: 'Ceiling' })}
          meta={
            hasCeiling
              ? ceiling === null
                ? i18n._({ id: 'editor.panels.roomPanel.overTheMezzanine', message: 'Over the mezzanine' })
                : i18n._({
                    id: 'editor.panels.roomPanel.headroom',
                    message: '{height} headroom',
                    values: { height: length(ceiling) },
                  })
              : i18n._({ id: 'editor.panels.roomPanel.notEnoughHeadroom', message: 'Not enough headroom' })
          }
          on
          onToggleExpanded={toggle('ceiling')}
          part="ceiling"
        >
          {hasCeiling ? (
            <PartField label={i18n._({ id: 'editor.panels.roomPanel.shape', message: 'Shape' })}>
              <button className={pill} onClick={() => startCeilingEdit(zoneId)} type="button">
                {i18n._({ id: 'editor.panels.roomPanel.editShape', message: 'Edit shape' })}
              </button>
            </PartField>
          ) : undefined}
        </ConstructionPart>
      </div>
      {stairMessage && (
        <span className="mt-2 text-destructive text-xs" role="status">
          {stairMessage}
        </span>
      )}
    </div>
  )
}

/**
 * The room's colour, as the scene graph shows and edits it: the plan fill and
 * the label tint, never a finish (finishes are painted).
 */
function RoomColorDot({ zoneId }: { zoneId: string }) {
  const i18n = usePascalI18n()
  const color = useScene((state) => {
    const zone = state.nodes[zoneId as AnyNodeId]
    return zone?.type === 'zone' ? zone.color : undefined
  })
  return (
    <ColorDot
      color={color ?? '#3b82f6'}
      label={i18n._({ id: 'editor.panels.roomPanel.roomColourUsedInThePlan', message: 'Room colour — used in the plan and labels' })}
      onChange={(next) => useScene.getState().updateNode(zoneId as AnyNodeId, { color: next })}
      side="bottom"
    />
  )
}

/**
 * The name, edited in place: it reads as the panel's heading until focused.
 * Focusing opens every suggestion — the current name is not a filter until
 * the user types — with the caret at the end so the name can be fine-tuned.
 * Picking a name (click or Enter) writes it as one rename — numbered when
 * another room on the level has it ("Bedroom 2") — and lets go of the field;
 * Escape reverts.
 */
function RoomName({
  zoneId,
  name,
  sections,
  mezzanine,
}: {
  zoneId: string
  name: string
  sections: readonly RoomNameSection[]
  mezzanine: boolean
}) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  // The field shows the name in the UI language; the scene keeps what was stored.
  const display = displayRoomName(name, i18n)
  const [value, setValue] = useState(display)
  const [open, setOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [active, setActive] = useState(-1)
  const valueRef = useRef(display)
  // Enter/click commit and then blur, and blur commits too; this keeps it one rename.
  const committedRef = useRef(display)
  const originalRef = useRef(display)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const { typed: typedRow, groups, options } = roomNameOptions(value, sections, typing)
  const expanded = open && options.length > 0
  const activeId = expanded && options[active] ? `${listId}-${active}` : undefined
  const current = baseRoomName(name).toLowerCase()

  // A rename from elsewhere (undo, a collaborator, the plan) lands in the field
  // unless the user is editing it (the field stays mounted across renames).
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    valueRef.current = display
    committedRef.current = display
    setValue(display)
  }, [display])

  // Opening and the arrow keys bring the active row into view; the pointer
  // only highlights (scrolling under it would move the row being clicked).
  const scrollToActive = useRef(false)
  useEffect(() => {
    if (!(activeId && scrollToActive.current)) return
    scrollToActive.current = false
    // The list mounts in the same commit that opens it: wait a frame so the
    // current name, lower in the list, is scrolled to on open.
    const frame = requestAnimationFrame(() =>
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [activeId])

  const caretToEnd = () => {
    const input = inputRef.current
    if (!input) return
    const end = input.value.length
    input.setSelectionRange(end, end)
  }
  const showAll = () => {
    setTyping(false)
    setOpen(true)
    const all = roomNameOptions(valueRef.current, sections, false).options
    const here = baseRoomName(name).toLowerCase()
    scrollToActive.current = true
    setActive(Math.max(0, all.findIndex((option) => option.value.toLowerCase() === here)))
  }
  const type = (next: string) => {
    valueRef.current = next
    setValue(next)
  }
  const commit = () => {
    const next = valueRef.current
    if (next === committedRef.current) return
    committedRef.current = next
    // The field shows catalog names translated: store the English one, as a pick does.
    const stored = storedRoomName(next, i18n)
    if (stored !== name) renameRoom(zoneId, stored)
  }
  const pick = (option: RoomNameOption) => {
    // A suggestion stores the English catalog name, numbered against the level's rooms,
    // whatever the UI language; typed text is stored as written.
    const stored = pickedRoomName(nodes, zoneId, option, i18n)
    const shown = displayRoomName(stored, i18n)
    type(shown)
    committedRef.current = shown
    if (stored !== name) renameRoom(zoneId, stored)
    setOpen(false)
    setTyping(false)
    // A pick is the answer: the field lets go. To fine-tune the name, click it
    // again — the caret lands at the end.
    inputRef.current?.blur()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = options.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (!expanded) {
        showAll()
        return
      }
      if (!count) return
      const down = event.key === 'ArrowDown'
      scrollToActive.current = true
      setActive((index) => (down ? (index + 1) % count : index <= 0 ? count - 1 : index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const chosen = expanded ? options[active] : undefined
      if (chosen) pick(chosen)
      else inputRef.current?.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (expanded) {
        type(originalRef.current)
        setOpen(false)
        setTyping(false)
        requestAnimationFrame(() => inputRef.current?.select())
      } else inputRef.current?.blur()
    } else if (event.key === 'Tab') setOpen(false)
  }

  const renderOption = (option: RoomNameOption, index: number) => {
    const isCurrent = option.kind === 'suggestion' && option.value.toLowerCase() === current
    const used = option.kind === 'suggestion' ? roomNameUseCount(nodes, zoneId, option.value) : 0
    return (
      <div
        aria-selected={index === active}
        className={cn(
          'flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-foreground',
          index === active && 'bg-accent',
          option.kind === 'typed' && 'mb-0.5 rounded-b-none border-border border-b',
        )}
        data-room-name-option={option.value}
        id={`${listId}-${index}`}
        key={`${option.kind}:${index}:${option.value}`}
        role="option"
        tabIndex={-1}
        onClick={() => pick(option)}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActive(index)}
      >
        {option.kind === 'typed' && <Plus aria-hidden className="size-3.5 shrink-0" />}
        <RoomNameOptionLabel option={option} />
        {isCurrent ? (
          <Check aria-hidden className="size-3.5 shrink-0" />
        ) : used > 0 ? (
          <span
            className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground"
            title={i18n._({ id: 'editor.panels.roomPanel.pickingItAddsANumber', message: 'Picking it adds a number' })}
          >
            {i18n._({ id: 'editor.panels.roomPanel.usedOnThisLevel', message: '{used} on this level', values: { used } })}</span>
        ) : null}
      </div>
    )
  }

  return (
    <Popover open={expanded} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        {/* A stable hook for host-app onboarding to point at; nothing here reads it. */}
        <div
          className={cn(
            '-mx-1.5 flex min-w-0 flex-1 cursor-text items-center gap-1 rounded-md border border-transparent py-0.5 pr-0.5 pl-1.5 transition-colors hover:bg-accent/50',
            (expanded || open) && 'border-ring/60 bg-accent/40',
            'focus-within:border-ring/60 focus-within:bg-accent/40',
          )}
          data-guide-target="room-name"
          data-room-name-combobox
          title={
            name.trim()
              ? i18n._({
                  id: 'editor.panels.roomPanel.renameNamed',
                  message: '{name} · Rename',
                  values: { name: displayRoomName(name, i18n) },
                })
              : i18n._({ id: 'editor.panels.roomPanel.rename', message: 'Rename' })
          }
        >
          <input
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={expanded ? listId : undefined}
            aria-expanded={expanded}
            aria-label={mezzanine ? i18n._({ id: 'editor.panels.roomPanel.mezzanineName', message: 'Mezzanine name' }) : i18n._({ id: 'editor.panels.roomPanel.roomName', message: 'Room name' })}
            autoComplete="off"
            className="min-w-0 flex-1 text-ellipsis bg-transparent p-0 font-semibold text-foreground text-sm leading-snug tracking-tight outline-none placeholder:text-foreground"
            data-room-name
            maxLength={40}
            placeholder={mezzanine ? i18n._({ id: 'editor.panels.roomPanel.mezzanine', message: 'Mezzanine' }) : i18n._({ id: 'editor.panels.roomPanel.room', message: 'Room' })}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={value}
            onBlur={() => {
              setOpen(false)
              setTyping(false)
              commit()
            }}
            onChange={(event) => {
              type(event.target.value)
              setTyping(true)
              setOpen(true)
              scrollToActive.current = true
              setActive(roomNameOptions(event.target.value, sections, true).active)
            }}
            onFocus={() => {
              originalRef.current = valueRef.current
              showAll()
            }}
            onKeyDown={onKeyDown}
            onMouseUp={(event) => {
              // The click that focused the field lands the caret at the end;
              // a click in an already-focused field reopens the whole list.
              if (event.detail === 1 && !open) showAll()
              if (!typing) caretToEnd()
            }}
          />
          <button
            aria-label={mezzanine ? i18n._({ id: 'editor.panels.roomPanel.showMezzanineNames', message: 'Show mezzanine names' }) : i18n._({ id: 'editor.panels.roomPanel.showRoomNames', message: 'Show room names' })}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-room-name-open
            tabIndex={-1}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              const input = inputRef.current
              if (!input) return
              if (expanded) setOpen(false)
              else if (document.activeElement === input) showAll()
              else input.focus()
            }}
          >
            <ChevronDown
              aria-hidden
              className={cn('size-3 transition-transform', expanded && 'rotate-180')}
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label={mezzanine ? i18n._({ id: 'editor.panels.roomPanel.mezzanineNames', message: 'Mezzanine names' }) : i18n._({ id: 'editor.panels.roomPanel.roomNames', message: 'Room names' })}
        className="flex max-h-85 w-(--radix-popover-trigger-width) min-w-60 flex-col overflow-hidden p-0"
        id={listId}
        role="listbox"
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Escape belongs to the field: it reverts the name (the popover's own
        // dismiss would close the list first and turn it into a commit).
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && inputRef.current?.parentElement?.contains(event.target)) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // React events bubble out of the portal into the panel header, whose
        // pointerdown starts a panel drag and captures the pointer — the
        // release would then land on the header instead of the picked row.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 pt-1.5 pb-1">
          {typedRow && renderOption(typedRow, 0)}
          {groups.map((group) => {
            const first = options.indexOf(group.options[0]!)
            return (
              <div aria-labelledby={`${listId}-${group.id}`} key={group.id} role="group">
                <div
                  className="px-2.5 pt-2.5 pb-1 text-[11px] text-muted-foreground"
                  id={`${listId}-${group.id}`}
                  role="presentation"
                >
                  {group.title}
                </div>
                {group.options.map((option, offset) => renderOption(option, first + offset))}
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-border border-t px-3 py-2 text-[11px] text-muted-foreground">
          {(
            [
              [['↑', '↓'], i18n._({ id: 'editor.panels.roomPanel.browse', message: 'Browse' })],
              [['Enter'], i18n._({ id: 'editor.panels.roomPanel.pick', message: 'Pick' })],
              [['Esc'], i18n._({ id: 'editor.panels.roomPanel.revert', message: 'Revert' })],
            ] as const
          ).map(([keys, action]) => (
            <span className="flex items-center gap-1" key={keys[0]}>
              {keys.map((key) => (
                <ShortcutToken className="h-4 min-w-4 justify-center px-1 text-[9.5px]" key={key} value={key} />
              ))}
              {action}
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RoomNameOptionLabel({ option }: { option: RoomNameOption }) {
  const i18n = usePascalI18n()
  if (option.kind === 'typed') {
    return (
      <span className="min-w-0 flex-1 truncate">
        {messageWithSlot(
          i18n,
          /* i18n */ { id: 'editor.panels.roomPanel.useTyped', message: '{use} “{name}”', values: { name: option.value } },
          'use',
          <span className="text-muted-foreground">
            {i18n._({ id: 'editor.panels.roomPanel.use', message: 'Use' })}
          </span>,
        )}
      </span>
    )
  }
  const { label, match } = option
  if (!match) return <span className="min-w-0 flex-1 truncate">{label}</span>
  return (
    <span className="min-w-0 flex-1 truncate">
      {label.slice(0, match.start)}
      <span className="font-semibold underline decoration-muted-foreground underline-offset-3">{label.slice(match.start, match.end)}</span>
      {label.slice(match.end)}
    </span>
  )
}
