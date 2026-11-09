import {
  type AnyNode,
  type AnyNodeId,
  area,
  type CeilingNode,
  ceilingPaintRegions,
  ceilingRegionsOwner,
  type MultiPolygon,
  resolveCeilingHeight,
  union,
  useScene,
} from '@pascal-app/core'
import { create } from 'zustand'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../store/use-editor'
import {
  CROSSING_MESSAGE,
  clipFloorRegion,
  floorRegionAxisAngle,
  floorRegionEdgeCrosses,
  floorRegionRectangle,
  MIN_FLOOR_REGION_AREA,
  OUTSIDE_MESSAGE,
} from './floor-region-geometry'
import {
  type FloorRegionPoint,
  type FloorRegionSnapSettings,
  type FloorRegionSnapTargets,
  floorRegionSnapTargets,
  snapFloorRegionPoint,
} from './floor-region-snap'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import { hasActivePaintMaterial } from './material-paint'
import { isPaintErasing, usePaintRegionMode } from './paint-region-mode'
import { addCeilingRegion, addFloorRegion } from './paint-regions'
import { roomFloorElevation } from './room-handle-drag'

// An outline drawn on one room's floor: a rectangle (press, drag, release; a
// persistent tool also takes two clicks) or a polygon (click points, close on
// the first point or Enter). What the outline becomes is the draft's purpose:
// "Paint part of the floor" (the default) clips it to the room and paints it
// as one `zone.floor.regions` entry; on a ceiling (`ceilingId`) the outline is
// drawn on its underside and paints one ceiling region; "Add mezzanine" (`mezzanine-draft`)
// builds a mezzanine from it. Either way one commit is one undo step. Surfaces
// (3D canvas, 2D plan) resolve pointers into plan points and call the actions
// below.

export const PICK_MATERIAL_MESSAGE = 'Pick a material first'

export type FloorDraftCommit = { ok: true } | { ok: false; message: string }

/** What a floor outline is drawn for, and how it commits. */
export type FloorDraftPurpose = {
  /** The lifecycle handle a draft runs under; `onCancel` drops the draft. */
  own: (room: FloorRegionRoom, onCancel: () => void) => GestureHandle
  /**
   * The tool outlives its drafts: a draft that ends uncommitted keeps the
   * handle, and a refused commit stays on the draft, red and labelled. Paint
   * drafts are one gesture each and refusals go to the HUD notice.
   */
  persistent?: boolean
  /** Whether a new draft may start; says why not itself. */
  canStart?: () => boolean
  commit: (room: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) => FloorDraftCommit
  /** Why a polygon point cannot be placed at `point`, or null. */
  pointMessage?: (room: FloorRegionRoom, point: FloorRegionPoint) => string | null
  /** Preview fill; the paint tint when unset. */
  fill?: string
}

export type FloorRegionRoom = {
  zoneId: string
  levelId: string
  /** Where the outline may go, level XZ: the room's clear floor for paint. */
  clear: MultiPolygon
  /** Elevation the 3D pointer plane and the preview use. */
  elevation: number
  /** Rectangle frame: the room's longest edge direction. */
  angle: number
  targets: FloorRegionSnapTargets
  /** Painting part of the floor when unset. */
  purpose?: FloorDraftPurpose
  /** The ceiling whose underside the outline is drawn on, when it is not a floor. */
  ceilingId?: string
}

export type FloorRegionDraft =
  | {
      kind: 'rectangle'
      room: FloorRegionRoom
      start: FloorRegionPoint
      end: FloorRegionPoint
      /** Why the released box was refused; the box stays put until the next press. */
      refusal?: string | null
      /**
       * A persistent tool's click without a drag placed the first corner: the
       * box follows the pointer and the next click sets the opposite corner.
       */
      anchored?: boolean
    }
  | {
      kind: 'polygon'
      room: FloorRegionRoom
      points: FloorRegionPoint[]
      cursor: FloorRegionPoint | null
      /** Why the live edge cannot be placed (red preview), or null. */
      message: string | null
      /** Why closing was refused; kept until the points change. */
      refusal?: string | null
    }

export type FloorRegionHover = {
  levelId: string
  elevation: number
  point: FloorRegionPoint
  /** Over a ceiling's underside rather than a floor. */
  ceiling?: boolean
}

export const useFloorRegionDraft = create<{
  draft: FloorRegionDraft | null
  hover: FloorRegionHover | null
}>(() => ({ draft: null, hover: null }))

/** The room a floor region is drawn in, read from its zone and room geometry. */
export function describeFloorRegionRoom(
  nodes: Record<string, AnyNode>,
  room: { zoneId: string; key: { levelId: string }; clearPolygon: MultiPolygon },
): FloorRegionRoom {
  const zone = nodes[room.zoneId]
  const regions = zone?.type === 'zone' ? (zone.floor?.regions ?? []) : []
  return {
    zoneId: room.zoneId,
    levelId: room.key.levelId,
    clear: room.clearPolygon,
    elevation: roomFloorElevation(nodes, room.zoneId),
    angle: floorRegionAxisAngle(room.clearPolygon),
    targets: floorRegionSnapTargets(
      room.clearPolygon,
      regions.map((region) => region.polygon),
    ),
  }
}

/** The ceilings a ceiling region covers: an automatic ceiling's room may be cut into several. */
function regionCeilings(nodes: Record<string, AnyNode>, ceiling: CeilingNode): CeilingNode[] {
  const owner = ceilingRegionsOwner(ceiling)
  if (owner.kind === 'ceiling') return [ceiling]
  return Object.values(nodes).filter(
    (node): node is CeilingNode =>
      node.type === 'ceiling' &&
      node.parentId === ceiling.parentId &&
      node.boundary === 'auto' &&
      node.zoneId === owner.id,
  )
}

/**
 * A ceiling's underside as a draft room: its outline minus holes (every part of
 * an automatic ceiling's room), at the plane the ceiling draws at.
 */
export function describeCeilingRegionRoom(
  nodes: Record<string, AnyNode>,
  ceiling: CeilingNode,
): FloorRegionRoom {
  const clear = union(
    regionCeilings(nodes, ceiling).map((part) => ({ outer: part.polygon, holes: part.holes })),
  )
  const owner = ceilingRegionsOwner(ceiling)
  return {
    zoneId: owner.id,
    levelId: ceiling.parentId ?? '',
    clear,
    elevation: resolveCeilingHeight(ceiling, nodes) - 0.01,
    angle: floorRegionAxisAngle(clear),
    targets: floorRegionSnapTargets(
      clear,
      ceilingPaintRegions(ceiling, nodes).map((region) => region.polygon),
    ),
    purpose: PAINT_CEILING_REGION,
    ceilingId: ceiling.id,
  }
}

/** The snapping the active context asks for: `lines` (magnetic), `grid`, or `off`. */
export function currentFloorRegionSnap(free: boolean): FloorRegionSnapSettings {
  return {
    mode: isMagneticSnapActive() ? 'lines' : isGridSnapActive() ? 'grid' : 'off',
    step: useEditor.getState().gridSnapStep,
    free,
  }
}

function snap(room: FloorRegionRoom, raw: FloorRegionPoint, settings: FloorRegionSnapSettings) {
  return snapFloorRegionPoint(raw, settings, room.targets).point
}

function samePoint(a: FloorRegionPoint, b: FloorRegionPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
}

/** The outline the draft currently describes (the live pointer included). */
export function floorRegionDraftOutline(draft: FloorRegionDraft): FloorRegionPoint[] {
  if (draft.kind === 'rectangle')
    return floorRegionRectangle(draft.start, draft.end, draft.room.angle)
  const { points, cursor } = draft
  return cursor && !(points.length && samePoint(points.at(-1)!, cursor))
    ? [...points, cursor]
    : [...points]
}

/** Whether a polygon click at `point` closes the ring on its first point. */
export function closesOnFirst(
  points: readonly FloorRegionPoint[],
  point: FloorRegionPoint,
  closeRadius: number,
) {
  const first = points[0]
  return (
    points.length >= 3 &&
    !!first &&
    Math.hypot(first[0] - point[0], first[1] - point[1]) <= closeRadius
  )
}

/** Why the live polygon edge to `cursor` cannot be placed, or null. */
export function polygonLiveMessage(
  points: readonly FloorRegionPoint[],
  cursor: FloorRegionPoint | null,
  closeRadius: number,
  room?: FloorRegionRoom,
): string | null {
  if (!cursor) return null
  const closing = closesOnFirst(points, cursor, closeRadius)
  if (points.length && floorRegionEdgeCrosses(points, closing ? points[0]! : cursor, closing))
    return CROSSING_MESSAGE
  return (!closing && room && purposeOf(room).pointMessage?.(room, cursor)) || null
}

/** Why the draft is red: the live edge, or the refused commit. */
export function floorRegionDraftMessage(draft: FloorRegionDraft): string | null {
  return (draft.kind === 'polygon' ? draft.message : null) ?? draft.refusal ?? null
}

function setNotice(notice: string | null) {
  if (usePaintRegionMode.getState().notice !== notice)
    usePaintRegionMode.getState().setNotice(notice)
}

/** The paint the region takes, or null (no material, or the eraser). */
function activePaint() {
  const editor = useEditor.getState()
  if (isPaintErasing() || !hasActivePaintMaterial(editor.activePaintMaterial)) return null
  return {
    material: editor.activePaintMaterial.material,
    materialPreset: editor.activePaintMaterial.materialPreset,
  }
}

/**
 * Commits the draft's outline and ends the draft; a refused commit keeps it. A
 * throwing write cancels the draft, so it can never stay half-alive.
 */
function commitDraft(room: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) {
  let settled = false
  try {
    const result = purposeOf(room).commit(room, polygon)
    settled = true
    if (result.ok) endDraft(room)
    return result
  } finally {
    if (!settled) cancelFloorRegion()
  }
}

/** Clips `polygon` to the room and paints it; the HUD notice says why when it cannot. */
export function commitFloorRegion(room: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) {
  const paint = activePaint()
  if (!paint) {
    setNotice(PICK_MATERIAL_MESSAGE)
    return false
  }
  const clip = clipFloorRegion(polygon, room.clear)
  if (!clip) {
    setNotice(OUTSIDE_MESSAGE)
    return false
  }
  const result = addFloorRegion(room.zoneId, clip.polygon, paint)
  setNotice(result.ok ? null : result.message)
  return result.ok
}

export const FLOOR_PAINT_REGION_HANDLE = 'paint-floor-region'

/** "Paint part of the floor": each draft is its own gesture in the paint sub-mode. */
const PAINT_FLOOR_REGION: FloorDraftPurpose = {
  own: (room, onCancel) =>
    beginGesture({
      kind: 'floor-paint-region',
      scope: { kind: 'handle-drag', nodeId: room.zoneId, handle: FLOOR_PAINT_REGION_HANDLE },
      paintSubMode: true,
      stale: () => floorRegionRoomGone(useScene.getState().nodes) || !floorRegionEditable(),
      onCancel,
    }),
  canStart: () => {
    if (activePaint()) return true
    setNotice(PICK_MATERIAL_MESSAGE)
    return false
  },
  commit: (room, polygon) =>
    commitFloorRegion(room, polygon)
      ? { ok: true }
      : { ok: false, message: usePaintRegionMode.getState().notice ?? '' },
}

/** Clips `polygon` to the ceiling and paints it as one region of its owner. */
export function commitCeilingRegion(room: FloorRegionRoom, polygon: readonly FloorRegionPoint[]) {
  const paint = activePaint()
  if (!paint) {
    setNotice(PICK_MATERIAL_MESSAGE)
    return false
  }
  const clip = clipFloorRegion(polygon, room.clear)
  if (!(clip && room.ceilingId)) {
    setNotice(OUTSIDE_MESSAGE)
    return false
  }
  const result = addCeilingRegion(room.ceilingId, clip.polygon, paint)
  setNotice(result.ok ? null : result.message)
  return result.ok
}

export const CEILING_PAINT_REGION_HANDLE = 'paint-ceiling-region'

/** "Paint part of the ceiling": the floor paint gesture, drawn on a ceiling's underside. */
const PAINT_CEILING_REGION: FloorDraftPurpose = {
  own: (room, onCancel) =>
    beginGesture({
      kind: 'ceiling-paint-region',
      scope: {
        kind: 'handle-drag',
        nodeId: room.ceilingId ?? room.zoneId,
        handle: CEILING_PAINT_REGION_HANDLE,
      },
      paintSubMode: true,
      stale: () => floorRegionRoomGone(useScene.getState().nodes) || !floorRegionEditable(),
      onCancel,
    }),
  canStart: PAINT_FLOOR_REGION.canStart,
  commit: (room, polygon) =>
    commitCeilingRegion(room, polygon)
      ? { ok: true }
      : { ok: false, message: usePaintRegionMode.getState().notice ?? '' },
}

function purposeOf(room: FloorRegionRoom) {
  return room.purpose ?? PAINT_FLOOR_REGION
}

// The draft's lifecycle handle: a press, or a whole polygon across clicks.
let owner: GestureHandle | null = null

function clearDraft() {
  if (useFloorRegionDraft.getState().draft) useFloorRegionDraft.setState({ draft: null })
}

function ownDraft(room: FloorRegionRoom) {
  if (owner?.active) return owner
  const handle = purposeOf(room).own(room, () => {
    if (owner === handle) owner = null
    clearDraft()
  })
  owner = handle
  return handle
}

/** Ends the draft normally (committed, or nothing left to draw); a persistent tool stays. */
function endDraft(room: FloorRegionRoom) {
  const current = owner
  owner = null
  clearDraft()
  if (!purposeOf(room).persistent) current?.end()
}

/** The draft's lifecycle handle, for the surface's pointer capture. */
export function floorRegionGesture(): GestureHandle | null {
  return owner?.active ? owner : null
}

export function cancelFloorRegion() {
  const current = owner
  owner = null
  if (current?.active) current.cancel()
  else clearDraft()
}

/** Drops the draft in hand: a paint draft is cancelled, a persistent tool stays armed. */
export function dropFloorRegionDraft() {
  const draft = useFloorRegionDraft.getState().draft
  if (!(draft && purposeOf(draft.room).persistent)) return cancelFloorRegion()
  owner = null
  clearDraft()
}

export function setFloorRegionHover(hover: FloorRegionHover | null) {
  const current = useFloorRegionDraft.getState().hover
  if (
    current === hover ||
    (current &&
      hover &&
      current.levelId === hover.levelId &&
      current.elevation === hover.elevation &&
      samePoint(current.point, hover.point))
  )
    return
  useFloorRegionDraft.setState({ hover })
}

/**
 * A press on a room's floor. Rectangle: the first corner (the opposite one
 * once a click anchored the first). Polygon: previews the point the release
 * will place (starting a draft in this room if none).
 * Returns whether the press belongs to the region draft.
 */
export function pressFloorRegion(
  mode: 'rectangle' | 'polygon',
  room: FloorRegionRoom,
  raw: FloorRegionPoint,
  settings: FloorRegionSnapSettings,
  closeRadius: number,
): boolean {
  const current = useFloorRegionDraft.getState().draft
  if (!(current || (purposeOf(room).canStart?.() ?? true))) return true
  const draftRoom = mode === 'polygon' && current?.kind === 'polygon' ? current.room : room
  if (current && current.room !== draftRoom) cancelFloorRegion()
  ownDraft(draftRoom)
  const point = snap(draftRoom, raw, settings)
  if (mode === 'rectangle') {
    if (current?.kind === 'rectangle' && current.anchored && !current.refusal) {
      useFloorRegionDraft.setState({ draft: { ...current, end: point } })
      return true
    }
    useFloorRegionDraft.setState({
      draft: { kind: 'rectangle', room: draftRoom, start: point, end: point },
    })
    return true
  }
  const points = current?.kind === 'polygon' ? current.points : []
  useFloorRegionDraft.setState({
    draft: {
      kind: 'polygon',
      room: draftRoom,
      points,
      cursor: point,
      message: polygonLiveMessage(points, point, closeRadius, draftRoom),
      refusal: current?.kind === 'polygon' ? current.refusal : null,
    },
  })
  return true
}

/** The pointer moved: the rectangle's opposite corner, or the polygon's live point. */
export function moveFloorRegion(
  raw: FloorRegionPoint,
  settings: FloorRegionSnapSettings,
  closeRadius: number,
) {
  const draft = useFloorRegionDraft.getState().draft
  if (!draft) return
  const point = snap(draft.room, raw, settings)
  if (draft.kind === 'rectangle') {
    if (!(draft.refusal || samePoint(point, draft.end)))
      useFloorRegionDraft.setState({ draft: { ...draft, end: point } })
    return
  }
  if (draft.cursor && samePoint(point, draft.cursor)) return
  useFloorRegionDraft.setState({
    draft: {
      ...draft,
      cursor: point,
      message: polygonLiveMessage(draft.points, point, closeRadius, draft.room),
    },
  })
}

function finishPolygon(
  draft: Extract<FloorRegionDraft, { kind: 'polygon' }>,
  points: FloorRegionPoint[],
) {
  const result = commitDraft(draft.room, points)
  if (!result.ok)
    useFloorRegionDraft.setState({
      draft: {
        ...draft,
        points,
        cursor: null,
        message: null,
        refusal: purposeOf(draft.room).persistent ? result.message : null,
      },
    })
}

/**
 * The press was released. Rectangle: commits the box (a click without a drag
 * commits nothing, or anchors the first corner in a persistent tool). Polygon: places the point, or closes and commits the ring
 * on the first point. A crossing edge is refused and stays red.
 */
export function releaseFloorRegion(closeRadius: number) {
  const draft = useFloorRegionDraft.getState().draft
  if (!draft) return
  if (draft.kind === 'rectangle') {
    if (draft.refusal) return
    const box = floorRegionDraftOutline(draft)
    const persistent = purposeOf(draft.room).persistent
    // A click without a drag paints nothing; in a persistent tool it places
    // the first corner and the next click the opposite one, like a Rectangle
    // room. A persistent tool refuses a real box outside the room with a
    // label; paint just drops it.
    const nothing = persistent
      ? area([{ outer: box, holes: [] }]) < MIN_FLOOR_REGION_AREA
      : !clipFloorRegion(box, draft.room.clear)
    if (nothing && persistent && !draft.anchored) {
      useFloorRegionDraft.setState({ draft: { ...draft, anchored: true } })
      return
    }
    if (nothing) return endDraft(draft.room)
    const result = commitDraft(draft.room, box)
    if (result.ok) return
    if (persistent) useFloorRegionDraft.setState({ draft: { ...draft, refusal: result.message } })
    else endDraft(draft.room)
    return
  }
  const { points, cursor } = draft
  if (!cursor) return
  const message = polygonLiveMessage(points, cursor, closeRadius, draft.room)
  if (message) {
    useFloorRegionDraft.setState({ draft: { ...draft, message } })
    return
  }
  if (closesOnFirst(points, cursor, closeRadius)) return finishPolygon(draft, points)
  if (points.length && samePoint(points.at(-1)!, cursor)) return
  useFloorRegionDraft.setState({
    draft: { ...draft, points: [...points, cursor], message: null, refusal: null },
  })
}

/** Enter: closes the polygon on its first point (three points or more). */
export function finishFloorRegion() {
  const draft = useFloorRegionDraft.getState().draft
  if (draft?.kind !== 'polygon' || draft.points.length < 3) return false
  const { points } = draft
  if (floorRegionEdgeCrosses(points, points[0]!, true)) {
    useFloorRegionDraft.setState({ draft: { ...draft, message: CROSSING_MESSAGE } })
    return true
  }
  finishPolygon(draft, points)
  return true
}

/** Backspace: drops the polygon's last point; the draft ends with its first point. */
export function removeLastFloorRegionPoint() {
  const draft = useFloorRegionDraft.getState().draft
  if (draft?.kind !== 'polygon') return false
  const points = draft.points.slice(0, -1)
  if (!points.length) {
    endDraft(draft.room)
    return true
  }
  useFloorRegionDraft.setState({
    draft: { ...draft, points, message: null, refusal: null },
  })
  return true
}

/** Whether the draft's room is gone (undo, delete, another level). */
export function floorRegionRoomGone(nodes: Record<string, AnyNode>) {
  const draft = useFloorRegionDraft.getState().draft
  if (!draft) return false
  if (draft.room.ceilingId) {
    const ceiling = nodes[draft.room.ceilingId as AnyNodeId]
    return ceiling?.type !== 'ceiling' || ceiling.parentId !== draft.room.levelId
  }
  const zone = nodes[draft.room.zoneId as AnyNodeId]
  return zone?.type !== 'zone' || zone.parentId !== draft.room.levelId
}

/** Whether the scene can take a region now. */
export function floorRegionEditable() {
  return !useScene.getState().readOnly
}
