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
import { useFrame } from '@react-three/fiber'
import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
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
type ScreenLabel = { id: string; distance: number; rect: LabelRect }

/**
 * Which pills step aside so none overlap: nearest first, each pill that
 * overlaps one already kept is hidden. Returns the hidden ids.
 */
export function declutterLabels(labels: readonly ScreenLabel[], gap = 2): Set<string> {
  const kept: LabelRect[] = []
  const hidden = new Set<string>()
  for (const label of [...labels].sort((a, b) => a.distance - b.distance)) {
    const { rect } = label
    const overlaps = kept.some(
      (other) =>
        rect.left < other.right + gap &&
        other.left < rect.right + gap &&
        rect.top < other.bottom + gap &&
        other.top < rect.bottom + gap,
    )
    if (overlaps) hidden.add(label.id)
    else kept.push(rect)
  }
  return hidden
}

/** A pill's screen rect: centred on where its anchor lands, at its measured size. */
export function pillRect(x: number, y: number, [width, height]: readonly [number, number]) {
  return { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 }
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
// The view has to hold still this long before overlaps are re-read…
const DECLUTTER_REST_SECONDS = 0.12
// …and while it moves they are re-read this often.
const DECLUTTER_MOVING_SECONDS = 0.3
// Below this the view counts as still: well under a pixel on screen.
const VIEW_EPSILON = 1e-4
/** How long a pill takes to fade in or out. */
export const PILL_FADE_MS = 180

const labelWorld = new Vector3()

function pillFadeMs(): number {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 0
    : PILL_FADE_MS
}

/**
 * When a layer re-reads overlaps: once the view has held still, every so often
 * while it moves, and as soon as its pills change. Still means within an
 * epsilon of the view last seen moving — camera damping keeps nudging the
 * camera by fractions of a millimetre for a second or more after it visibly
 * stops, and waiting for it to stop exactly left pills hidden, with nothing
 * overlapping them, for that long.
 */
export class DeclutterClock {
  private reference: number[] | null = null
  private movedAt = Number.NEGATIVE_INFINITY
  private readAt = Number.NEGATIVE_INFINITY
  private settled = false
  private dirty = true

  /** The pills changed (mounted, unmounted, resized): read again now. */
  invalidate() {
    this.dirty = true
  }

  /** Whether to read overlaps for this view (any flat list of numbers) at `now` seconds. */
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
    const resting = now - this.movedAt >= DECLUTTER_REST_SECONDS
    const due = resting
      ? !this.settled || this.dirty
      : this.dirty || now - this.readAt >= DECLUTTER_MOVING_SECONDS
    if (!due) return false
    this.settled = resting
    this.dirty = false
    this.readAt = now
    return true
  }
}

/**
 * The pills a layer has mounted, by zone id. A pill coming or going tells the
 * layer to re-read overlaps; while the layer fades out, one mounting joins it.
 */
export class PillElements extends Map<string, HTMLElement> {
  onChange: (() => void) | null = null
  hideAll = false

  override set(id: string, element: HTMLElement) {
    if (this.hideAll) element.dataset.roomLabelHidden = ''
    super.set(id, element)
    this.onChange?.()
    return this
  }

  override delete(id: string) {
    const removed = super.delete(id)
    if (removed) this.onChange?.()
    return removed
  }
}

type Timer = ReturnType<typeof setTimeout>

/**
 * Pills the declutter hides fade out, then leave the DOM (`gone`); one given
 * room again is dropped from `gone`, mounts and fades in. A hidden pill takes
 * no pointer from the moment it starts to fade.
 */
export class PillFades {
  gone: ReadonlySet<string> = new Set()
  private readonly fading = new Map<string, Timer>()

  constructor(
    private readonly elements: ReadonlyMap<string, HTMLElement>,
    private readonly onGone: (gone: ReadonlySet<string>) => void,
    private readonly schedule: (run: () => void, ms: number) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
  ) {}

  apply(hidden: ReadonlySet<string>, fadeMs = pillFadeMs()) {
    for (const [id, element] of this.elements) {
      const timer = this.fading.get(id)
      if (hidden.has(id)) {
        if (timer !== undefined) continue
        element.dataset.roomLabelHidden = ''
        this.fading.set(
          id,
          this.schedule(() => {
            this.fading.delete(id)
            this.setGone(new Set(this.gone).add(id))
          }, fadeMs),
        )
      } else {
        if (timer !== undefined) this.cancel(timer)
        this.fading.delete(id)
        delete element.dataset.roomLabelHidden
      }
    }
    const back = [...this.gone].filter((id) => !hidden.has(id))
    if (back.length > 0) this.setGone(new Set([...this.gone].filter((id) => hidden.has(id))))
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
 * The declutter state of one layer: its mounted pills, their last measured
 * sizes (kept for pills that have left the DOM), and their fades.
 */
function usePillDeclutter(shown: boolean) {
  const [elements] = useState(() => new PillElements())
  const [clock] = useState(() => new DeclutterClock())
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [fades] = useState(() => new PillFades(elements, setGone))
  const sizes = useRef(new Map<string, readonly [number, number]>())
  useEffect(() => {
    elements.onChange = () => clock.invalidate()
    return () => {
      elements.onChange = null
      fades.dispose()
    }
  }, [clock, elements, fades])
  useEffect(() => {
    elements.hideAll = !shown
    fades.showAll(shown)
    if (shown) clock.invalidate()
  }, [clock, elements, fades, shown])
  /** Measure the mounted pills; returns the size of each pill to place. */
  const measure = useCallback(() => {
    for (const [id, element] of elements) {
      // A pill out of view (its wrapper not displayed) keeps its last size.
      if (element.offsetWidth > 0) {
        sizes.current.set(id, [element.offsetWidth, element.offsetHeight])
      }
    }
    return sizes.current
  }, [elements])
  return { elements, clock, gone, fades, measure }
}

/** The pills of one level: every detected room, and every drawn zone that bounds none. */
export function roomLabelEntries(
  rooms: readonly RoomSelectionRecord[],
  zones: readonly ZoneNode[],
): RoomLabelEntry[] {
  const roomIds = new Set(rooms.map((room) => room.zoneId))
  return [
    ...rooms.map((room) => ({
      zoneId: room.zoneId,
      polygon: room.polygon,
      holes: room.holes,
      area: room.area,
    })),
    ...zones
      .filter((zone) => !roomIds.has(zone.id) && zone.polygon.length >= 3)
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
  const register = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) elements?.set(zoneId, element)
      else elements?.delete(zoneId)
    },
    [elements, zoneId],
  )
  return (
    <div
      // Fades in as it mounts and out (taking no pointer) while the layer hides it.
      className="pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-neutral-950/75 px-2.5 py-1 text-white text-xs shadow-sm backdrop-blur-sm transition-[opacity,background-color] duration-180 hover:bg-neutral-950/90 starting:opacity-0 data-room-label-hidden:pointer-events-none data-room-label-hidden:opacity-0 motion-reduce:transition-none"
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
      <span className="font-medium">{name}</span>
      <span className="font-mono text-white/60 tabular-nums">{formatRoomArea(areaM2, unit)}</span>
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
 * level stacking), decluttered from where their anchors land on screen. A pill
 * that steps aside, or the whole layer when `shown` turns false, fades out; a
 * hidden pill then leaves the DOM.
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
  const unit = useViewer((s) => s.unit)
  const ref = useRef<Group>(null)
  const anchors = useRef(new Map<string, Vector3>())
  const view = useRef(new Float64Array(50))
  const { elements, clock, gone, fades, measure } = usePillDeclutter(shown)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new set of pills or unit re-reads overlaps.
  useEffect(() => {
    const ids = new Set(entries.map((entry) => entry.zoneId))
    for (const id of anchors.current.keys()) if (!ids.has(id)) anchors.current.delete(id)
    clock.invalidate()
  }, [entries, unit])

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

    const sizes = measure()
    const labels: ScreenLabel[] = []
    for (const entry of entries) {
      const anchor = anchors.current.get(entry.zoneId)
      const pill = sizes.get(entry.zoneId)
      if (!(anchor && pill)) continue
      labelWorld.copy(anchor).applyMatrix4(level.matrixWorld)
      const distance = labelWorld.distanceTo(camera.position)
      labelWorld.project(camera)
      // Behind the camera or past its far plane: not on screen to overlap anything.
      if (Math.abs(labelWorld.z) > 1) continue
      labels.push({
        id: entry.zoneId,
        distance,
        rect: pillRect(
          ((labelWorld.x + 1) / 2) * size.width,
          ((1 - labelWorld.y) / 2) * size.height,
          pill,
        ),
      })
    }
    fades.apply(declutterLabels(labels))
  })

  if (entries.length === 0) return null
  return (
    <group matrixAutoUpdate={false} ref={ref}>
      {entries
        .filter((entry) => !gone.has(entry.zoneId))
        .map((entry) => (
          <Fragment key={entry.zoneId}>{renderLabel(entry, anchors.current, elements)}</Fragment>
        ))}
    </group>
  )
}

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
  const position = useMemo(() => {
    const [x, z] = polygonInteriorPoint({ polygon: entry.polygon, holes: entry.holes })
    return new Vector3(x, floorY + LABEL_HEIGHT, z)
  }, [entry.polygon, entry.holes, floorY])
  // Kept after unmount: a pill that stepped aside is placed from its anchor to
  // learn when it has room again. The layer drops anchors of rooms that left.
  useEffect(() => {
    anchors.set(entry.zoneId, position)
  }, [anchors, entry.zoneId, position])
  return (
    // The wrapper lets the canvas keep everything but the pill itself.
    <Html center position={position} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
      {children}
    </Html>
  )
}

/**
 * The same pills over the 2D plan: screen-positioned from the plan's transform,
 * re-placed only when the plan pans or zooms, decluttered as in 3D (bigger
 * rooms keep theirs), and clipped to the plan's pane.
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
  const unit = useViewer((s) => s.unit)
  const ref = useRef<SVGGElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const [nodes] = useState(() => new PillElements())
  const { elements, clock, gone, fades, measure } = usePillDeclutter(shown)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing units resizes the pills.
  useEffect(() => {
    if (!present || entries.length === 0) return
    let raf = 0
    let lastKey = ''
    const view = new Float64Array(10)
    // A pill wrapper that mounts is placed on the next frame.
    nodes.onChange = () => {
      lastKey = ''
    }
    clock.invalidate()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const group = ref.current
      const svg = group?.ownerSVGElement
      const ctm = group?.getScreenCTM()
      if (!(svg && ctm)) return
      const pane = svg.getBoundingClientRect()
      const key = `${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f},${pane.left},${pane.top},${pane.width},${pane.height}`
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
        if (paneRef.current) {
          Object.assign(paneRef.current.style, {
            left: `${pane.left}px`,
            top: `${pane.top}px`,
            width: `${pane.width}px`,
            height: `${pane.height}px`,
          })
        }
        for (const [id, element] of nodes) {
          const anchor = anchors.get(id)
          if (!anchor) continue
          const at = place(anchor)
          element.style.left = `${at[0]}px`
          element.style.top = `${at[1]}px`
          element.style.display = inside(at) ? '' : 'none'
        }
      }
      view.set([
        ctm.a,
        ctm.b,
        ctm.c,
        ctm.d,
        ctm.e,
        ctm.f,
        pane.left,
        pane.top,
        pane.width,
        pane.height,
      ])
      if (!(shownRef.current && clock.shouldRead(view, now / 1000))) return
      const sizes = measure()
      const labels: ScreenLabel[] = []
      for (const entry of entries) {
        const anchor = anchors.get(entry.zoneId)
        const pill = sizes.get(entry.zoneId)
        if (!(anchor && pill)) continue
        const at = place(anchor)
        if (!inside(at)) continue
        labels.push({ id: entry.zoneId, distance: -entry.area, rect: pillRect(at[0], at[1], pill) })
      }
      fades.apply(declutterLabels(labels))
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      nodes.onChange = null
    }
  }, [present, entries, anchors, unit])

  return (
    <g ref={ref}>
      {present &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed z-10 overflow-hidden" ref={paneRef}>
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
                  <RoomPill elements={elements} entry={entry} view="2d" />
                </div>
              ))}
          </div>,
          document.body,
        )}
    </g>
  )
}
