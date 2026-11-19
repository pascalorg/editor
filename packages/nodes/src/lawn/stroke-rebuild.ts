/**
 * What the viewer is told about rebuilding a lawn while it is painted (the lawn's `geometryKey`).
 * A hand stroke publishes the lawn it proposes on every pointer sample, and each one used to
 * rebuild the whole lawn. A mounted lawn now redraws the touched chunks itself
 * (`stroke-chunks.ts`) and the viewer keeps its build, through the stroke and after an exact
 * release. Where no mounted build can be redrawn, whole rebuilds are spaced: at most every
 * `LAWN_STROKE_REBUILD_MS`, and never more than `LAWN_STROKE_REBUILD_SHARE` of the time. The same
 * spacing paces the whole-lawn flower rebuilds. A cancel and every other change rebuild at once.
 */
import { useLiveNodeOverrides, useScene } from '@pascal-app/core'

export const LAWN_STROKE_REBUILD_MS = 120
export const LAWN_STROKE_REBUILD_SHARE = 0.2

type Stroke = { key?: string; at: number; cost: number; chunked: boolean }
const strokes = new Map<string, Stroke>()
const issued = new Map<string, string>()
const exact = new Map<string, unknown>()
let builds = 0

const spacing = (stroke: Stroke) =>
  Math.max(LAWN_STROKE_REBUILD_MS, stroke.cost / LAWN_STROKE_REBUILD_SHARE)

export function beginLawnStroke(id: string): void {
  strokes.set(id, { at: 0, cost: 0, chunked: false })
  // A build kept from an earlier release is kept again only if this stroke is released too:
  // a cancel or a refusal must rebuild.
  exact.delete(id)
}

export function endLawnStroke(id: string): void {
  strokes.delete(id)
}

export function lawnStrokeInProgress(id: string): boolean {
  return strokes.has(id)
}

export function lawnStrokesInProgress(): string[] {
  return [...strokes.keys()]
}

/**
 * The mounted lawn redraws this stroke chunk by chunk (`stroke-chunks.ts`), so the viewer keeps
 * the build it has until the stroke ends. Without it the spaced whole rebuilds below apply.
 */
export function setLawnStrokeChunked(id: string, chunked: boolean): void {
  const stroke = strokes.get(id)
  if (stroke) stroke.chunked = chunked
}

/**
 * A released stroke left the mounted lawn, chunk by chunk, exactly as a full build of this scene
 * would make it: the viewer keeps that build until the scene changes again.
 */
export function keepLawnBuildFor(id: string, scene: unknown): void {
  exact.set(id, scene)
}

/** What the lawn's last full build cost; a slower lawn spaces its stroke rebuilds further apart. */
export function noteLawnBuild(id: string, ms: number): void {
  const stroke = strokes.get(id)
  if (stroke) stroke.cost = ms
}

/** How long after a sample the lawn is certain to accept a rebuild again. */
export function lawnStrokeCatchUpMs(id: string): number {
  const stroke = strokes.get(id)
  return stroke ? spacing(stroke) : 0
}

/**
 * The lawn's `geometryKey`: the viewer keeps the current build while the key is unchanged. A lawn
 * also depends on its Site (ground, buildings, paving, beds), which a key cannot see, so every
 * call gets a new key and rebuilds, except the samples of one stroke that fall inside its spacing.
 */
export function lawnGeometryKey(node: { id: string }, now = performance.now()): string {
  const stroke = strokes.get(node.id)
  const held = issued.get(node.id)
  if (stroke?.chunked && held !== undefined) return held
  if (exact.has(node.id)) {
    if (
      !stroke &&
      held !== undefined &&
      exact.get(node.id) === useScene.getState().nodes &&
      !useLiveNodeOverrides.getState().overrides.has(node.id)
    )
      return held
    exact.delete(node.id)
  }
  if (stroke?.key !== undefined && now - stroke.at < spacing(stroke)) return stroke.key
  const key = `lawn-build-${++builds}`
  issued.set(node.id, key)
  if (stroke) {
    stroke.key = key
    stroke.at = now
  }
  return key
}
