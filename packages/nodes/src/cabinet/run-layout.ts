import type { AnyNode, CabinetModuleNode, CabinetNode, GeometryContext } from '@pascal-app/core'

/**
 * Straight-line run layout math — the single home for the "modules sit on the
 * run's local X axis" assumption. Ordering, edges, adjacency, spans, and
 * insert positions all live here so a future corner (L-shape) module changes
 * one file instead of five call sites.
 */

export const RUN_ADJACENCY_EPSILON = 1e-4

const ADJACENT_RUN_EPSILON = 1e-4
const ADJACENT_RUN_Z_TOLERANCE = 0.03

type ModuleLike = Pick<CabinetModuleNode, 'id' | 'position' | 'width'>

type ReflowRunModulesOptions = {
  minimumWidth?: number
  preserveExtent?: boolean
  restorableWidthById?: ReadonlyMap<CabinetModuleNode['id'], number>
}

export function sortRunModules<T extends ModuleLike>(modules: readonly T[]): T[] {
  return [...modules].sort((a, b) => a.position[0] - b.position[0])
}

export function moduleMinX(module: Pick<CabinetModuleNode, 'position' | 'width'>): number {
  return module.position[0] - module.width / 2
}

export function moduleMaxX(module: Pick<CabinetModuleNode, 'position' | 'width'>): number {
  return module.position[0] + module.width / 2
}

export function runMinX(modules: readonly ModuleLike[]): number {
  return Math.min(...modules.map(moduleMinX))
}

export function runMaxX(modules: readonly ModuleLike[]): number {
  return Math.max(...modules.map(moduleMaxX))
}

/**
 * Whether a module's side has no flush neighbor — i.e. the side is free for a
 * width-resize handle or an adjacent insert.
 */
export function moduleSideOpen<T extends ModuleLike>(
  modules: readonly T[],
  moduleId: string,
  side: 'left' | 'right',
  epsilon = RUN_ADJACENCY_EPSILON,
): boolean {
  const sorted = sortRunModules(modules)
  const index = sorted.findIndex((entry) => entry.id === moduleId)
  if (index < 0) return true
  const module = sorted[index]!
  const neighbor = side === 'left' ? sorted[index - 1] : sorted[index + 1]
  if (!neighbor) return true
  const edge = side === 'left' ? moduleMinX(module) : moduleMaxX(module)
  const neighborEdge = side === 'left' ? moduleMaxX(neighbor) : moduleMinX(neighbor)
  return Math.abs(edge - neighborEdge) > epsilon
}

export type RunSpan = {
  minX: number
  maxX: number
  centerX: number
  centerZ: number
  width: number
  depth: number
  minZ: number
  maxZ: number
  topY: number
  hasCountertop: boolean
}

/**
 * Contiguous same-height module groups along the run — the units the
 * countertop, plinth, and appliance-gap logic operate on. A gap, a
 * base↔tall transition, a top-height change, or a depth-footprint change
 * starts a new span.
 */
export function getRunSpans(
  modules: readonly Pick<
    CabinetModuleNode,
    'position' | 'width' | 'depth' | 'carcassHeight' | 'cabinetType'
  >[],
  opts: {
    runTier?: CabinetNode['runTier']
  } = {},
): RunSpan[] {
  const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
  const spans: RunSpan[] = []
  const runTier = opts.runTier ?? 'base'

  for (const module of sorted) {
    const minX = module.position[0] - module.width / 2
    const maxX = module.position[0] + module.width / 2
    const minZ = module.position[2] - module.depth / 2
    const maxZ = module.position[2] + module.depth / 2
    const topY = module.position[1] + module.carcassHeight
    const hasCountertop = runTier === 'base' && (module.cabinetType ?? 'base') !== 'tall'
    const current = spans.at(-1)
    if (
      !current ||
      minX - current.maxX > RUN_ADJACENCY_EPSILON ||
      current.hasCountertop !== hasCountertop ||
      Math.abs(current.topY - topY) > RUN_ADJACENCY_EPSILON ||
      Math.abs(current.minZ - minZ) > RUN_ADJACENCY_EPSILON ||
      Math.abs(current.maxZ - maxZ) > RUN_ADJACENCY_EPSILON
    ) {
      spans.push({
        minX,
        maxX,
        centerX: module.position[0],
        centerZ: module.position[2],
        width: module.width,
        depth: module.depth,
        minZ,
        maxZ,
        topY,
        hasCountertop,
      })
      continue
    }

    current.maxX = Math.max(current.maxX, maxX)
    current.minZ = Math.min(current.minZ, minZ)
    current.maxZ = Math.max(current.maxZ, maxZ)
    current.width = Math.max(0.01, current.maxX - current.minX)
    current.centerX = (current.minX + current.maxX) / 2
    current.depth = Math.max(0.01, current.maxZ - current.minZ)
    current.centerZ = (current.minZ + current.maxZ) / 2
    current.topY = Math.max(current.topY, topY)
  }

  return spans
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

export function derivedCornerRole(
  metadata: unknown,
): { role: 'base-leg' | 'wall-leg' | 'bridge'; side: 'left' | 'right' } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).cabinetCornerDerivedRun
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = (value as { role?: unknown }).role
  const side = (value as { side?: unknown }).side
  if (
    (role !== 'base-leg' && role !== 'wall-leg' && role !== 'bridge') ||
    (side !== 'left' && side !== 'right')
  ) {
    return null
  }
  return { role, side }
}

function childDerivedBaseLegSides(ctx?: GeometryContext): Set<'left' | 'right'> {
  const sides = new Set<'left' | 'right'>()
  for (const child of ctx?.children ?? []) {
    if (child.type !== 'cabinet') continue
    const link = derivedCornerRole(child.metadata)
    if (link?.role === 'base-leg') sides.add(link.side)
  }
  return sides
}

function modulesForRun(node: CabinetNode, ctx?: GeometryContext): CabinetModuleNode[] {
  return (node.children ?? [])
    .map((id) => ctx?.resolve<AnyNode>(id))
    .filter((child): child is CabinetModuleNode => child?.type === 'cabinet-module')
}

function siblingCabinetSpansInRunLocal(node: CabinetNode, ctx?: GeometryContext) {
  if (!ctx) return []

  const localX = [Math.cos(node.rotation), -Math.sin(node.rotation)] as const
  const localZ = [Math.sin(node.rotation), Math.cos(node.rotation)] as const
  const spans: Array<{ minX: number; maxX: number; depth: number; z: number }> = []

  for (const sibling of ctx.siblings) {
    if (sibling.type !== 'cabinet' || sibling.id === node.id) continue
    if (Math.abs(angleDelta(sibling.rotation, node.rotation)) > 1e-3) continue

    const siblingModules = modulesForRun(sibling, ctx)
    const siblingSpans =
      siblingModules.length > 0
        ? getRunSpans(siblingModules, { runTier: sibling.runTier })
        : [
            {
              minX: -sibling.width / 2,
              maxX: sibling.width / 2,
              centerX: 0,
              centerZ: 0,
              width: sibling.width,
              depth: sibling.depth,
              minZ: -sibling.depth / 2,
              maxZ: sibling.depth / 2,
              topY: sibling.carcassHeight,
              hasCountertop: sibling.runTier !== 'tall',
            },
          ]
    const dx = sibling.position[0] - node.position[0]
    const dz = sibling.position[2] - node.position[2]
    const originX = dx * localX[0] + dz * localX[1]
    const originZ = dx * localZ[0] + dz * localZ[1]

    for (const span of siblingSpans) {
      spans.push({
        minX: originX + span.minX,
        maxX: originX + span.maxX,
        depth: span.depth,
        z: originZ + span.centerZ,
      })
    }
  }

  return spans
}

function hasAdjacentCabinetSpan({
  depth,
  edgeX,
  overhang,
  side,
  siblingSpans,
}: {
  depth: number
  edgeX: number
  overhang: number
  side: 'left' | 'right'
  siblingSpans: Array<{ minX: number; maxX: number; depth: number; z: number }>
}) {
  return siblingSpans.some((sibling) => {
    if (Math.abs(sibling.z) > (depth + sibling.depth) / 2 + ADJACENT_RUN_Z_TOLERANCE) {
      return false
    }
    const gap = side === 'left' ? edgeX - sibling.maxX : sibling.minX - edgeX
    return gap >= -ADJACENT_RUN_EPSILON && gap <= overhang + ADJACENT_RUN_EPSILON
  })
}

export type RunSpanEnds = {
  /** Countertop side overhang after neighbor / corner / bar suppression. */
  leftOverhang: number
  rightOverhang: number
  /** Run end with nothing abutting — where a waterfall panel would show. */
  exposedLeft: boolean
  exposedRight: boolean
}

/**
 * Per-span end conditions shared by the 3D run geometry and the 2D plan
 * outline, so the countertop reads identically in both views. The side
 * overhang is suppressed where a span abuts a tall neighbor in the same run,
 * an adjacent collinear run, a side bar ledge, or the mating edge of an
 * L-corner leg (either direction of the link).
 */
export function getRunSpanEnds(
  node: CabinetNode,
  ctx: GeometryContext | undefined,
  spans: readonly RunSpan[],
): RunSpanEnds[] {
  const siblingSpans = siblingCabinetSpansInRunLocal(node, ctx)
  const cornerLink = derivedCornerRole(node.metadata)
  const childBaseLegSides = childDerivedBaseLegSides(ctx)
  const barEdge = node.barLedge?.edge

  return spans.map((span, spanIndex) => {
    const previousSpan = spans[spanIndex - 1]
    const nextSpan = spans[spanIndex + 1]
    const hasFlushCountertopLeftNeighbor =
      !!previousSpan &&
      previousSpan.hasCountertop &&
      span.hasCountertop &&
      Math.abs(previousSpan.topY - span.topY) <= RUN_ADJACENCY_EPSILON &&
      span.minX - previousSpan.maxX <= RUN_ADJACENCY_EPSILON
    const hasFlushCountertopRightNeighbor =
      !!nextSpan &&
      nextSpan.hasCountertop &&
      span.hasCountertop &&
      Math.abs(nextSpan.topY - span.topY) <= RUN_ADJACENCY_EPSILON &&
      nextSpan.minX - span.maxX <= RUN_ADJACENCY_EPSILON
    const hasInternalLeftNeighbor =
      !!previousSpan &&
      (!previousSpan.hasCountertop || hasFlushCountertopLeftNeighbor) &&
      span.minX - previousSpan.maxX <= RUN_ADJACENCY_EPSILON
    const hasInternalRightNeighbor =
      !!nextSpan &&
      (!nextSpan.hasCountertop || hasFlushCountertopRightNeighbor) &&
      nextSpan.minX - span.maxX <= RUN_ADJACENCY_EPSILON
    const hasExternalLeftNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.minX,
      overhang: node.countertopOverhang,
      side: 'left',
      siblingSpans,
    })
    const hasExternalRightNeighbor = hasAdjacentCabinetSpan({
      depth: span.depth,
      edgeX: span.maxX,
      overhang: node.countertopOverhang,
      side: 'right',
      siblingSpans,
    })
    // A side bar's knee wall sits flush on that end — no slab overhang there.
    let leftOverhang =
      hasInternalLeftNeighbor || hasExternalLeftNeighbor || barEdge === 'left'
        ? 0
        : node.countertopOverhang
    let rightOverhang =
      hasInternalRightNeighbor || hasExternalRightNeighbor || barEdge === 'right'
        ? 0
        : node.countertopOverhang
    // A derived base leg mates back into the source run on its inner corner
    // edge, so that edge should be flush instead of carrying the usual
    // exposed countertop overhang. The source run stays flush there too.
    if (cornerLink?.role === 'base-leg') {
      if (cornerLink.side === 'right' && spanIndex === 0) leftOverhang = 0
      if (cornerLink.side === 'left' && spanIndex === spans.length - 1) rightOverhang = 0
    }
    if (childBaseLegSides.has('left') && spanIndex === 0) leftOverhang = 0
    if (childBaseLegSides.has('right') && spanIndex === spans.length - 1) rightOverhang = 0

    const exposedLeft =
      spanIndex === 0 && !hasExternalLeftNeighbor && !hasInternalLeftNeighbor && barEdge !== 'left'
    const exposedRight =
      spanIndex === spans.length - 1 &&
      !hasExternalRightNeighbor &&
      !hasInternalRightNeighbor &&
      barEdge !== 'right'

    return { leftOverhang, rightOverhang, exposedLeft, exposedRight }
  })
}

/**
 * X center for inserting a `width`-wide module on the given side of the
 * anchor (or on the run's outer edge with no anchor). Returns null when a
 * flush neighbor leaves no room on that side.
 */
export function sideInsertX({
  anchorModule,
  modules,
  side,
  width,
  epsilon = RUN_ADJACENCY_EPSILON,
}: {
  anchorModule: ModuleLike | null
  modules: readonly ModuleLike[]
  side: 'left' | 'right'
  width: number
  epsilon?: number
}): number | null {
  if (modules.length === 0) {
    return side === 'left' ? -width / 2 : width / 2
  }

  if (!anchorModule) {
    const edge = side === 'left' ? runMinX(modules) : runMaxX(modules)
    return side === 'left' ? edge - width / 2 : edge + width / 2
  }

  const selectedLeft = moduleMinX(anchorModule)
  const selectedRight = moduleMaxX(anchorModule)
  const siblings = modules.filter((module) => module.id !== anchorModule.id)

  if (side === 'left') {
    const nearestLeft = siblings
      .map(moduleMaxX)
      .filter((edge) => edge <= selectedLeft + epsilon)
      .reduce<number | null>((best, edge) => (best == null || edge > best ? edge : best), null)
    if (nearestLeft != null && selectedLeft - nearestLeft < width - epsilon) {
      return null
    }
    return selectedLeft - width / 2
  }

  const nearestRight = siblings
    .map(moduleMinX)
    .filter((edge) => edge >= selectedRight - epsilon)
    .reduce<number | null>((best, edge) => (best == null || edge < best ? edge : best), null)
  if (nearestRight != null && nearestRight - selectedRight < width - epsilon) {
    return null
  }
  return selectedRight + width / 2
}

/**
 * Re-pack the run left-to-right after one module's width changes, keeping
 * every module flush with its left neighbor. Returns per-module patches.
 */
export function reflowRunModules<T extends ModuleLike>(
  modules: readonly T[],
  selectedId: CabinetModuleNode['id'],
  selectedWidth: number,
  options: ReflowRunModulesOptions = {},
): Array<{ id: T['id']; position: T['position']; width: number }> {
  const sorted = sortRunModules(modules)
  const selectedIndex = sorted.findIndex((module) => module.id === selectedId)
  if (selectedIndex < 0) return []

  const widths = new Map(sorted.map((module) => [module.id, module.width]))
  widths.set(selectedId, selectedWidth)

  const selected = sorted[selectedIndex]!
  let remainingGrowth = selectedWidth - selected.width
  if (options.preserveExtent && remainingGrowth > RUN_ADJACENCY_EPSILON) {
    const minimumWidth = options.minimumWidth ?? 0.3
    const left = sorted.slice(0, selectedIndex).reverse()
    const right = sorted.slice(selectedIndex + 1)
    const capacity = (candidates: readonly T[]) =>
      candidates.reduce((total, module) => total + Math.max(0, module.width - minimumWidth), 0)
    const candidates = capacity(left) > capacity(right) ? [...left, ...right] : [...right, ...left]

    for (const module of candidates) {
      if (remainingGrowth <= RUN_ADJACENCY_EPSILON) break
      const available = Math.max(0, module.width - minimumWidth)
      const reduction = Math.min(available, remainingGrowth)
      widths.set(module.id, module.width - reduction)
      remainingGrowth -= reduction
    }
  }

  let remainingFreedWidth = selected.width - selectedWidth
  if (
    options.preserveExtent &&
    remainingFreedWidth > RUN_ADJACENCY_EPSILON &&
    options.restorableWidthById
  ) {
    const left = sorted.slice(0, selectedIndex).reverse()
    const right = sorted.slice(selectedIndex + 1)
    const restorable = (candidates: readonly T[]) =>
      candidates.reduce(
        (total, module) => total + (options.restorableWidthById?.get(module.id) ?? 0),
        0,
      )
    const candidates =
      restorable(left) > restorable(right) ? [...left, ...right] : [...right, ...left]

    for (const module of candidates) {
      if (remainingFreedWidth <= RUN_ADJACENCY_EPSILON) break
      const available = Math.max(0, options.restorableWidthById.get(module.id) ?? 0)
      const restoration = Math.min(available, remainingFreedWidth)
      widths.set(module.id, module.width + restoration)
      remainingFreedWidth -= restoration
    }
  }

  let nextLeft = runMinX(sorted)
  return sorted.map((module) => {
    const width = widths.get(module.id) ?? module.width
    const position: T['position'] = [
      nextLeft + width / 2,
      module.position[1],
      module.position[2],
    ] as T['position']
    nextLeft += width
    return { id: module.id, position, width }
  })
}

/** Full-run bounds in run-local frame (X along the run). */
export function runLocalXExtent(modules: readonly ModuleLike[]): {
  minX: number
  maxX: number
  centerX: number
  width: number
} | null {
  if (modules.length === 0) return null
  const minX = runMinX(modules)
  const maxX = runMaxX(modules)
  return { minX, maxX, centerX: (minX + maxX) / 2, width: Math.max(0.01, maxX - minX) }
}

export type RunLike = Pick<CabinetNode, 'position' | 'rotation'>

/** Rotate + translate a run-local point into the plan (level) frame. */
export function runLocalToPlan(
  run: RunLike,
  local: readonly [number, number, number],
): [number, number, number] {
  const cos = Math.cos(run.rotation)
  const sin = Math.sin(run.rotation)
  const [lx, ly, lz] = local
  return [
    run.position[0] + lx * cos + lz * sin,
    run.position[1] + ly,
    run.position[2] - lx * sin + lz * cos,
  ]
}

/** Inverse of {@link runLocalToPlan}. */
export function planToRunLocal(
  run: RunLike,
  planX: number,
  localY: number,
  planZ: number,
): [number, number, number] {
  const dx = planX - run.position[0]
  const dz = planZ - run.position[2]
  const cos = Math.cos(run.rotation)
  const sin = Math.sin(run.rotation)
  return [dx * cos - dz * sin, localY, dx * sin + dz * cos]
}
