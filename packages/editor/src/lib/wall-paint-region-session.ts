import { type AnyNodeId, useScene, type WallFace } from '@pascal-app/core'
import { create } from 'zustand'
import useEditor from '../store/use-editor'
import { beginGesture, type GestureHandle } from './gesture-lifecycle'
import { hasActivePaintMaterial } from './material-paint'
import { isPaintErasing, usePaintRegionMode } from './paint-region-mode'
import {
  addWallRegion,
  type RegionWriteResult,
  WALL_REGION_CAP_MESSAGE,
  type WallRegionBounds,
  wallFaceHasRoom,
} from './paint-regions'
import type { WallFaceExtent } from './wall-region-face'
import {
  DEFAULT_WAINSCOT_HEIGHT,
  faceBaseAt,
  MIN_WALL_REGION_SIZE,
  snapWallRegionValue,
  type WallFaceBaseRuns,
  type WallRegionSnap,
  type WallRegionSnapTargets,
  wallRegionSnapTargets,
} from './wall-region-snap'

// The wall half of "Paint part of a surface": hover → press anywhere on a face
// → drag to the opposite corner → release paints one rectangle, as one undo
// step. Pure over face coordinates — the 3D tool resolves the pointer to a
// `WallRegionHit` and renders `preview`.

export const WALL_PAINT_REGION_HANDLE = 'paint-region'
export const PICK_MATERIAL_MESSAGE = 'Pick a material first'

/** The pointer on one wall face. `u` / `v` are raw (unsnapped) face coordinates. */
export type WallRegionHit = {
  wallId: string
  face: WallFace
  u: number
  v: number
  /** Reference chord length. */
  length: number
  extent: WallFaceExtent
  runs: WallFaceBaseRuns
}

export type WallRegionPreview = {
  wallId: string
  face: WallFace
  /** What a release now would paint (absent bounds run to the edge); null = nothing. */
  bounds: WallRegionBounds | null
  /** The pressed corner, or where a press would put it. */
  corner: [number, number]
  /** The readout: width × height. */
  measure: { values: number[]; u: number; v: number } | null
  pressed: boolean
}

type Gesture = {
  owner: GestureHandle
  hit: WallRegionHit
  targets: WallRegionSnapTargets
  corner: [number, number]
}

export const useWallPaintRegionSession = create<{ preview: WallRegionPreview | null }>(() => ({
  preview: null,
}))

let gesture: Gesture | null = null

export function isWallRegionGestureActive() {
  return gesture !== null
}

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/** Room the face has above its base at `u`. */
function faceHeightAt(hit: WallRegionHit, u: number) {
  return hit.extent.top - faceBaseAt(hit.runs, u)
}

function targetsFor(hit: WallRegionHit): WallRegionSnapTargets {
  const nodes = useScene.getState().nodes
  const wall = nodes[hit.wallId as AnyNodeId]
  if (wall?.type !== 'wall') return { u: [0, hit.length], v: [0, DEFAULT_WAINSCOT_HEIGHT] }
  const targets = wallRegionSnapTargets(wall, hit.face, nodes, hit.runs)
  return { ...targets, v: [...targets.v, faceHeightAt(hit, hit.u)] }
}

/** The pointer on the face, snapped and held inside it. */
function snapped(hit: WallRegionHit, targets: WallRegionSnapTargets, snap: WallRegionSnap) {
  const u = clamp(snapWallRegionValue(hit.u, targets.u, snap).value, 0, hit.length)
  const v = clamp(snapWallRegionValue(hit.v, targets.v, snap).value, 0, faceHeightAt(hit, u))
  return { ...hit, u, v }
}

/** The box between the pressed corner and the pointer, or null when it would paint a sliver. */
export function wallRegionBoundsFor(state: {
  hit: WallRegionHit
  corner: [number, number]
}): WallRegionBounds | null {
  const { hit } = state
  const [au, av] = state.corner
  const bu = clamp(hit.u, 0, hit.length)
  const bv = clamp(hit.v, 0, faceHeightAt(hit, bu))
  const u0 = Math.min(au, bu)
  const u1 = Math.max(au, bu)
  const v0 = Math.min(av, bv)
  const v1 = Math.max(av, bv)
  if (u1 - u0 < MIN_WALL_REGION_SIZE || v1 - v0 < MIN_WALL_REGION_SIZE) return null
  const bounds: WallRegionBounds = {}
  // A bound on the face's edge is left open, so the region follows the edge.
  if (u0 > 1e-6) bounds.u0 = u0
  if (u1 < hit.length - 1e-6) bounds.u1 = u1
  if (v0 > 1e-6) bounds.v0 = v0
  if (v1 < faceHeightAt(hit, (u0 + u1) / 2) - 1e-6) bounds.v1 = v1
  return bounds
}

function previewOf(state: Omit<Gesture, 'owner'>, pressed: boolean): WallRegionPreview {
  const { hit, corner } = state
  const base = { wallId: hit.wallId, face: hit.face, corner, pressed }
  if (!pressed) return { ...base, bounds: null, measure: null }
  const [au, av] = corner
  return {
    ...base,
    bounds: wallRegionBoundsFor(state),
    measure: {
      values: [Math.abs(hit.u - au), Math.abs(hit.v - av)],
      u: (au + hit.u) / 2,
      v: (av + hit.v) / 2,
    },
  }
}

function track(hit: WallRegionHit, snap: WallRegionSnap): Omit<Gesture, 'owner'> {
  const targets = targetsFor(hit)
  const at = snapped(hit, targets, snap)
  return { hit: at, targets, corner: [at.u, at.v] }
}

/** Pointer over the canvas with no gesture live: preview where a press would start the box. */
export function hoverWallRegion(hit: WallRegionHit | null, snap: WallRegionSnap) {
  if (gesture) return
  useWallPaintRegionSession.setState({
    preview: hit ? previewOf(track(hit, snap), false) : null,
  })
}

/**
 * Starts a gesture at any point of a face, or refuses it with a notice.
 * Returns whether it started. The gesture lives under the lifecycle owner: a
 * sub-mode, mode, level or selection change, its scope replaced, its wall
 * deleted or any history command cancels it; `onHostCancel` lets the pointer
 * surface drop its press.
 */
export function pressWallRegion(
  hit: WallRegionHit,
  snap: WallRegionSnap,
  onHostCancel?: () => void,
): boolean {
  const regionMode = usePaintRegionMode.getState()
  regionMode.setNotice(null)
  const editor = useEditor.getState()
  if (isPaintErasing() || !hasActivePaintMaterial(editor.activePaintMaterial)) {
    regionMode.setNotice(PICK_MATERIAL_MESSAGE)
    return false
  }
  const wall = useScene.getState().nodes[hit.wallId as AnyNodeId]
  if (wall?.type !== 'wall' || useScene.getState().readOnly) return false
  if (!wallFaceHasRoom(wall, hit.face)) {
    regionMode.setNotice(WALL_REGION_CAP_MESSAGE)
    return false
  }
  gesture?.owner.cancel()
  const tracked = track(hit, snap)
  const owner = beginGesture({
    kind: 'wall-paint-region',
    scope: { kind: 'handle-drag', nodeId: hit.wallId, handle: WALL_PAINT_REGION_HANDLE },
    paintSubMode: true,
    stale: () => {
      const state = useScene.getState()
      return state.readOnly || state.nodes[hit.wallId as AnyNodeId]?.type !== 'wall'
    },
    onCancel: () => {
      if (gesture?.owner === owner) gesture = null
      useWallPaintRegionSession.setState({ preview: null })
      onHostCancel?.()
    },
  })
  gesture = { ...tracked, owner }
  useWallPaintRegionSession.setState({ preview: previewOf(gesture, true) })
  return true
}

/** The live gesture's lifecycle handle (the surface captures its pointer through it). */
export function activeWallRegionGesture(): GestureHandle | null {
  return gesture?.owner ?? null
}

/** The pointer moved with the button held; `hit` is on the pressed face. */
export function dragWallRegion(hit: WallRegionHit, snap: WallRegionSnap) {
  if (!gesture || hit.wallId !== gesture.hit.wallId || hit.face !== gesture.hit.face) return
  gesture.hit = snapped(hit, gesture.targets, snap)
  useWallPaintRegionSession.setState({ preview: previewOf(gesture, true) })
}

/** Ends the gesture and paints its region. Null when nothing was committed. */
export function releaseWallRegion(): RegionWriteResult | null {
  const current = gesture
  if (!current) return null
  gesture = null
  useWallPaintRegionSession.setState({ preview: null })
  const bounds = wallRegionBoundsFor(current)
  if (!bounds) {
    current.owner.end()
    return null
  }
  const paint = useEditor.getState().activePaintMaterial
  const result =
    current.owner.finish(() =>
      addWallRegion(current.hit.wallId, current.hit.face, bounds, {
        material: paint?.material,
        materialPreset: paint?.materialPreset,
      }),
    ) ?? null
  if (result && !result.ok) usePaintRegionMode.getState().setNotice(result.message)
  return result
}

/** Drops the gesture without writing anything. Returns whether one was live. */
export function cancelWallRegion(): boolean {
  const current = gesture
  if (!current) return false
  current.owner.cancel()
  gesture = null
  useWallPaintRegionSession.setState({ preview: null })
  return true
}

/** The wall the live gesture draws on, if any. */
export function activeWallRegionTarget(): { wallId: string; face: WallFace } | null {
  return gesture ? { wallId: gesture.hit.wallId, face: gesture.hit.face } : null
}
