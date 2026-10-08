'use client'

import {
  type AnyNode,
  type AnyNodeId,
  area,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  polygonInteriorPoint,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
  createContext,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { type Group, type Object3D, Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useRoomRecords } from '../../hooks/use-selected-room'
import { getAreaUnitLabel, type LinearUnit, squareMetersToAreaUnit } from '../../lib/measurements'
import { roomFloorElevation } from '../../lib/room-handle-drag'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import {
  clickZoneArea,
  hoverZoneArea,
  leaveZoneArea,
  zoneKindLabel,
} from '../../lib/room-zone-routing'
import { selectionModifiersFromEvent } from '../../lib/selection-routing'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'

const CONTEXT_TYPES = new Set(['site', 'building', 'level'])

export type RoomLabelVisibilityState = {
  phase: string
  mode: string
  scopeIdle: boolean
  room: unknown
  selectedTypes: readonly (string | undefined)[]
  zoneId: string | null
  focusedUnitId: string | null
  isCaptureMode: boolean
  isThumbnailCapture: boolean
}

/**
 * Room pills are the resting view of a level: inside the building, select tool
 * idle, and nothing picked but the site, building or level itself. Anything
 * selected, a unit being arranged, or a gesture in flight takes them away.
 */
export function roomLabelsVisible(state: RoomLabelVisibilityState): boolean {
  return (
    state.phase === 'building' &&
    state.mode === 'select' &&
    state.scopeIdle &&
    !state.room &&
    !state.zoneId &&
    !state.focusedUnitId &&
    !state.isCaptureMode &&
    !state.isThumbnailCapture &&
    state.selectedTypes.every((type) => type !== undefined && CONTEXT_TYPES.has(type))
  )
}

export function formatRoomArea(squareMeters: number, unit: LinearUnit): string {
  return `${squareMetersToAreaUnit(squareMeters, unit).toFixed(1)} ${getAreaUnitLabel(unit)}`
}

function useRoomLabelsVisible() {
  const [isThumbnailCapture, setThumbnailCapture] = useState(false)
  useEffect(() => {
    const hide = () => setThumbnailCapture(true)
    const restore = () => setThumbnailCapture(false)
    emitter.on('thumbnail:before-capture', hide)
    emitter.on('thumbnail:after-capture', restore)
    return () => {
      emitter.off('thumbnail:before-capture', hide)
      emitter.off('thumbnail:after-capture', restore)
    }
  }, [])
  const editor = useEditor(
    useShallow((s) => ({
      phase: s.phase,
      mode: s.mode,
      room: s.room,
      isCaptureMode: s.isCaptureMode,
    })),
  )
  const scopeIdle = useInteractionScope((s) => s.scope.kind === 'idle')
  const zoneId = useViewer((s) => s.selection.zoneId)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedTypes = useScene(
    useShallow((s) =>
      selectedIds.map((id) => (s.nodes[id as AnyNodeId] as AnyNode | undefined)?.type),
    ),
  )
  return roomLabelsVisible({
    ...editor,
    scopeIdle,
    zoneId,
    focusedUnitId,
    selectedTypes,
    isThumbnailCapture,
  })
}

type LabelRect = { left: number; top: number; right: number; bottom: number }

/** A pill's screen rect: centred on where its anchor lands, at its size. */
export function pillRect(x: number, y: number, [width, height]: readonly [number, number]) {
  return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 }
}

/** A pill to place: where its room's anchor lands on screen, its full size and its room's area. */
export type PillCandidate = {
  id: string
  x: number
  y: number
  size: readonly [number, number]
  area: number
}

/** Where a pill goes: in full (moved `dy` px off its anchor), as its colour dot, or nowhere. */
export type PillPlacement = { mode: 'full' | 'dot' | 'hidden'; dy: number }

/** The collapsed pill: its colour dot in a small round box. */
export const PILL_DOT_SIZE = 16
const PILL_GAP = 2
const NUDGE_STEP = 4

function overlaps(a: LabelRect, b: LabelRect) {
  return (
    a.left < b.right + PILL_GAP &&
    b.left < a.right + PILL_GAP &&
    a.top < b.bottom + PILL_GAP &&
    b.top < a.bottom + PILL_GAP
  )
}

/** 0, then up and down by growing steps, up to `budget` px either way. */
function* nudges(budget: number) {
  yield 0
  for (let d = NUDGE_STEP; d <= budget; d += NUDGE_STEP) {
    yield -d
    yield d
  }
}

/**
 * Where every pill goes so none overlap. Larger rooms are placed first (ties
 * by id, so the order is stable while the camera moves). A pill that overlaps
 * one already placed takes the nearest free slot above or below its room,
 * within one pill height; failing that it collapses to its colour dot, which
 * takes the nearest free slot the same way; only a dot with no free slot is
 * hidden.
 */
export function placePills(candidates: readonly PillCandidate[]): Map<string, PillPlacement> {
  const placed: LabelRect[] = []
  const placements = new Map<string, PillPlacement>()
  const order = [...candidates].sort(
    (a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const pill of order) {
    let placement: PillPlacement = { mode: 'hidden', dy: 0 }
    for (const dy of nudges(pill.size[1])) {
      const rect = pillRect(pill.x, pill.y + dy, pill.size)
      if (placed.some((other) => overlaps(rect, other))) continue
      placed.push(rect)
      placement = { mode: 'full', dy }
      break
    }
    if (placement.mode === 'hidden') {
      for (const dy of nudges(pill.size[1])) {
        const dot = pillRect(pill.x, pill.y + dy, [PILL_DOT_SIZE, PILL_DOT_SIZE])
        if (placed.some((other) => overlaps(dot, other))) continue
        placed.push(dot)
        placement = { mode: 'dot', dy }
        break
      }
    }
    placements.set(pill.id, placement)
  }
  return placements
}

export type RoomLabelEntry = {
  zoneId: string
  polygon: [number, number][]
  holes: [number, number][][]
  area: number
}
type LabelEntry = RoomLabelEntry

// Mid-height of a default storey: above furniture, below the ceiling.
const LABEL_HEIGHT = DEFAULT_LEVEL_HEIGHT / 2
// The view has to hold still this long before pills are re-placed; while it
// moves they keep their places and ride their rooms, so nothing jitters.
const DECLUTTER_REST_SECONDS = 0.12
// Below this the view counts as still: well under a pixel on screen.
const VIEW_EPSILON = 1e-4
/** How long a pill takes to fade, move or collapse. */
export const PILL_FADE_MS = 180

const labelWorld = new Vector3()

function pillFadeMs(): number {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 0
    : PILL_FADE_MS
}

/**
 * When a layer re-places its pills: once the view has held still, and again
 * whenever its pills change while it rests. Still means within an epsilon of
 * the view last seen moving — camera damping keeps nudging the camera by
 * fractions of a millimetre for a second or more after it visibly stops, and
 * waiting for it to stop exactly left pills misplaced for that long.
 */
export class DeclutterClock {
  private reference: number[] | null = null
  private movedAt = Number.NEGATIVE_INFINITY
  private settled = false
  private dirty = true

  /** The pills changed (mounted, unmounted, resized): place them again. */
  invalidate() {
    this.dirty = true
  }

  /** Whether to place pills for this view (any flat list of numbers) at `now` seconds. */
  shouldRead(view: ArrayLike<number>, now: number): boolean {
    const reference = this.reference
    let moved = !reference || reference.length !== view.length
    for (let i = 0; !moved && i < view.length; i++) {
      moved = Math.abs(view[i]! - reference![i]!) > VIEW_EPSILON
    }
    if (moved) {
      this.reference = Array.from(view)
      this.movedAt = now
      this.settled = false
    }
    if (now - this.movedAt < DECLUTTER_REST_SECONDS || (this.settled && !this.dirty)) return false
    this.settled = true
    this.dirty = false
    return true
  }
}

/** The pills a layer has mounted, by zone id; the layer hears each one come and go. */
export class PillElements extends Map<string, HTMLElement> {
  onMount: ((id: string, element: HTMLElement) => void) | null = null
  onUnmount: ((element: HTMLElement) => void) | null = null
  onMeasure: ((id: string, element: HTMLElement) => void) | null = null

  measure(id: string) {
    const element = this.get(id)
    if (element) this.onMeasure?.(id, element)
  }

  override set(id: string, element: HTMLElement) {
    super.set(id, element)
    this.onMount?.(id, element)
    return this
  }

  override delete(id: string) {
    const element = this.get(id)
    const removed = super.delete(id)
    if (element) this.onUnmount?.(element)
    return removed
  }
}

/** Read the full border-box in CSS pixels, even when the dot is showing. */
export function measureFullPill(
  element: HTMLElement,
  read: (element: HTMLElement) => Pick<CSSStyleDeclaration, 'width' | 'height'> = getComputedStyle,
): readonly [number, number] {
  const collapsed = element.dataset.roomLabelCollapsed
  delete element.dataset.roomLabelCollapsed
  try {
    const style = read(element)
    return [Number.parseFloat(style.width), Number.parseFloat(style.height)]
  } finally {
    if (collapsed !== undefined) element.dataset.roomLabelCollapsed = collapsed
  }
}

type Timer = ReturnType<typeof setTimeout>

/**
 * Applies placements to the mounted pills as direct style writes: the nudge
 * as a `translate`, the dot as `data-room-label-collapsed`, both eased by the
 * pill's transition. A hidden pill fades out without taking the pointer, then
 * leaves the DOM (`gone`); one given room again mounts and fades back in.
 */
export class PillPlacer {
  gone: ReadonlySet<string> = new Set()
  private placements = new Map<string, PillPlacement>()
  private readonly fading = new Map<string, Timer>()

  constructor(
    private readonly elements: ReadonlyMap<string, HTMLElement>,
    private readonly onGone: (gone: ReadonlySet<string>) => void,
    private readonly schedule: (run: () => void, ms: number) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
  ) {}

  apply(placements: ReadonlyMap<string, PillPlacement>, fadeMs = pillFadeMs()) {
    this.placements = new Map([...this.placements, ...placements])
    for (const [id, element] of this.elements) {
      const placement = placements.get(id)
      if (!placement) continue
      if (placement.mode !== 'hidden') {
        const timer = this.fading.get(id)
        if (timer !== undefined) this.cancel(timer)
        this.fading.delete(id)
        delete element.dataset.roomLabelHidden
        placePill(element, placement)
        continue
      }
      if (this.fading.has(id)) continue
      element.dataset.roomLabelHidden = ''
      this.fading.set(
        id,
        this.schedule(() => {
          this.fading.delete(id)
          this.setGone(new Set(this.gone).add(id))
        }, fadeMs),
      )
    }
    const kept = [...this.gone].filter((id) => {
      const placement = placements.get(id)
      return !placement || placement.mode === 'hidden'
    })
    if (kept.length !== this.gone.size) this.setGone(new Set(kept))
  }

  /** A pill mounting takes its last placement at once. */
  mount(id: string, element: HTMLElement) {
    const placement = this.placements.get(id)
    if (placement?.mode === 'hidden') element.dataset.roomLabelHidden = ''
    else if (placement) placePill(element, placement)
  }

  /** Remount hidden pills invisibly so changed text or fonts can be measured. */
  remeasure() {
    if (this.gone.size) this.setGone(new Set())
  }

  /** Fade every mounted pill out (the layer is leaving), or back in. */
  showAll(shown: boolean) {
    for (const [id, element] of this.elements) {
      if (!shown) element.dataset.roomLabelHidden = ''
      else if (!this.fading.has(id)) delete element.dataset.roomLabelHidden
    }
  }

  dispose() {
    for (const timer of this.fading.values()) this.cancel(timer)
    this.fading.clear()
  }

  private setGone(gone: ReadonlySet<string>) {
    this.gone = gone
    this.onGone(gone)
  }
}

function placePill(element: HTMLElement, placement: PillPlacement) {
  element.style.translate = placement.dy ? `0 ${placement.dy}px` : ''
  if (placement.mode === 'dot') element.dataset.roomLabelCollapsed = ''
  else delete element.dataset.roomLabelCollapsed
}

/** True while `shown`, and through the fade once it turns false; then false, so the pills unmount. */
export function useFadePresence(shown: boolean, onGone?: () => void): boolean {
  const [present, setPresent] = useState(shown)
  useEffect(() => {
    if (shown) {
      setPresent(true)
      return
    }
    const timer = setTimeout(() => setPresent(false), pillFadeMs())
    return () => clearTimeout(timer)
  }, [shown])
  const goneRef = useRef(onGone)
  goneRef.current = onGone
  const isPresent = shown || present
  useEffect(() => {
    if (!isPresent) goneRef.current?.()
  }, [isPresent])
  return isPresent
}

/**
 * One pill layer per level: the current level's fades in, a level just left
 * fades out over the next one, then unmounts.
 */
function useFadingLevels(levelId: string | null, visible: boolean) {
  const [levels, setLevels] = useState<string[]>([])
  useEffect(() => {
    if (levelId && visible) {
      setLevels((previous) => (previous.includes(levelId) ? previous : [...previous, levelId]))
    }
  }, [levelId, visible])
  const drop = useCallback(
    (id: string) => setLevels((previous) => previous.filter((level) => level !== id)),
    [],
  )
  return { levels, drop }
}

/**
 * The placement state of one layer: its mounted pills, the full size each
 * last rendered at (observed, so a web font arriving, a rename or a unit
 * change re-places them; kept for pills that have left the DOM), and the
 * placer that moves, collapses and fades them.
 */
function usePillPlacement(shown: boolean, entries: readonly LabelEntry[]) {
  const [elements] = useState(() => new PillElements())
  const [clock] = useState(() => new DeclutterClock())
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [placer] = useState(() => new PillPlacer(elements, setGone))
  const unit = useViewer((s) => s.unit)
  const sizes = useRef(new Map<string, readonly [number, number]>())
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    elements.onMeasure = (id, element) => {
      const size = measureFullPill(element)
      if (!(size[0] > 0 && size[1] > 0)) return
      const previous = sizes.current.get(id)
      if (
        previous &&
        Math.abs(previous[0] - size[0]) < 0.01 &&
        Math.abs(previous[1] - size[1]) < 0.01
      )
        return
      sizes.current.set(id, size)
      clock.invalidate()
    }
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((records) => {
            for (const record of records) {
              const element = record.target as HTMLElement
              const id = element.dataset.roomLabel
              const box = record.borderBoxSize?.[0]
              if (!(id && box && box.inlineSize > 0)) continue
              // A dot coming back on screen may have changed text while its
              // wrapper was display:none, when its full width was unreadable.
              if ('roomLabelCollapsed' in element.dataset) elements.measure(id)
              else sizes.current.set(id, [box.inlineSize, box.blockSize])
            }
            clock.invalidate()
          })
    elements.onMount = (id, element) => {
      if (!shownRef.current) element.dataset.roomLabelHidden = ''
      placer.mount(id, element)
      elements.measure(id)
      observer?.observe(element)
      clock.invalidate()
    }
    elements.onUnmount = (element) => {
      observer?.unobserve(element)
      clock.invalidate()
    }
    for (const [id, element] of elements) elements.onMount(id, element)
    const fontsChanged = () => {
      placer.remeasure()
      for (const id of elements.keys()) elements.measure(id)
    }
    document.fonts?.addEventListener('loadingdone', fontsChanged)
    return () => {
      elements.onMount = null
      elements.onUnmount = null
      elements.onMeasure = null
      document.fonts?.removeEventListener('loadingdone', fontsChanged)
      observer?.disconnect()
      placer.dispose()
    }
  }, [clock, elements, placer])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Hidden pills must remount to measure changed entries or units.
  useEffect(() => {
    placer.remeasure()
    clock.invalidate()
  }, [clock, entries, placer, unit])
  useEffect(() => {
    placer.showAll(shown)
    if (shown) clock.invalidate()
  }, [clock, placer, shown])
  return { elements, clock, gone, placer, sizes: sizes.current }
}

/** The pills of one level: every detected room, and every drawn zone that bounds none. */
export function roomLabelEntries(
  rooms: readonly RoomSelectionRecord[],
  zones: readonly ZoneNode[],
): RoomLabelEntry[] {
  const hiddenIds = new Set<string>(
    zones.filter((zone) => zone.visible === false).map((zone) => zone.id),
  )
  const roomIds = new Set(rooms.map((room) => room.zoneId))
  return [
    ...rooms
      .filter((room) => !hiddenIds.has(room.zoneId))
      .map((room) => ({
        zoneId: room.zoneId,
        polygon: room.polygon,
        holes: room.holes,
        area: room.area,
      })),
    ...zones
      .filter((zone) => zone.visible !== false && !roomIds.has(zone.id) && zone.polygon.length >= 3)
      .map((zone) => ({
        zoneId: zone.id,
        polygon: zone.polygon,
        holes: zone.holes ?? [],
        area: area([{ outer: zone.polygon, holes: zone.holes ?? [] }]),
      })),
  ]
}

function useRoomLabelEntries(levelId: string | null): LabelEntry[] {
  const rooms = useRoomRecords(levelId)
  const zones = useScene(
    useShallow((s) =>
      levelId
        ? Object.values(s.nodes).filter(
            (node): node is ZoneNode => node.type === 'zone' && node.parentId === levelId,
          )
        : [],
    ),
  )
  return useMemo(() => roomLabelEntries(rooms, zones), [rooms, zones])
}

/** The pill itself: a colour dot, the name, the area in the active unit. */
export function RoomPillChip({
  zoneId,
  view,
  color,
  name,
  areaM2,
  elements,
  onClick,
  onHover,
  onLeave,
}: {
  zoneId: string
  view: '2d' | '3d'
  color: string
  name: string
  areaM2: number
  elements?: Map<string, HTMLElement>
  onClick: (event: ReactMouseEvent) => void
  onHover: (event: ReactPointerEvent) => void
  onLeave: () => void
}) {
  const unit = useViewer((s) => s.unit)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A dot's border box does not resize when its hidden text changes.
  useLayoutEffect(() => {
    if (elements instanceof PillElements) elements.measure(zoneId)
  }, [areaM2, elements, name, unit, zoneId])
  const register = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) elements?.set(zoneId, element)
      else elements?.delete(zoneId)
    },
    [elements, zoneId],
  )
  return (
    <div
      // Fades in as it mounts and out (taking no pointer) while the layer hides
      // it; eases into its nudged place; collapsed, it is its dot until hovered.
      className="pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-neutral-950/75 px-2.5 py-1 text-white text-xs shadow-sm backdrop-blur-sm transition-[opacity,translate,background-color] duration-180 hover:bg-neutral-950/90 starting:opacity-0 data-room-label-hidden:pointer-events-none data-room-label-hidden:opacity-0 motion-reduce:transition-none [&[data-room-label-collapsed]:not(:hover)]:gap-0 [&[data-room-label-collapsed]:not(:hover)]:p-[3px]"
      data-room-label={zoneId}
      data-room-label-view={view}
      onClick={(event) => {
        event.stopPropagation()
        onClick(event)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      // Move as well as enter: leaving the canvas for the pill ends the canvas
      // hover after the pill's enter has run.
      onPointerEnter={onHover}
      onPointerLeave={onLeave}
      onPointerMove={onHover}
      ref={register}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium [[data-room-label-collapsed]:not(:hover)>&]:hidden">{name}</span>
      <span className="font-mono text-white/60 tabular-nums [[data-room-label-collapsed]:not(:hover)>&]:hidden">
        {formatRoomArea(areaM2, unit)}
      </span>
    </div>
  )
}

/**
 * One room's pill in the editor. Hover and click take the same rule as the
 * zone's area in the plan (`hoverZoneArea`, `clickZoneArea`); only the pill
 * itself takes the pointer.
 */
function RoomPill({
  entry,
  view,
  elements,
}: {
  entry: LabelEntry
  view: '2d' | '3d'
  elements?: Map<string, HTMLElement>
}) {
  const zone = useScene((s) => s.nodes[entry.zoneId as AnyNodeId] as ZoneNode | undefined)
  // A pill that disappears under the cursor (its click selected something)
  // fires no leave: end the hover it set.
  useEffect(() => () => leaveZoneArea(entry.zoneId), [entry.zoneId])
  if (!zone || zone.visible === false) return null
  return (
    <RoomPillChip
      areaM2={entry.area}
      color={zone.color}
      elements={elements}
      name={zone.name?.trim() || zoneKindLabel(zone)}
      onClick={(event) => clickZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onHover={(event) => hoverZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onLeave={() => leaveZoneArea(entry.zoneId)}
      view={view}
      zoneId={entry.zoneId}
    />
  )
}

/** Light name-and-area pills over each room and drawn zone of the active level. */
export function RoomLabels3D() {
  const levelId = useViewer((s) => s.selection.levelId)
  const sceneShown = useEditor((s) => s.viewMode !== '2d')
  const visible = useRoomLabelsVisible() && sceneShown
  const { levels, drop } = useFadingLevels(levelId, visible)
  return levels.map((id) => (
    <LevelRoomLabels3D key={id} levelId={id} onGone={drop} shown={visible && id === levelId} />
  ))
}

function LevelRoomLabels3D({
  levelId,
  shown,
  onGone,
}: {
  levelId: string
  shown: boolean
  onGone: (levelId: string) => void
}) {
  const present = useFadePresence(shown, () => onGone(levelId))
  const entries = useRoomLabelEntries(present ? levelId : null)
  if (!present) return null
  return (
    <RoomPillsLayer3D
      entries={entries}
      levelObject={() => sceneRegistry.nodes.get(levelId)}
      renderLabel={(entry, anchors, elements) => (
        <EditorRoomLabel3D anchors={anchors} elements={elements} entry={entry} />
      )}
      shown={shown}
    />
  )
}

function EditorRoomLabel3D({
  entry,
  anchors,
  elements,
}: {
  entry: LabelEntry
  anchors: Map<string, Vector3>
  elements: Map<string, HTMLElement>
}) {
  const floorY = useScene((s) => roomFloorElevation(s.nodes, entry.zoneId))
  return (
    <RoomLabelAnchor3D anchors={anchors} entry={entry} floorY={floorY}>
      <RoomPill elements={elements} entry={entry} view="3d" />
    </RoomLabelAnchor3D>
  )
}

/**
 * The pills of one level in 3D, riding the level's object (so they follow
 * level stacking) and placed from where their anchors land on screen. They
 * live in their own stacking layer clipped to the canvas, so every piece of
 * UI over the canvas stays above them.
 */
export function RoomPillsLayer3D({
  entries,
  levelObject,
  renderLabel,
  shown = true,
}: {
  entries: readonly LabelEntry[]
  levelObject: () => Object3D | undefined
  renderLabel: (
    entry: LabelEntry,
    anchors: Map<string, Vector3>,
    elements: Map<string, HTMLElement>,
  ) => ReactNode
  shown?: boolean
}) {
  const ref = useRef<Group>(null)
  const anchors = useRef(new Map<string, Vector3>())
  const view = useRef(new Float64Array(50))
  const { elements, clock, gone, placer, sizes } = usePillPlacement(shown, entries)
  const host = useThree((s) => (s.events.connected ?? s.gl.domElement.parentNode) as HTMLElement)
  const [container] = useState(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  )
  const portal = useMemo(() => (container ? { current: container } : null), [container])
  useEffect(() => {
    if (!(host && container)) return
    container.className = 'pointer-events-none absolute inset-0 isolate z-0 overflow-hidden'
    host.appendChild(container)
    return () => container.remove()
  }, [container, host])

  useEffect(() => {
    const ids = new Set(entries.map((entry) => entry.zoneId))
    for (const id of anchors.current.keys()) if (!ids.has(id)) anchors.current.delete(id)
    clock.invalidate()
  }, [clock, entries])

  useFrame(({ camera, clock: frameClock, size }) => {
    if (!ref.current) return
    const level = levelObject()
    ref.current.visible = !!level
    if (!level) return
    level.updateWorldMatrix(true, false)
    ref.current.matrix.copy(level.matrixWorld)

    const flat = view.current
    flat.set(camera.matrixWorld.elements, 0)
    flat.set(camera.projectionMatrix.elements, 16)
    flat.set(level.matrixWorld.elements, 32)
    flat[48] = size.width
    flat[49] = size.height
    if (!(shown && clock.shouldRead(flat, frameClock.elapsedTime))) return

    const candidates: PillCandidate[] = []
    for (const entry of entries) {
      const anchor = anchors.current.get(entry.zoneId)
      const pill = sizes.get(entry.zoneId)
      if (!(anchor && pill)) continue
      labelWorld.copy(anchor).applyMatrix4(level.matrixWorld).project(camera)
      // Behind the camera or past its far plane: not on screen to collide.
      if (Math.abs(labelWorld.z) > 1) continue
      candidates.push({
        id: entry.zoneId,
        x: ((labelWorld.x + 1) / 2) * size.width,
        y: ((1 - labelWorld.y) / 2) * size.height,
        size: pill,
        area: entry.area,
      })
    }
    placer.apply(placePills(candidates))
  })

  if (entries.length === 0 || !portal) return null
  return (
    <PillPortalContext.Provider value={portal}>
      <HiddenPillsContext.Provider value={gone}>
        <group matrixAutoUpdate={false} ref={ref}>
          {entries.map((entry) => (
            <Fragment key={entry.zoneId}>{renderLabel(entry, anchors.current, elements)}</Fragment>
          ))}
        </group>
      </HiddenPillsContext.Provider>
    </PillPortalContext.Provider>
  )
}

const PillPortalContext = createContext<{ current: HTMLElement } | null>(null)
const HiddenPillsContext = createContext<ReadonlySet<string>>(new Set())

/** Where a room's pill floats: over its interior, at mid-storey above its floor. */
export function RoomLabelAnchor3D({
  entry,
  floorY,
  anchors,
  children,
}: {
  entry: LabelEntry
  floorY: number
  anchors: Map<string, Vector3>
  children: ReactNode
}) {
  const portal = useContext(PillPortalContext)
  const gone = useContext(HiddenPillsContext)
  const position = useMemo(() => {
    const [x, z] = polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes })
    return new Vector3(x, floorY + LABEL_HEIGHT, z)
  }, [entry.polygon, entry.holes, floorY])
  // Hidden HTML still needs a live anchor so moving a room can give its pill
  // room again. The layer drops anchors of rooms that left.
  useEffect(() => {
    anchors.set(entry.zoneId, position)
  }, [anchors, entry.zoneId, position])
  if (gone.has(entry.zoneId)) return null
  return (
    <Html
      center
      portal={portal ?? undefined}
      position={position}
      // The wrapper lets the canvas keep everything but the pill itself; a
      // hovered pill (a dot opening to its full pill) comes to the front.
      style={{ pointerEvents: 'none' }}
      wrapperClass="has-[[data-room-label]:hover]:z-30!"
      zIndexRange={[20, 0]}
    >
      {children}
    </Html>
  )
}

/**
 * The same pills over the 2D plan: screen-positioned from the plan's transform,
 * re-placed as in 3D once the plan rests, and clipped to the plan's pane in the
 * plan's own stacking layer, under the UI over it.
 */
export function RoomLabels2D({ levelId }: { levelId: string | null }) {
  const planShown = useEditor((s) => s.viewMode !== '3d')
  const visible = useRoomLabelsVisible() && planShown
  const { levels, drop } = useFadingLevels(levelId, visible)
  return levels.map((id) => (
    <LevelRoomLabels2D key={id} levelId={id} onGone={drop} shown={visible && id === levelId} />
  ))
}

function LevelRoomLabels2D({
  levelId,
  shown,
  onGone,
}: {
  levelId: string
  shown: boolean
  onGone: (levelId: string) => void
}) {
  const present = useFadePresence(shown, () => onGone(levelId))
  const entries = useRoomLabelEntries(present ? levelId : null)
  const ref = useRef<SVGGElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [nodes] = useState(() => new PillElements())
  const { elements, clock, gone, placer, sizes } = usePillPlacement(shown, entries)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const anchors = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.zoneId,
          polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes }),
        ]),
      ),
    [entries],
  )

  useEffect(() => {
    setHost(ref.current?.ownerSVGElement?.parentElement ?? null)
  }, [])

  useEffect(() => {
    if (!present || entries.length === 0) return
    let raf = 0
    let lastKey = ''
    const view = new Float64Array(10)
    // A pill wrapper that mounts is placed on the next frame.
    nodes.onMount = () => {
      lastKey = ''
    }
    clock.invalidate()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const group = ref.current
      const svg = group?.ownerSVGElement
      const ctm = group?.getScreenCTM()
      const paneElement = paneRef.current
      if (!(svg && ctm && paneElement)) return
      const pane = svg.getBoundingClientRect()
      const origin = paneElement.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 }
      const key = `${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f},${pane.left},${pane.top},${pane.width},${pane.height},${origin.left},${origin.top}`
      const point = svg.createSVGPoint()
      const place = (anchor: [number, number]) => {
        point.x = anchor[0]
        point.y = anchor[1]
        const screen = point.matrixTransform(ctm)
        return [screen.x - pane.left, screen.y - pane.top] as const
      }
      const inside = ([x, y]: readonly [number, number]) =>
        x >= 0 && x <= pane.width && y >= 0 && y <= pane.height
      if (key !== lastKey) {
        lastKey = key
        Object.assign(paneElement.style, {
          left: `${pane.left - origin.left}px`,
          top: `${pane.top - origin.top}px`,
          width: `${pane.width}px`,
          height: `${pane.height}px`,
        })
        for (const [id, element] of nodes) {
          const anchor = anchors.get(id)
          if (!anchor) continue
          const at = place(anchor)
          element.style.left = `${at[0]}px`
          element.style.top = `${at[1]}px`
          element.style.display = inside(at) ? '' : 'none'
        }
      }
      view[0] = ctm.a
      view[1] = ctm.b
      view[2] = ctm.c
      view[3] = ctm.d
      view[4] = ctm.e
      view[5] = ctm.f
      view[6] = pane.left
      view[7] = pane.top
      view[8] = pane.width
      view[9] = pane.height
      if (!(shownRef.current && clock.shouldRead(view, now / 1000))) return
      const candidates: PillCandidate[] = []
      for (const entry of entries) {
        const anchor = anchors.get(entry.zoneId)
        const pill = sizes.get(entry.zoneId)
        if (!(anchor && pill)) continue
        const at = place(anchor)
        if (!inside(at)) continue
        candidates.push({ id: entry.zoneId, x: at[0], y: at[1], size: pill, area: entry.area })
      }
      placer.apply(placePills(candidates))
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      nodes.onMount = null
    }
  }, [anchors, clock, entries, nodes, placer, present, sizes])

  return (
    <g ref={ref}>
      {present &&
        host &&
        createPortal(
          <div className="pointer-events-none absolute isolate z-0 overflow-hidden" ref={paneRef}>
            {entries
              .filter((entry) => !gone.has(entry.zoneId))
              .map((entry) => (
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 has-[[data-room-label]:hover]:z-10"
                  key={entry.zoneId}
                  ref={(element) => {
                    if (element) nodes.set(entry.zoneId, element)
                    else nodes.delete(entry.zoneId)
                  }}
                  style={{ display: 'none' }}
                >
                  <RoomPill elements={elements} entry={entry} view="2d" />
                </div>
              ))}
          </div>,
          host,
        )}
    </g>
  )
}
