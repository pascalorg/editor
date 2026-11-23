import {
  type AnyNode,
  LAWN_LIMITS,
  LawnBuildError,
  LawnNode,
  type LawnPlanMemo,
  LawnStroke,
  planLawn,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { create } from 'zustand'
import { beginLawnStroke, endLawnStroke, lawnStrokeCatchUpMs } from './stroke-rebuild'

type Point = [number, number]
export type LawnBrushSettings = Pick<LawnStroke, 'radiusM' | 'effect' | 'strength'> & {
  flowerSpecies?: 'existing' | LawnNode['flowers'][number]['species']
  flowerDensity?: number
}
export type LawnBrushRefusal =
  | LawnBuildError['code']
  | 'invalid-stroke'
  | 'point-budget'
  | 'flowers-required'
  | 'changed'
  | 'no_site'
type Refuse = (code: LawnBrushRefusal) => void
type FlowerPatch = Partial<Pick<LawnNode, 'flowers' | 'flowerDensity'>>
export const LAWN_BRUSH_EFFECTS = [
  'bare',
  'grass',
  'taller',
  'shorter',
  'more-flowers',
  'fewer-flowers',
] as const
export const useLawnAuthoring = create<LawnBrushSettings & { mode: 'area' | 'brush' }>(() => ({
  mode: 'area',
  radiusM: 0.5,
  effect: 'bare',
  strength: 1,
  flowerSpecies: 'existing',
  flowerDensity: 0.5,
}))
export const lawnBrushColor: Record<LawnStroke['effect'], string> = {
  bare: '#a07650',
  grass: '#617c36',
  taller: '#27845a',
  shorter: '#a5b75d',
  'more-flowers': '#b78dcc',
  'fewer-flowers': '#80728a',
}
const validPoint = (point: Point) =>
  point.every((value) => Number.isFinite(value) && Math.abs(value) <= LAWN_LIMITS.maxCoordinate)

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1]
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared))
    : 0
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz)
}

/** Bound error against the actual pointer samples, not an already simplified path. */
function strokePath(first: Point, radius: number) {
  let points: Point[] = [[...first]]
  let pending: Point[] = [[...first]]
  const tolerance = Math.min(0.01, radius * 0.02)
  return (point: Point): Point[] => {
    const anchor = points.at(-2)
    if (
      anchor &&
      pending.length < 128 &&
      pending.every((sample) => segmentDistance(sample, anchor, point) <= tolerance)
    ) {
      points = [...points.slice(0, -1), [...point]]
    } else {
      // Finalize the last valid segment before its raw-sample window can grow unbounded.
      const last = points.at(-1)
      pending = last ? [last] : []
      points = [...points, [...point]]
    }
    // Exactly straight samples need no transient history either.
    const a = pending.at(-2),
      b = pending.at(-1)
    if (a && b && segmentDistance(b, a, point) <= 1e-10) pending.pop()
    pending.push([...point])
    return points
  }
}

function currentLawn(node: LawnNode): LawnNode | null {
  const live = useScene.getState().nodes[node.id]
  return live?.type === 'lawn' &&
    live.parentId === node.parentId &&
    live.strokes === node.strokes &&
    live.outline === node.outline &&
    live.flowers === node.flowers &&
    live.flowerDensity === node.flowerDensity
    ? live
    : null
}

function preflight(
  node: LawnNode,
  patch: Partial<LawnNode>,
  refuse: Refuse,
  memo: LawnPlanMemo,
): LawnNode | null {
  const nodes: Readonly<Record<string, AnyNode | undefined>> = useScene.getState().nodes
  const site = node.parentId ? nodes[node.parentId] : undefined
  if (site?.type !== 'site') {
    refuse('no_site')
    return null
  }
  const parsed = LawnNode.safeParse({ ...node, ...patch })
  if (!parsed.success) {
    refuse('invalid-stroke')
    return null
  }
  try {
    planLawn(parsed.data, useScene.getState().nodes, memo)
    return parsed.data
  } catch (error) {
    if (!(error instanceof LawnBuildError)) throw error
    refuse(error.code)
    return null
  }
}

function strokeSession(
  node: LawnNode,
  stroke: LawnStroke,
  flowers: FlowerPatch,
  refuse: Refuse,
  onPointCount?: (count: number) => void,
) {
  let points = stroke.points
  const first = points[0]
  if (!first) return null
  const append = strokePath(first, stroke.radiusM)
  const savedPointCount = node.strokes.reduce((count, saved) => count + saved.points.length, 0)
  let active = true
  // Every sample is checked against the whole lawn's budgets; the parts of that plan no stroke
  // can change (retained area, ground before subdivision) are worked out once a stroke.
  const memo: LawnPlanMemo = {}
  let catchUp: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(catchUp)
    endLawnStroke(node.id)
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }
  const proposed = () => ({ ...flowers, strokes: [...node.strokes, { ...stroke, points }] })
  const validate = () => {
    if (savedPointCount + points.length > LAWN_LIMITS.maxStrokePoints) {
      refuse('point-budget')
      return null
    }
    const live = currentLawn(node)
    if (!live) {
      refuse('changed')
      return null
    }
    return preflight(live, proposed(), refuse, memo)
  }
  const preview = (): boolean => {
    if (!validate()) {
      active = false
      clear()
      return false
    }
    useLiveNodeOverrides.getState().set(node.id, proposed())
    useScene.getState().markDirty(node.id)
    // The lawn skips rebuilds between spaced samples; a pointer that then rests still gets its
    // last samples drawn.
    clearTimeout(catchUp)
    catchUp = setTimeout(() => useScene.getState().markDirty(node.id), lawnStrokeCatchUpMs(node.id))
    onPointCount?.(savedPointCount + points.length)
    return true
  }
  beginLawnStroke(node.id)
  if (!preview()) return null
  return {
    move(point: Point): boolean {
      if (!active) return false
      if (!validPoint(point)) {
        refuse('invalid-stroke')
        return false
      }
      const last = points.at(-1)
      if (last && last[0] === point[0] && last[1] === point[1]) return true
      points = append(point)
      return preview()
    },
    commit(): boolean {
      if (!active) return false
      active = false
      try {
        const next = validate()
        if (!next) return false
        useScene.getState().updateNode(node.id, { ...flowers, strokes: next.strokes })
        return true
      } finally {
        clear()
      }
    },
    cancel() {
      active = false
      clear()
    },
  }
}

/** One saved representation and generator preflight for hand input and ordinary agent edits. */
export function createLawnBrushStroke(
  node: LawnNode,
  settings: LawnBrushSettings,
  first: Point,
  onRefusal?: Refuse,
  onPointCount?: (count: number) => void,
) {
  const refuse: Refuse = (code) => onRefusal?.(code)
  const parsed = LawnStroke.safeParse({ ...settings, points: [first] })
  if (!parsed.success) {
    refuse('invalid-stroke')
    return null
  }
  if (
    node.strokes.reduce((count, stroke) => count + stroke.points.length, 0) >=
    LAWN_LIMITS.maxStrokePoints
  ) {
    refuse('point-budget')
    return null
  }
  const flowers: FlowerPatch =
    settings.effect === 'more-flowers' &&
    settings.flowerSpecies &&
    settings.flowerSpecies !== 'existing'
      ? {
          flowers: [{ species: settings.flowerSpecies, share: 1 }],
          flowerDensity: settings.flowerDensity,
        }
      : {}
  const configured = LawnNode.safeParse({ ...node, ...flowers })
  if (!configured.success) {
    refuse('invalid-stroke')
    return null
  }
  if (
    settings.effect === 'more-flowers' &&
    (!configured.data.flowers.length || configured.data.flowerDensity <= 0)
  ) {
    refuse('flowers-required')
    return null
  }
  return strokeSession(node, parsed.data, flowers, refuse, onPointCount)
}
