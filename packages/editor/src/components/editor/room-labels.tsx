'use client'

import {
  type AnyNode,
  type AnyNodeId,
  area,
  containsPoint,
  DEFAULT_LEVEL_HEIGHT,
  emitter,
  type Polygon,
  polygonInteriorPoint,
  type Ring,
  sceneRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { timeSpan, useViewer } from '@pascal-app/viewer'
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
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import {
  type Camera,
  type Group,
  Matrix4,
  type Object3D,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
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
import { isViewVisible, VIEW_2D, VIEW_3D } from '../../store/view-layout'

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

export type LabelRect = { left: number; top: number; right: number; bottom: number }
type PaneSize = { width: number; height: number }

/** A pill's screen rect: centred on where its anchor lands, at its size. */
export function pillRect(x: number, y: number, [width, height]: readonly [number, number]) {
  return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 }
}

/** A pill's measured size: its full width, its height, and its width with the name alone. */
export type PillSize = readonly [fullWidth: number, height: number, nameWidth: number]

/** How much of a pill shows: dot, name and area; dot and name; its dot; nothing. */
export type PillTier = 'full' | 'name' | 'dot' | 'hidden'

/** Where a pill goes: how much of it shows, moved `dy` px off its anchor. */
export type PillPlacement = { tier: PillTier; dy: number }

/**
 * A pill to place: where its room's anchor lands on screen, its size, its
 * room's area and the part of the room's outline in front of the camera, on
 * screen.
 */
export type PillCandidate = {
  id: string
  x: number
  y: number
  size: PillSize
  area: number
  outline: Polygon
}

/** The collapsed pill: its colour dot in a small round box. */
const PILL_DOT_SIZE = 16
/** The clear space around a placed pill, and around the detail chip. */
export const PILL_GAP = 4
const NUDGE_STEP = 4
const TIERS = ['full', 'name', 'dot'] as const

function near(a: LabelRect, b: LabelRect) {
  return (
    a.left < b.right + PILL_GAP &&
    b.left < a.right + PILL_GAP &&
    a.top < b.bottom + PILL_GAP &&
    b.top < a.bottom + PILL_GAP
  )
}

function tierSize(size: PillSize, tier: Exclude<PillTier, 'hidden'>): readonly [number, number] {
  if (tier === 'full') return [size[0], size[1]]
  if (tier === 'name') return [size[2], size[1]]
  return [PILL_DOT_SIZE, PILL_DOT_SIZE]
}

/** The rect a placed pill takes on screen, or null when it is hidden. */
export function placedRect(pill: PillCandidate, { tier, dy }: PillPlacement): LabelRect | null {
  return tier === 'hidden' ? null : pillRect(pill.x, pill.y + dy, tierSize(pill.size, tier))
}

function segmentTouchesRect(
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  rect: LabelRect,
) {
  if (
    Math.max(ax, bx) < rect.left ||
    Math.min(ax, bx) > rect.right ||
    Math.max(ay, by) < rect.top ||
    Math.min(ay, by) > rect.bottom
  )
    return false
  // Liang–Barsky: narrow the segment's span to each side of the rect in turn.
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return (
    clip(ax - bx, ax - rect.left) &&
    clip(bx - ax, rect.right - ax) &&
    clip(ay - by, ay - rect.top) &&
    clip(by - ay, rect.bottom - ay)
  )
}

function ringTouchesRect(ring: Ring, rect: LabelRect) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segmentTouchesRect(ring[j]!, ring[i]!, rect)) return true
  }
  return false
}

/**
 * Whether `rect` lies inside `outline`: no edge of the outline or its holes
 * touches the rect, and the rect's centre is inside.
 */
function rectInPolygon(rect: LabelRect, outline: Polygon): boolean {
  if (ringTouchesRect(outline.outer, rect)) return false
  if (outline.holes.some((hole) => ringTouchesRect(hole, rect))) return false
  return containsPoint([outline], [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2])
}

/**
 * 0, then the nudge the pill took last time (so it keeps to that side), then
 * up and down by growing steps, up to `budget` px either way.
 */
function* nudges(budget: number, previous: number | undefined) {
  yield 0
  if (previous) yield previous
  for (let d = NUDGE_STEP; d <= budget; d += NUDGE_STEP) {
    if (-d !== previous) yield -d
    if (d !== previous) yield d
  }
}

function ringBox(ring: Ring): LabelRect {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const [x, y] of ring) {
    box.left = Math.min(box.left, x)
    box.top = Math.min(box.top, y)
    box.right = Math.max(box.right, x)
    box.bottom = Math.max(box.bottom, y)
  }
  return box
}

function slotFor(
  pill: PillCandidate,
  bounds: PaneSize,
  placed: LabelRect[],
  previous: PillPlacement | undefined,
): PillPlacement {
  const { outline } = pill
  // The pane, narrowed to the room's bounding box: cheap to reject against.
  const box = ringBox(outline.outer)
  box.left = Math.max(box.left, 0)
  box.top = Math.max(box.top, 0)
  box.right = Math.min(box.right, bounds.width)
  box.bottom = Math.min(box.bottom, bounds.height)
  for (const tier of TIERS) {
    const size = tierSize(pill.size, tier)
    // Wider or taller than the room's box: no nudge fits it.
    if (size[0] > box.right - box.left || size[1] > box.bottom - box.top) continue
    const budget = tier === 'dot' ? PILL_DOT_SIZE : pill.size[1]
    for (const dy of nudges(budget, previous?.tier === tier ? previous.dy : undefined)) {
      const rect = pillRect(pill.x, pill.y + dy, size)
      if (
        rect.left < box.left ||
        rect.top < box.top ||
        rect.right > box.right ||
        rect.bottom > box.bottom
      )
        continue
      if (!rectInPolygon(rect, outline)) continue
      if (placed.some((other) => near(rect, other))) continue
      placed.push(rect)
      return { tier, dy }
    }
  }
  return { tier: 'hidden', dy: 0 }
}

/**
 * Where every pill goes, so that none overlap and each stays inside its room
 * and the pane. Larger rooms are placed first (ties by id, so the order holds
 * while the camera moves). Each pill takes the first slot that fits: its full
 * pill, then its name alone, then its dot, each at its anchor or nudged up or
 * down; with no slot it is hidden. A room's size on screen decides how much of
 * its label shows, so the detail follows the zoom.
 */
export function placePills(
  candidates: readonly PillCandidate[],
  bounds: PaneSize,
  previous: ReadonlyMap<string, PillPlacement> = new Map(),
): Map<string, PillPlacement> {
  const placed: LabelRect[] = []
  const placements = new Map<string, PillPlacement>()
  const order = [...candidates].sort(
    (a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const pill of order)
    placements.set(pill.id, slotFor(pill, bounds, placed, previous.get(pill.id)))
  return placements
}

/** The placed pills whose rects come within the gap of `chip`. */
export function suppressedBy(
  chip: LabelRect,
  rects: ReadonlyMap<string, LabelRect>,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const [id, rect] of rects) if (near(chip, rect)) ids.add(id)
  return ids
}

export type RoomLabelEntry = {
  zoneId: string
  polygon: [number, number][]
  holes: [number, number][][]
  area: number
}
type LabelEntry = RoomLabelEntry

/** Where the pointer meets a room's plane: the point in it, and how far along the pointer's ray. */
export type RoomHit = readonly [x: number, y: number, distance: number]

// Planes closer together than this along the ray (in metres) count as one floor.
const SAME_FLOOR = 1e-3

/**
 * The room under the pointer: of the rooms whose outline, holes excluded,
 * holds the point where the pointer meets their plane, the nearest along the
 * pointer's ray (the floor it reaches first), then the smallest (a zone drawn
 * inside a room, on the same floor). `pointOn` gives that point for each room
 * (in 3D, where the ray meets the room's floor), or null if it never meets it.
 */
export function roomAt(
  entries: readonly RoomLabelEntry[],
  pointOn: (entry: RoomLabelEntry) => RoomHit | null,
): string | null {
  let found: RoomLabelEntry | null = null
  let foundAt = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    const hit = pointOn(entry)
    if (!hit) continue
    const [x, y, distance] = hit
    if (found) {
      const nearer = distance < foundAt - SAME_FLOOR
      const sameFloor = !nearer && distance <= foundAt + SAME_FLOOR
      if (!(nearer || (sameFloor && entry.area < found.area))) continue
    }
    if (containsPoint([{ outer: entry.polygon, holes: entry.holes }], [x, y])) {
      found = entry
      foundAt = distance
    }
  }
  return found?.zoneId ?? null
}

// Mid-height of a default storey: above furniture, below the ceiling.
const LABEL_HEIGHT = DEFAULT_LEVEL_HEIGHT / 2
// The view has to hold still this long before pills are re-placed; while it
// moves they keep their places and ride their rooms, so nothing jitters.
const DECLUTTER_REST_SECONDS = 0.12
// Below this the view counts as still: well under a pixel on screen.
const VIEW_EPSILON = 1e-4
/** How long a pill takes to fade, move or collapse. */
const PILL_FADE_MS = 180
/** How long the pointer rests on a room before its detail opens. */
export const REVEAL_DWELL_MS = 80
/** How long the detail stays once the pointer has left its room. */
export const REVEAL_GRACE_MS = 120
// The detail chip stays this far inside its layer.
const DETAIL_INSET = 8

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

  /** Whether the view rests and its pills were placed for it. */
  get atRest() {
    return this.settled
  }

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

/** Where each room's pill floats, level-local; moving one has the pills placed again. */
export class RoomAnchors extends Map<string, Vector3> {
  onMove: (() => void) | null = null

  override set(id: string, position: Vector3) {
    const moved = !this.get(id)?.equals(position)
    super.set(id, position)
    if (moved) this.onMove?.()
    return this
  }
}

/** Read a pill's full border-box and its width without the area, whatever it shows now. */
export function measureFullPill(
  element: HTMLElement,
  read: (
    element: Element,
  ) => Pick<CSSStyleDeclaration, 'width' | 'height' | 'columnGap'> = getComputedStyle,
): PillSize {
  const tier = element.dataset.roomLabelTier
  delete element.dataset.roomLabelTier
  try {
    const style = read(element)
    const width = Number.parseFloat(style.width)
    const areaLabel = element.querySelector('[data-room-label-area]')
    const areaWidth = areaLabel
      ? Number.parseFloat(read(areaLabel).width) + Number.parseFloat(style.columnGap)
      : 0
    return [width, Number.parseFloat(style.height), width - areaWidth]
  } finally {
    if (tier !== undefined) element.dataset.roomLabelTier = tier
  }
}

type Timer = ReturnType<typeof setTimeout>
// Wrapped, not passed as is: browsers throw "Illegal invocation" when the
// global timers are called as methods of another object.
const startTimer = (run: () => void, ms: number): Timer => setTimeout(run, ms)
const stopTimer = (timer: Timer) => clearTimeout(timer)

/**
 * Applies placements to the mounted pills as direct style writes: the nudge
 * as a `translate`, the tier as `data-room-label-tier`, both eased by the
 * pill's transition. A pill placed hidden fades out without taking the
 * pointer, then leaves the DOM (`gone`); one given room again mounts and fades
 * back in. A mounted pill that a pass leaves out (not measured yet, or its
 * anchor off screen) waits hidden: no pill shows that placement has not
 * cleared.
 */
export class PillPlacer {
  gone: ReadonlySet<string> = new Set()
  /** The last pass's placements: a remounting pill takes its own at once. */
  placements: ReadonlyMap<string, PillPlacement> = new Map()
  private readonly fading = new Map<string, Timer>()
  private suppressed: ReadonlySet<string> = new Set()
  private open: string | null = null
  private shown = true

  constructor(
    private readonly elements: ReadonlyMap<string, HTMLElement>,
    private readonly onGone: (gone: ReadonlySet<string>) => void,
    private readonly schedule: (run: () => void, ms: number) => Timer = startTimer,
    private readonly cancel: (timer: Timer) => void = stopTimer,
  ) {}

  apply(placements: ReadonlyMap<string, PillPlacement>, fadeMs = pillFadeMs()) {
    this.placements = placements
    for (const [id, element] of this.elements) {
      const placement = placements.get(id)
      if (placement && placement.tier !== 'hidden') {
        const timer = this.fading.get(id)
        if (timer !== undefined) this.cancel(timer)
        this.fading.delete(id)
        this.show(element, placement)
        continue
      }
      element.dataset.roomLabelHidden = ''
      if (!placement || this.fading.has(id)) continue
      this.fading.set(
        id,
        this.schedule(() => {
          this.fading.delete(id)
          this.setGone(new Set(this.gone).add(id))
        }, fadeMs),
      )
    }
    const kept = [...this.gone].filter((id) => (placements.get(id)?.tier ?? 'hidden') === 'hidden')
    if (kept.length !== this.gone.size) this.setGone(new Set(kept))
  }

  /** A pill mounting takes its last placement at once, or waits hidden for one. */
  mount(id: string, element: HTMLElement) {
    const placement = this.placements.get(id)
    if (placement && placement.tier !== 'hidden') this.show(element, placement)
    else element.dataset.roomLabelHidden = ''
    this.mark(id, element)
  }

  /**
   * Fade the pills under the detail chip out of its way, and every other back.
   * The open room's own pill fades too but still takes the pointer: the chip
   * over it is read-only, so the pill stays the control.
   */
  suppress(ids: ReadonlySet<string>, open: string | null) {
    this.suppressed = ids
    this.open = open
    for (const [id, element] of this.elements) this.mark(id, element)
  }

  /** Remount hidden pills invisibly so changed text or fonts can be measured. */
  remeasure() {
    if (this.gone.size) this.setGone(new Set())
  }

  /** Fade every mounted pill out (the layer is leaving), or the placed ones back in. */
  showAll(shown: boolean) {
    this.shown = shown
    for (const [id, element] of this.elements) {
      const placement = this.placements.get(id)
      if (shown && placement && placement.tier !== 'hidden') delete element.dataset.roomLabelHidden
      else element.dataset.roomLabelHidden = ''
    }
  }

  dispose() {
    for (const timer of this.fading.values()) this.cancel(timer)
    this.fading.clear()
  }

  private show(element: HTMLElement, { tier, dy }: PillPlacement) {
    const translate = dy ? `0 ${dy}px` : ''
    if (element.style.translate !== translate) element.style.translate = translate
    if (tier === 'full') delete element.dataset.roomLabelTier
    else if (element.dataset.roomLabelTier !== tier) element.dataset.roomLabelTier = tier
    if (this.shown) delete element.dataset.roomLabelHidden
    else element.dataset.roomLabelHidden = ''
  }

  private mark(id: string, element: HTMLElement) {
    const { dataset } = element
    if (id === this.open) dataset.roomLabelOpen = ''
    else delete dataset.roomLabelOpen
    if (id !== this.open && this.suppressed.has(id)) dataset.roomLabelSuppressed = ''
    else delete dataset.roomLabelSuppressed
  }

  private setGone(gone: ReadonlySet<string>) {
    this.gone = gone
    this.onGone(gone)
  }
}

/**
 * Which room's detail chip is open. A pill under the pointer, or a pill with
 * keyboard focus, opens at once; when both are set, whichever moved last
 * wins. Otherwise the room under the pointer opens once the pointer has
 * rested on it for a moment, and stays a moment after the pointer leaves, so
 * crossing a wall hands over from one room to the next without a gap and
 * passing over a room opens nothing. Escape closes it until the pointer or
 * focus moves on to another room.
 */
export class LabelReveal {
  active: string | null = null
  private activeFocused = false
  private hovered: string | null = null
  private focused: string | null = null
  private picked: string | null = null
  private keyboardLast = false
  private dismissed: string | null = null
  private pending: { id: string | null; timer: Timer } | null = null

  constructor(
    private readonly onChange: (id: string | null, focused: boolean) => void,
    private readonly schedule: (run: () => void, ms: number) => Timer = startTimer,
    private readonly cancel: (timer: Timer) => void = stopTimer,
  ) {}

  /** The pill under the pointer. */
  hover(id: string | null) {
    if (id !== null && id !== this.hovered) this.keyboardLast = false
    this.hovered = id
    this.update()
  }

  /** The pill with keyboard focus. */
  focus(id: string | null) {
    if (id !== null) this.keyboardLast = true
    this.focused = id
    this.update()
  }

  /** The room under the pointer. */
  pick(id: string | null) {
    this.picked = id
    this.update()
  }

  /** Close what is open, and keep it closed while the pointer and focus stay on it. */
  dismiss() {
    if (this.active === null) return
    this.dismissed = this.active
    this.stop()
    this.set(null)
  }

  /**
   * Close at once and forget the pointer: the view moved, or the layer hid.
   * Focus is kept, so a focused pill opens again once the view rests.
   */
  clear() {
    this.hovered = null
    this.picked = null
    this.stop()
    this.set(null)
  }

  private update() {
    const direct = this.keyboardLast
      ? (this.focused ?? this.hovered)
      : (this.hovered ?? this.focused)
    if (this.dismissed !== null) {
      if ((direct ?? this.picked) === this.dismissed) {
        this.stop()
        return
      }
      this.dismissed = null
    }
    if (direct) {
      this.stop()
      this.set(direct)
      return
    }
    const next = this.picked
    if (next === this.active) {
      this.stop()
      this.set(next)
      return
    }
    if (this.pending && this.pending.id === next) return
    this.stop()
    this.pending = {
      id: next,
      timer: this.schedule(
        () => {
          this.pending = null
          this.set(next)
        },
        next ? REVEAL_DWELL_MS : REVEAL_GRACE_MS,
      ),
    }
  }

  private stop() {
    if (this.pending) this.cancel(this.pending.timer)
    this.pending = null
  }

  private set(id: string | null) {
    const focused = id !== null && this.focused === id
    if (id === this.active && focused === this.activeFocused) return
    this.active = id
    this.activeFocused = focused
    this.onChange(id, focused)
  }
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

/** Where the detail chip opens, in its layer's px: on the pill's colour dot, or centred. */
type DetailOrigin = { x: number; y: number; onDot: boolean; bounds: PaneSize }
type RoomLabelDetailState = { id: string; open: boolean; focused: boolean; at: DetailOrigin }
type PointerAt = { x: number; y: number }

/**
 * One layer's placement and reveal, shared by its frame loop, its pointer
 * listeners and its pills: the pills it has mounted, the size each last
 * rendered at (kept for pills that left the DOM), the last placement pass, and
 * which room's detail is open.
 */
class PillLayer {
  readonly elements = new PillElements()
  readonly clock = new DeclutterClock()
  readonly sizes = new Map<string, PillSize>()
  readonly placer: PillPlacer
  readonly reveal: LabelReveal
  container: () => HTMLElement | null = () => null
  surface: () => Element | null | undefined = () => null
  /** The pointer over the host in client px while no button is down, null off it. */
  pointer: PointerAt | null = null
  pointerMoved = false
  private candidates = new Map<string, PillCandidate>()
  private rects = new Map<string, LabelRect>()
  private bounds: PaneSize = { width: 0, height: 0 }
  private chip: LabelRect | null = null
  // The open detail, a store of its own: see `OpenRoomLabelDetail`.
  private detail: RoomLabelDetailState | null = null
  private readonly detailListeners = new Set<() => void>()

  constructor(onGone: (gone: ReadonlySet<string>) => void) {
    this.placer = new PillPlacer(this.elements, onGone)
    this.reveal = new LabelReveal((id, focused) => this.openDetail(id, focused))
  }

  subscribeDetail = (listener: () => void) => {
    this.detailListeners.add(listener)
    return () => {
      this.detailListeners.delete(listener)
    }
  }

  getDetail = () => this.detail

  place(candidates: PillCandidate[], bounds: PaneSize) {
    const placements = placePills(candidates, bounds, this.placer.placements)
    this.placer.apply(placements)
    this.bounds = { width: bounds.width, height: bounds.height }
    this.candidates = new Map(candidates.map((candidate) => [candidate.id, candidate]))
    this.rects = new Map()
    for (const candidate of candidates) {
      const rect = placedRect(candidate, placements.get(candidate.id)!)
      if (rect) this.rects.set(candidate.id, rect)
    }
    // An open chip follows its pill to its new place.
    if (this.detail?.open) this.openDetail(this.detail.id, this.detail.focused)
    this.suppress()
  }

  /**
   * After the frame's placement, if any: close the detail while the view
   * moves; once it rests, follow the room under the pointer, again after each
   * placement so a wheel zoom opens the room left under the cursor.
   */
  settle(placed: boolean, pick: (pointer: PointerAt) => string | null) {
    if (!this.clock.atRest) {
      this.reveal.clear()
      return
    }
    if (!(placed || this.pointerMoved)) return
    this.pointerMoved = false
    this.reveal.pick(this.pointer && pick(this.pointer))
  }

  /** Where the detail chip now sits, or null once it closes or unmounts. */
  placeDetail = (rect: LabelRect | null) => {
    this.chip = rect
    this.suppress()
  }

  private suppress() {
    if (!this.chip) {
      this.placer.suppress(new Set(), null)
      return
    }
    const open = this.detail?.open ? this.detail.id : null
    this.placer.suppress(suppressedBy(this.chip, this.rects), open)
  }

  private openDetail(id: string | null, focused: boolean) {
    const at = id ? this.locate(id) : null
    this.detail =
      id && at ? { id, open: true, focused, at } : this.detail && { ...this.detail, open: false }
    for (const listener of this.detailListeners) listener()
  }

  private locate(id: string): DetailOrigin | null {
    const bounds = this.bounds
    const rect = this.rects.get(id)
    const dot = rect && this.elements.get(id)?.querySelector<HTMLElement>('[data-room-label-dot]')
    if (rect && dot) {
      // From the placed rect, not the pill's live box: it may still be easing in.
      const x = rect.left + dot.offsetLeft + dot.offsetWidth / 2
      return { x, y: (rect.top + rect.bottom) / 2, onDot: true, bounds }
    }
    const anchor = this.candidates.get(id)
    if (anchor) return { x: anchor.x, y: anchor.y, onDot: false, bounds }
    const box = this.container()?.getBoundingClientRect()
    if (!(box && this.pointer)) return null
    return { x: this.pointer.x - box.left, y: this.pointer.y - box.top, onDot: false, bounds }
  }
}

const samePx = (a: number, b: number) => Math.abs(a - b) < 0.5

/**
 * The state of one layer of pills, kept in step with them: measured as they
 * mount (and observed, so a web font arriving, a rename or a unit change
 * places them again), shown and hidden with the layer, and its detail opened
 * by keyboard focus or the pointer over `host`: over the `surface` (the canvas
 * or the plan) or the layer's own labels, not the UI over them.
 */
function usePillLayer(
  shown: boolean,
  entries: readonly LabelEntry[],
  host: HTMLElement | null,
  container: () => HTMLElement | null,
  surface: () => Element | null | undefined,
) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [layer] = useState(() => new PillLayer(setGone))
  layer.container = container
  layer.surface = surface
  const unit = useViewer((s) => s.unit)
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    const { clock, elements, placer, sizes } = layer
    elements.onMeasure = (id, element) => {
      const size = measureFullPill(element)
      if (!(size[0] > 0 && size[1] > 0 && size[2] > 0)) return
      const previous = sizes.get(id)
      if (previous?.every((value, i) => samePx(value, size[i]!))) return
      sizes.set(id, size)
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
              // A new tier resizes the pill to a size already known; anything
              // else (a dot back on screen with text changed while its wrapper
              // was display:none) is measured again.
              const tier = element.dataset.roomLabelTier
              const size = sizes.get(id)
              const expected =
                size && tierSize(size, tier === 'name' || tier === 'dot' ? tier : 'full')
              if (
                expected &&
                samePx(expected[0], box.inlineSize) &&
                samePx(expected[1], box.blockSize)
              )
                continue
              elements.measure(id)
            }
          })
    elements.onMount = (id, element) => {
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
      layer.reveal.clear()
    }
  }, [layer])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Hidden pills must remount to measure changed entries or units.
  useEffect(() => {
    layer.placer.remeasure()
    layer.clock.invalidate()
  }, [entries, layer, unit])
  useEffect(() => {
    layer.placer.showAll(shown)
    if (shown) layer.clock.invalidate()
    else layer.reveal.clear()
  }, [layer, shown])
  useEffect(() => {
    if (!host) return
    const { reveal } = layer
    const labelAt = (target: EventTarget | null) => {
      const label =
        target instanceof Element ? target.closest<HTMLElement>('[data-room-label]') : null
      if (!(label && layer.container()?.contains(label))) return null
      return label.dataset.roomLabel ?? null
    }
    const move = (event: PointerEvent) => {
      const label = labelAt(event.target)
      const over =
        event.buttons === 0 &&
        event.pointerType !== 'touch' &&
        (label !== null ||
          (event.target instanceof Node && !!layer.surface()?.contains(event.target)))
      layer.pointer = over ? { x: event.clientX, y: event.clientY } : null
      layer.pointerMoved = true
      if (shownRef.current && layer.clock.atRest) reveal.hover(over ? label : null)
    }
    const leave = () => {
      layer.pointer = null
      reveal.hover(null)
      reveal.pick(null)
    }
    const focusIn = (event: FocusEvent) => {
      const id = labelAt(event.target)
      if (id && shownRef.current && (event.target as Element).matches(':focus-visible'))
        reveal.focus(id)
    }
    const focusOut = () => reveal.focus(null)
    // The canvas and the plan pan while Space is held; on a pill, Space presses it.
    const keepSpace = (event: KeyboardEvent) => {
      if (event.code === 'Space' && labelAt(event.target)) event.stopPropagation()
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reveal.dismiss()
    }
    // Captured: a plan or canvas handler stopping the move must not blind the layer.
    host.addEventListener('pointermove', move, { capture: true, passive: true })
    // A drag ending with the pointer held still picks the room under it once the view rests.
    host.addEventListener('pointerup', move, { capture: true, passive: true })
    host.addEventListener('pointerleave', leave)
    host.addEventListener('focusin', focusIn)
    host.addEventListener('focusout', focusOut)
    host.addEventListener('keydown', keepSpace)
    host.addEventListener('keyup', keepSpace)
    document.addEventListener('keydown', dismiss)
    return () => {
      host.removeEventListener('pointermove', move, { capture: true })
      host.removeEventListener('pointerup', move, { capture: true })
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('focusin', focusIn)
      host.removeEventListener('focusout', focusOut)
      host.removeEventListener('keydown', keepSpace)
      host.removeEventListener('keyup', keepSpace)
      document.removeEventListener('keydown', dismiss)
    }
  }, [host, layer])
  return { layer, gone }
}

/**
 * The pills of one level: every detected room, and every drawn zone that
 * bounds none. A smaller one inside a larger one (a zone drawn in a room) is
 * a hole in the larger: the label there, and the room under the pointer
 * there, are the smaller one's.
 */
export function roomLabelEntries(
  rooms: readonly RoomSelectionRecord[],
  zones: readonly ZoneNode[],
): RoomLabelEntry[] {
  const hiddenIds = new Set<string>(
    zones.filter((zone) => zone.visible === false).map((zone) => zone.id),
  )
  const roomIds = new Set(rooms.map((room) => room.zoneId))
  const entries: RoomLabelEntry[] = [
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
  const insides = entries.map((entry) =>
    polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes }),
  )
  return entries.map((entry) => {
    const outline = [{ outer: entry.polygon, holes: entry.holes }]
    const nested = entries.filter(
      (other, i) => other.area < entry.area && containsPoint(outline, insides[i]!),
    )
    return nested.length === 0
      ? entry
      : { ...entry, holes: [...entry.holes, ...nested.map((other) => other.polygon)] }
  })
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

/** A label's colour dot, name and area: a pill hides what its tier leaves out, the detail shows all. */
function LabelParts({
  color,
  name,
  areaLabel,
  full,
}: {
  color: string
  name: string
  areaLabel: string
  full: boolean
}) {
  return (
    <>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        data-room-label-dot=""
        style={{ backgroundColor: color }}
      />
      <span
        className={
          full
            ? 'min-w-0 font-medium [overflow-wrap:anywhere]'
            : 'max-w-40 truncate font-medium [[data-room-label-tier=dot]>&]:hidden'
        }
      >
        {name}
      </span>
      <span
        className="shrink-0 whitespace-nowrap font-mono text-white/60 tabular-nums [[data-room-label-tier]>&]:hidden"
        data-room-label-area=""
      >
        {areaLabel}
      </span>
    </>
  )
}

/**
 * The pill itself, a button: a colour dot, the name (cut at 160 px) and the
 * area in the active unit, as much of it as its placement shows.
 */
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
  elements: Map<string, HTMLElement>
  onClick: (event: ReactMouseEvent) => void
  onHover: (event: ReactPointerEvent) => void
  onLeave: () => void
}) {
  const unit = useViewer((s) => s.unit)
  const areaLabel = formatRoomArea(areaM2, unit)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A dot's border box does not resize when its hidden text changes.
  useLayoutEffect(() => {
    if (elements instanceof PillElements) elements.measure(zoneId)
  }, [areaM2, elements, name, unit, zoneId])
  const register = useCallback(
    (element: HTMLElement | null) => {
      if (element) elements.set(zoneId, element)
      else elements.delete(zoneId)
    },
    [elements, zoneId],
  )
  return (
    <button
      aria-label={`${name}, ${areaLabel}`}
      // Fades in once placed, and out while hidden (then out of the tab order)
      // or under the detail chip (taking no pointer unless it is the open
      // room's); eases into its nudged place and its tier.
      className="pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-neutral-950/75 px-2.5 py-1 text-white text-xs shadow-sm backdrop-blur-sm transition-[opacity,translate,visibility] duration-180 starting:opacity-0 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 focus-visible:ring-6 focus-visible:ring-neutral-950/85 data-room-label-hidden:pointer-events-none data-room-label-suppressed:pointer-events-none data-room-label-hidden:invisible data-room-label-hidden:opacity-0 data-room-label-open:opacity-0 data-room-label-suppressed:opacity-0 data-room-label-open:duration-150 data-room-label-suppressed:duration-150 data-[room-label-tier=dot]:gap-0 data-[room-label-tier=dot]:p-[3px] motion-reduce:transition-none"
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
      type="button"
    >
      <LabelParts areaLabel={areaLabel} color={color} full={false} name={name} />
    </button>
  )
}

/**
 * The detail chip: the open room's whole label, wrapping to fit its layer.
 * It only reads: the pill under it is the control, and the pointer goes
 * through it to the rooms it covers.
 */
export function RoomPillDetail({
  zoneId,
  view,
  color,
  name,
  areaM2,
}: {
  zoneId: string
  view: '2d' | '3d'
  color: string
  name: string
  areaM2: number
}) {
  const unit = useViewer((s) => s.unit)
  return (
    <div
      aria-hidden
      className="flex select-none items-center gap-1.5 rounded-[13px] border border-white/10 bg-neutral-950/90 px-2.5 py-1 text-white text-xs shadow-elevation-3 backdrop-blur-sm"
      data-room-label-detail={zoneId}
      data-room-label-view={view}
    >
      <LabelParts areaLabel={formatRoomArea(areaM2, unit)} color={color} full name={name} />
    </div>
  )
}

function useLabelZone(zoneId: string) {
  const zone = useScene((s) => s.nodes[zoneId as AnyNodeId] as ZoneNode | undefined)
  return zone && zone.visible !== false ? zone : null
}

const labelName = (zone: ZoneNode) => zone.name?.trim() || zoneKindLabel(zone)

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
  elements: Map<string, HTMLElement>
}) {
  const zone = useLabelZone(entry.zoneId)
  // A pill that disappears under the cursor (its click selected something)
  // fires no leave: end the hover it set.
  useEffect(() => () => leaveZoneArea(entry.zoneId), [entry.zoneId])
  if (!zone) return null
  return (
    <RoomPillChip
      areaM2={entry.area}
      color={zone.color}
      elements={elements}
      name={labelName(zone)}
      onClick={(event) => clickZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onHover={(event) => hoverZoneArea(entry.zoneId, selectionModifiersFromEvent(event))}
      onLeave={() => leaveZoneArea(entry.zoneId)}
      view={view}
      zoneId={entry.zoneId}
    />
  )
}

function RoomDetail({ entry, view }: { entry: LabelEntry; view: '2d' | '3d' }) {
  const zone = useLabelZone(entry.zoneId)
  if (!zone) return null
  return (
    <RoomPillDetail
      areaM2={entry.area}
      color={zone.color}
      name={labelName(zone)}
      view={view}
      zoneId={entry.zoneId}
    />
  )
}

/**
 * The open room's whole label over its layer: opened with its colour dot on
 * the pill's, or centred where a hidden room's label would sit, and kept 8 px
 * inside the layer. The pills it covers fade out of its way; nothing moves.
 * One chip serves every room, so a handoff moves it without fading it again.
 */
function RoomLabelDetail({
  detail,
  onPlaced,
  children,
}: {
  detail: RoomLabelDetailState
  onPlaced: (rect: LabelRect | null) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { open, at } = detail
  useLayoutEffect(() => {
    const frame = ref.current
    if (!(frame && open)) {
      onPlaced(null)
      return
    }
    const place = () => {
      const width = frame.offsetWidth
      const height = frame.offsetHeight
      const dot = frame.querySelector<HTMLElement>('[data-room-label-dot]')
      const x = at.onDot && dot ? at.x - dot.offsetLeft - dot.offsetWidth / 2 : at.x - width / 2
      const left = Math.max(DETAIL_INSET, Math.min(x, at.bounds.width - DETAIL_INSET - width))
      const top = Math.max(
        DETAIL_INSET,
        Math.min(at.y - height / 2, at.bounds.height - DETAIL_INSET - height),
      )
      frame.style.left = `${left}px`
      frame.style.top = `${top}px`
      onPlaced({ left, top, right: left + width, bottom: top + height })
    }
    place()
    // Placed again when its text reflows: a rename, a unit change, a font arriving.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(frame)
    return () => observer?.disconnect()
  }, [at, onPlaced, open])
  // Gone with its room: the pills it covered come back.
  useLayoutEffect(() => () => onPlaced(null), [onPlaced])
  return (
    <div
      className="pointer-events-none absolute z-30 w-max origin-left rounded-[13px] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] starting:scale-[0.98] starting:opacity-0 data-closed:scale-[0.98] data-closed:opacity-0 data-closed:duration-50 data-focused:outline-2 data-focused:outline-white data-focused:outline-offset-2 data-focused:ring-6 data-focused:ring-neutral-950/85 motion-reduce:transition-none"
      data-closed={open ? undefined : ''}
      data-focused={open && detail.focused ? '' : undefined}
      ref={ref}
      style={{ maxWidth: at.bounds.width - 2 * DETAIL_INSET }}
    >
      {children}
    </div>
  )
}

/**
 * The open room's detail, read from the layer's own store where it renders,
 * so a reveal re-renders the chip alone, not the canvas tree or every pill.
 */
function OpenRoomLabelDetail({
  layer,
  entries,
  renderDetail,
}: {
  layer: PillLayer
  entries: readonly LabelEntry[]
  renderDetail: (entry: LabelEntry) => ReactNode
}) {
  const detail = useSyncExternalStore(layer.subscribeDetail, layer.getDetail, layer.getDetail)
  const entry = detail && entries.find((candidate) => candidate.zoneId === detail.id)
  if (!(detail && entry)) return null
  return (
    <RoomLabelDetail detail={detail} onPlaced={layer.placeDetail}>
      {renderDetail(entry)}
    </RoomLabelDetail>
  )
}

const renderDetail2D = (entry: LabelEntry) => <RoomDetail entry={entry} view="2d" />

/** Light name-and-area pills over each room and drawn zone of the active level. */
export function RoomLabels3D() {
  const levelId = useViewer((s) => s.selection.levelId)
  const sceneShown = useEditor((s) => isViewVisible(s, VIEW_3D))
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
      renderDetail={(entry) => <RoomDetail entry={entry} view="3d" />}
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

const toScreen = new Matrix4()

/** Where a level-local point lands in the canvas, in px, with its depth; null behind the camera. */
function screenPoint(x: number, y: number, z: number, size: PaneSize) {
  const e = toScreen.elements
  const w = e[3] * x + e[7] * y + e[11] * z + e[15]
  if (!(w > 0)) return null
  return [
    (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2) * size.width,
    ((1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2) * size.height,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  ] as const
}

// How far in front of the camera an outline is cut off (in clip-space w, the
// depth along the view for a perspective camera): past it, points project
// ever further out and then flip to the other side of the screen.
const NEAR_W = 1e-3

/**
 * A level-local ring at height `y` on screen: cut to the part in front of the
 * camera (Sutherland–Hodgman against w = NEAR_W, which is linear in the
 * level's coordinates), then projected. Null when none of it is in front.
 */
function screenRing(points: readonly [number, number][], y: number, size: PaneSize): Ring | null {
  const e = toScreen.elements
  const w = ([x, z]: readonly [number, number]) => e[3] * x + e[7] * y + e[11] * z + e[15]
  const ring: Ring = []
  const add = (x: number, z: number) => {
    const point = screenPoint(x, y, z, size)
    if (point) ring.push([point[0], point[1]])
  }
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!
    const b = points[i]!
    const wa = w(a)
    const wb = w(b)
    if (wa >= NEAR_W !== wb >= NEAR_W) {
      const t = (wa - NEAR_W) / (wa - wb)
      add(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
    }
    if (wb >= NEAR_W) add(b[0], b[1])
  }
  return ring.length >= 3 ? ring : null
}

/** Where the pills of a level land on screen, each with the part of its room in front of the camera. */
export function candidates3D(
  entries: readonly LabelEntry[],
  anchors: ReadonlyMap<string, Vector3>,
  sizes: ReadonlyMap<string, PillSize>,
  camera: Camera,
  level: Object3D,
  size: PaneSize,
): PillCandidate[] {
  toScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  toScreen.multiply(level.matrixWorld)
  const candidates: PillCandidate[] = []
  for (const entry of entries) {
    const anchor = anchors.get(entry.zoneId)
    const pill = sizes.get(entry.zoneId)
    if (!(anchor && pill)) continue
    const at = screenPoint(anchor.x, anchor.y, anchor.z, size)
    // Behind the camera or past its far plane: not on screen to collide.
    if (!at || Math.abs(at[2]) > 1) continue
    // The room's outline at its pill's height, where the pill has to fit.
    const outer = screenRing(entry.polygon, anchor.y, size)
    if (!outer) continue
    const holes: Ring[] = []
    for (const hole of entry.holes) {
      const ring = screenRing(hole, anchor.y, size)
      if (ring) holes.push(ring)
    }
    candidates.push({
      id: entry.zoneId,
      x: at[0],
      y: at[1],
      size: pill,
      area: entry.area,
      outline: { outer, holes },
    })
  }
  return candidates
}

const pickRaycaster = new Raycaster()
const pickPointer = new Vector2()
const levelInverse = new Matrix4()
const levelRay = new Ray()

/** The room whose floor the pointer's ray meets first, testing each room at its own floor. */
function pick3D(
  entries: readonly LabelEntry[],
  anchors: ReadonlyMap<string, Vector3>,
  pointer: PointerAt,
  camera: Camera,
  level: Object3D,
  size: PaneSize & { left: number; top: number },
): string | null {
  pickPointer.set(
    ((pointer.x - size.left) / size.width) * 2 - 1,
    -((pointer.y - size.top) / size.height) * 2 + 1,
  )
  pickRaycaster.setFromCamera(pickPointer, camera)
  levelRay.copy(pickRaycaster.ray).applyMatrix4(levelInverse.copy(level.matrixWorld).invert())
  const { origin, direction } = levelRay
  return roomAt(entries, (entry) => {
    const anchor = anchors.get(entry.zoneId)
    if (!anchor) return null
    const t = (anchor.y - LABEL_HEIGHT - origin.y) / direction.y
    return t > 0 && Number.isFinite(t)
      ? [origin.x + t * direction.x, origin.z + t * direction.z, t]
      : null
  })
}

// The detail chip's own Html sits at its layer's top-left corner and places
// the chip itself, so drei must never hide it: the object it rides is not
// where it shows.
const atLayerOrigin = () => [0, 0]
const keepShown = () => {}

/**
 * The pills of one level in 3D, riding the level's object (so they follow
 * level stacking) and placed from where their anchors land on screen. They
 * live in their own stacking layer clipped to the canvas, so every piece of
 * UI over the canvas stays above them; the open room's chip, the label being
 * read, has a layer of its own above the canvas's flags.
 */
export function RoomPillsLayer3D({
  entries,
  levelObject,
  renderLabel,
  renderDetail,
  shown = true,
}: {
  entries: readonly LabelEntry[]
  levelObject: () => Object3D | undefined
  renderLabel: (
    entry: LabelEntry,
    anchors: Map<string, Vector3>,
    elements: Map<string, HTMLElement>,
  ) => ReactNode
  renderDetail: (entry: LabelEntry) => ReactNode
  shown?: boolean
}) {
  const ref = useRef<Group>(null)
  const [anchors] = useState(() => new RoomAnchors())
  const view = useRef(new Float64Array(50))
  const host = useThree((s) => (s.events.connected ?? s.gl.domElement.parentNode) as HTMLElement)
  const [portals] = useState(() =>
    typeof document === 'undefined'
      ? null
      : {
          pills: { current: document.createElement('div') },
          detail: { current: document.createElement('div') },
        },
  )
  const canvas = useThree((s) => s.gl.domElement)
  const { layer, gone } = usePillLayer(
    shown,
    entries,
    host,
    () => portals?.pills.current ?? null,
    () => canvas,
  )
  useEffect(() => {
    if (!(host && portals)) return
    const { pills, detail } = portals
    pills.current.className = 'pointer-events-none absolute inset-0 isolate z-0 overflow-hidden'
    // Over the flags and guides on the canvas (z-index 25 at most), unlike the pills.
    detail.current.className = 'pointer-events-none absolute inset-0 z-30'
    host.append(pills.current, detail.current)
    return () => {
      pills.current.remove()
      detail.current.remove()
    }
  }, [host, portals])

  useEffect(() => {
    anchors.onMove = () => layer.clock.invalidate()
    return () => {
      anchors.onMove = null
    }
  }, [anchors, layer])

  useEffect(() => {
    const ids = new Set(entries.map((entry) => entry.zoneId))
    for (const id of anchors.keys()) if (!ids.has(id)) anchors.delete(id)
    layer.clock.invalidate()
  }, [anchors, entries, layer])

  useFrame(({ camera, clock: frameClock, size }) => {
    if (!ref.current) return
    const level = levelObject()
    ref.current.visible = !!level
    if (!level) return
    level.updateWorldMatrix(true, false)
    ref.current.matrix.copy(level.matrixWorld)
    if (!shown) return

    const flat = view.current
    flat.set(camera.matrixWorld.elements, 0)
    flat.set(camera.projectionMatrix.elements, 16)
    flat.set(level.matrixWorld.elements, 32)
    flat[48] = size.width
    flat[49] = size.height
    const placed = layer.clock.shouldRead(flat, frameClock.elapsedTime)
    if (placed) {
      timeSpan('room-labels', () =>
        layer.place(candidates3D(entries, anchors, layer.sizes, camera, level, size), size),
      )
    }
    layer.settle(placed, (pointer) => pick3D(entries, anchors, pointer, camera, level, size))
  })

  if (entries.length === 0 || !portals) return null
  return (
    <PillPortalContext.Provider value={portals.pills}>
      <HiddenPillsContext.Provider value={gone}>
        <group matrixAutoUpdate={false} ref={ref}>
          {entries.map((entry) => (
            <Fragment key={entry.zoneId}>{renderLabel(entry, anchors, layer.elements)}</Fragment>
          ))}
          <Html
            calculatePosition={atLayerOrigin}
            onOcclude={keepShown}
            portal={portals.detail}
            style={{ pointerEvents: 'none' }}
          >
            <OpenRoomLabelDetail entries={entries} layer={layer} renderDetail={renderDetail} />
          </Html>
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
      // The wrapper lets the canvas keep everything but the pill itself.
      style={{ pointerEvents: 'none' }}
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
  const planShown = useEditor((s) => isViewVisible(s, VIEW_2D))
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
  const { layer, gone } = usePillLayer(
    shown,
    entries,
    host,
    () => paneRef.current,
    () => ref.current?.ownerSVGElement,
  )
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
    layer.clock.invalidate()
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
      // A plan point in the pane's px.
      const place = ([x, y]: readonly [number, number]): [number, number] => [
        ctm.a * x + ctm.c * y + ctm.e - pane.left,
        ctm.b * x + ctm.d * y + ctm.f - pane.top,
      ]
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
      if (!shownRef.current) return
      const placed = layer.clock.shouldRead(view, now / 1000)
      if (placed) {
        timeSpan('room-labels', () => {
          const candidates: PillCandidate[] = []
          for (const entry of entries) {
            const anchor = anchors.get(entry.zoneId)
            const pill = layer.sizes.get(entry.zoneId)
            if (!(anchor && pill)) continue
            const at = place(anchor)
            if (!inside(at)) continue
            candidates.push({
              id: entry.zoneId,
              x: at[0],
              y: at[1],
              size: pill,
              area: entry.area,
              outline: {
                outer: entry.polygon.map(place),
                holes: entry.holes.map((hole) => hole.map(place)),
              },
            })
          }
          layer.place(candidates, pane)
        })
      }
      layer.settle(placed, (pointer) => {
        const inverse = ctm.inverse()
        // The plan is one plane, met at the same distance for every room: the smallest wins.
        const point: RoomHit = [
          inverse.a * pointer.x + inverse.c * pointer.y + inverse.e,
          inverse.b * pointer.x + inverse.d * pointer.y + inverse.f,
          0,
        ]
        return roomAt(entries, () => point)
      })
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      nodes.onMount = null
    }
  }, [anchors, entries, layer, nodes, present])

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
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  key={entry.zoneId}
                  ref={(element) => {
                    if (element) nodes.set(entry.zoneId, element)
                    else nodes.delete(entry.zoneId)
                  }}
                  style={{ display: 'none' }}
                >
                  <RoomPill elements={layer.elements} entry={entry} view="2d" />
                </div>
              ))}
            <OpenRoomLabelDetail entries={entries} layer={layer} renderDetail={renderDetail2D} />
          </div>,
          host,
        )}
    </g>
  )
}
