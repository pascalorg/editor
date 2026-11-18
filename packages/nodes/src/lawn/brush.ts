import {
  type AnyNode,
  LAWN_LIMITS,
  LawnBuildError,
  LawnNode,
  LawnStroke,
  planLawn,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { create } from 'zustand'

type Point = [number, number]
export type LawnBrushSettings = Pick<LawnStroke, 'radiusM' | 'effect' | 'strength'> & {
  flowerSpecies?: 'existing' | LawnNode['flowers'][number]['species']
  flowerDensity?: number
}
export type LawnBrushRefusal =
  | LawnBuildError['code']
  | 'invalid-stroke'
  | 'stroke-limit'
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

/** Resample only the in-flight path, never any previously authored stroke. */
function boundedPath(points: Point[]): Point[] {
  if (points.length <= LAWN_LIMITS.maxStrokePoints) return points
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (a && b) lengths.push((lengths.at(-1) ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = lengths.at(-1) ?? 0
  let segment = 1
  return Array.from({ length: LAWN_LIMITS.maxStrokePoints }, (_, index): Point => {
    if (index === 0) return [...(points[0] ?? [0, 0])]
    if (index === LAWN_LIMITS.maxStrokePoints - 1) return [...(points.at(-1) ?? [0, 0])]
    const distance = (total * index) / (LAWN_LIMITS.maxStrokePoints - 1)
    while (segment < points.length - 1 && (lengths[segment] ?? 0) < distance) segment++
    const a = points[segment - 1],
      b = points[segment]
    if (!a || !b) return [...(points[0] ?? [0, 0])]
    const start = lengths[segment - 1] ?? 0
    const length = (lengths[segment] ?? start) - start
    const t = length > 0 ? (distance - start) / length : 0
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  })
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

function preflight(node: LawnNode, patch: Partial<LawnNode>, refuse: Refuse): LawnNode | null {
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
    planLawn(parsed.data, useScene.getState().nodes)
    return parsed.data
  } catch (error) {
    if (!(error instanceof LawnBuildError)) throw error
    refuse(error.code)
    return null
  }
}

function strokeSession(node: LawnNode, stroke: LawnStroke, flowers: FlowerPatch, refuse: Refuse) {
  let points = stroke.points
  let active = true
  const clear = () => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
  }
  const proposed = () => ({ ...flowers, strokes: [...node.strokes, { ...stroke, points }] })
  const validate = () => {
    const live = currentLawn(node)
    if (!live) {
      refuse('changed')
      return null
    }
    return preflight(live, proposed(), refuse)
  }
  const preview = (): boolean => {
    if (!validate()) {
      active = false
      clear()
      return false
    }
    useLiveNodeOverrides.getState().set(node.id, proposed())
    useScene.getState().markDirty(node.id)
    return true
  }
  if (!preview()) return null
  return {
    move(point: Point): boolean {
      if (!active || !validPoint(point)) return false
      const last = points.at(-1)
      if (last && last[0] === point[0] && last[1] === point[1]) return true
      points = boundedPath([...points, [...point]])
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
) {
  const refuse: Refuse = (code) => onRefusal?.(code)
  const parsed = LawnStroke.safeParse({ ...settings, points: [first] })
  if (!parsed.success) {
    refuse('invalid-stroke')
    return null
  }
  if (node.strokes.length >= LAWN_LIMITS.maxStrokes) {
    refuse('stroke-limit')
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
  return strokeSession(node, parsed.data, flowers, refuse)
}
