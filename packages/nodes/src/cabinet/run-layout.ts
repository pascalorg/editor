import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { resolveLevelId } from '@pascal-app/core'

/**
 * Straight-line run layout math — the single home for the "modules sit on the
 * run's local X axis" assumption. Ordering, edges, adjacency, spans, and
 * insert positions all live here so a future corner (L-shape) module changes
 * one file instead of five call sites.
 */

export const RUN_ADJACENCY_EPSILON = 1e-4

const ADJACENT_RUN_EPSILON = 1e-4
const ADJACENT_RUN_Z_TOLERANCE = 0.03
const REFLOW_CAPACITY_EPSILON = 1e-9

type ModuleLike = Pick<CabinetModuleNode, 'id' | 'position' | 'width'>

type ReflowRunModulesOptions = {
  wallConstraints?: RunWallConstraints
  resizeSide?: 'left' | 'right'
  consumeAdjacentGap?: boolean
  eligibleDonorIds?: ReadonlySet<CabinetModuleNode['id']>
  maximumWidth?: number
  maximumWidthById?: ReadonlyMap<CabinetModuleNode['id'], number>
  minimumWidth?: number
  minimumWidthById?: ReadonlyMap<CabinetModuleNode['id'], number>
  nominalWidthById?: ReadonlyMap<CabinetModuleNode['id'], number>
  restorableWidthById?: ReadonlyMap<CabinetModuleNode['id'], number>
}

export type RunWallEndConstraint = {
  constrained: boolean
  slack: number
}

export type RunWallConstraints = {
  left: RunWallEndConstraint
  right: RunWallEndConstraint
}

type RunWallConstraintOptions = {
  widthGrowth?: number
}

const OPEN_RUN_END: RunWallEndConstraint = { constrained: false, slack: 0 }

export function sortRunModules<T extends ModuleLike>(modules: readonly T[]): T[] {
  return [...modules].sort((a, b) => a.position[0] - b.position[0])
}

export function moduleMinX(module: Pick<CabinetModuleNode, 'position' | 'width'>): number {
  return module.position[0] - module.width / 2
}

export function moduleMaxX(module: Pick<CabinetModuleNode, 'position' | 'width'>): number {
  return module.position[0] + module.width / 2
}

function levelIdForRun(
  run: Pick<CabinetNode, 'parentId'>,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): AnyNodeId | null {
  let parentId = run.parentId as AnyNodeId | null
  const visited = new Set<AnyNodeId>()
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes[parentId]
    if (!parent) return null
    if (parent.type === 'level') return parent.id as AnyNodeId
    parentId = parent.parentId as AnyNodeId | null
  }
  return null
}

function runInLevelFrame(
  run: Pick<CabinetNode, 'depth' | 'parentId' | 'position' | 'rotation'>,
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
): Pick<CabinetNode, 'depth' | 'position' | 'rotation'> {
  let position: CabinetNode['position'] = [...run.position]
  let rotation = run.rotation
  let parentId = run.parentId as AnyNodeId | null
  const visited = new Set<AnyNodeId>()

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes[parentId]
    if (parent?.type !== 'cabinet' && parent?.type !== 'cabinet-module') break
    position = runLocalToPlan(parent, position)
    rotation += parent.rotation
    parentId = parent.parentId as AnyNodeId | null
  }

  return { depth: run.depth, position, rotation }
}

function closestPointOnSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): readonly [number, number] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-8) return start
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  return [start[0] + t * dx, start[1] + t * dz]
}

function wallConstraintAtRunEnd({
  endX,
  run,
  side,
  walls,
  widthGrowth,
}: {
  endX: number
  run: Pick<CabinetNode, 'depth' | 'position' | 'rotation'>
  side: 'left' | 'right'
  walls: readonly WallNode[]
  widthGrowth: number
}): RunWallEndConstraint {
  const worldPoint = runLocalToPlan(run, [endX, 0, 0])
  const point: readonly [number, number] = [worldPoint[0], worldPoint[2]]
  const runAxis: readonly [number, number] = [Math.cos(run.rotation), -Math.sin(run.rotation)]
  const maxDistance = Math.max(run.depth / 2 + 0.08, widthGrowth)
  const direction = side === 'left' ? -1 : 1
  let closestSlack = Number.POSITIVE_INFINITY

  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length <= 1e-6) continue
    const wallAxis: readonly [number, number] = [dx / length, dz / length]
    const axisDot = runAxis[0] * wallAxis[0] + runAxis[1] * wallAxis[1]
    if (Math.abs(axisDot) > 0.2) continue
    const closest = closestPointOnSegment(point, wall.start, wall.end)
    const offsetX = (closest[0] - point[0]) * runAxis[0] + (closest[1] - point[1]) * runAxis[1]
    const halfThickness = ((wall.thickness ?? 0.2) / 2) * Math.sqrt(1 - axisDot * axisDot)
    const distance = Math.hypot(point[0] - closest[0], point[1] - closest[1])
    if (distance > maxDistance + (wall.thickness ?? 0.2) / 2 + RUN_ADJACENCY_EPSILON) continue
    if (direction * offsetX < -halfThickness - RUN_ADJACENCY_EPSILON) continue
    const slack = Math.max(0, direction * offsetX - halfThickness)
    closestSlack = Math.min(closestSlack, slack)
  }

  return Number.isFinite(closestSlack) ? { constrained: true, slack: closestSlack } : OPEN_RUN_END
}

export function runWallConstraints(
  run: Pick<CabinetNode, 'depth' | 'parentId' | 'position' | 'rotation' | 'width'>,
  modules: readonly ModuleLike[],
  nodes: Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
  options: RunWallConstraintOptions = {},
): RunWallConstraints {
  const levelId = levelIdForRun(run, nodes)
  if (!levelId) return { left: OPEN_RUN_END, right: OPEN_RUN_END }
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node?.type === 'wall' &&
      resolveLevelId(node, nodes as Record<AnyNodeId, AnyNode>) === levelId,
  )
  if (walls.length === 0) return { left: OPEN_RUN_END, right: OPEN_RUN_END }
  const minX = modules.length > 0 ? runMinX(modules) : -run.width / 2
  const maxX = modules.length > 0 ? runMaxX(modules) : run.width / 2
  const levelRun = runInLevelFrame(run, nodes)
  const widthGrowth = Math.max(0, options.widthGrowth ?? 0)
  return {
    left: wallConstraintAtRunEnd({ endX: minX, run: levelRun, side: 'left', walls, widthGrowth }),
    right: wallConstraintAtRunEnd({
      endX: maxX,
      run: levelRun,
      side: 'right',
      walls,
      widthGrowth,
    }),
  }
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
 * Re-pack the run after one module's width changes. A single constrained end
 * may consume its wall gap. When both ends are constrained, the run extent is
 * fixed and eligible donors absorb the growth, nearest first. Manual edge
 * resize may consume an open inter-module gap before shifting its neighbor.
 * The change is rejected only when their combined capacity is insufficient.
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
  const gaps = sorted.map((module, index) => {
    const next = sorted[index + 1]
    if (!next) return 0
    return Math.max(0, moduleMinX(next) - moduleMaxX(module))
  })
  const wallConstraints = options.wallConstraints
  const leftConstrained = wallConstraints?.left.constrained ?? false
  const rightConstrained = wallConstraints?.right.constrained ?? false
  const preserveExtent = leftConstrained && rightConstrained
  const widthGrowth = selectedWidth - selected.width
  let remainingGrowth = Math.max(0, widthGrowth)
  const resizeSide = options.resizeSide
  const layoutGaps = [...gaps]
  let consumedAdjacentGap = 0
  if (options.consumeAdjacentGap && widthGrowth > REFLOW_CAPACITY_EPSILON && resizeSide) {
    const adjacentGapIndex = resizeSide === 'right' ? selectedIndex : selectedIndex - 1
    if (adjacentGapIndex >= 0 && adjacentGapIndex < layoutGaps.length) {
      const adjacentGap = layoutGaps[adjacentGapIndex] ?? 0
      consumedAdjacentGap = Math.min(widthGrowth, adjacentGap)
      layoutGaps[adjacentGapIndex] = adjacentGap - consumedAdjacentGap
    }
  }
  remainingGrowth -= consumedAdjacentGap
  const consumedRightSlack =
    rightConstrained && (!preserveExtent || resizeSide === 'right')
      ? Math.min(remainingGrowth, Math.max(0, wallConstraints?.right.slack ?? 0))
      : 0
  remainingGrowth -= consumedRightSlack
  const consumedLeftSlack =
    leftConstrained && (!preserveExtent || resizeSide === 'left')
      ? Math.min(remainingGrowth, Math.max(0, wallConstraints?.left.slack ?? 0))
      : 0
  remainingGrowth -= consumedLeftSlack

  if (preserveExtent && remainingGrowth > REFLOW_CAPACITY_EPSILON) {
    const defaultMinimumWidth = options.minimumWidth ?? 0.3
    const minimumWidth = (module: T) =>
      options.minimumWidthById?.get(module.id) ?? defaultMinimumWidth
    const donors = sorted
      .map((module, index) => ({ index, module }))
      .filter(
        ({ module }) =>
          module.id !== selectedId &&
          (!options.eligibleDonorIds || options.eligibleDonorIds.has(module.id)) &&
          module.width - minimumWidth(module) > REFLOW_CAPACITY_EPSILON,
      )
      .sort((a, b) => {
        const distance = Math.abs(a.index - selectedIndex) - Math.abs(b.index - selectedIndex)
        if (distance !== 0) return distance
        const capacity =
          Math.max(0, b.module.width - Math.max(defaultMinimumWidth, minimumWidth(b.module))) -
          Math.max(0, a.module.width - Math.max(defaultMinimumWidth, minimumWidth(a.module)))
        if (capacity !== 0) return capacity
        return b.index - a.index
      })
    const available = donors.reduce(
      (total, { module }) => total + Math.max(0, module.width - minimumWidth(module)),
      0,
    )
    if (available + REFLOW_CAPACITY_EPSILON < remainingGrowth) return []

    for (const useTrimCapacity of [false, true]) {
      for (const { module } of donors) {
        if (remainingGrowth <= REFLOW_CAPACITY_EPSILON) break
        const currentWidth = widths.get(module.id) ?? module.width
        const floor = useTrimCapacity
          ? minimumWidth(module)
          : Math.max(defaultMinimumWidth, minimumWidth(module))
        const donation = Math.min(Math.max(0, currentWidth - floor), remainingGrowth)
        widths.set(module.id, Math.max(floor, currentWidth - donation))
        remainingGrowth -= donation
      }
    }
  }

  let remainingFreedWidth = selected.width - selectedWidth
  if (remainingFreedWidth > REFLOW_CAPACITY_EPSILON) {
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
      if (remainingFreedWidth <= REFLOW_CAPACITY_EPSILON) break
      const available = Math.max(0, options.restorableWidthById?.get(module.id) ?? 0)
      const restoration = Math.min(available, remainingFreedWidth)
      widths.set(module.id, module.width + restoration)
      remainingFreedWidth -= restoration
    }

    if (preserveExtent && remainingFreedWidth > REFLOW_CAPACITY_EPSILON) {
      const maximumWidth = options.maximumWidth ?? 1.2
      const fallbackCandidates = sorted
        .map((module, index) => ({ index, module }))
        .filter(
          ({ module }) =>
            module.id !== selectedId &&
            (!options.eligibleDonorIds || options.eligibleDonorIds.has(module.id)),
        )
        .sort((a, b) => {
          const distance = Math.abs(a.index - selectedIndex) - Math.abs(b.index - selectedIndex)
          if (distance !== 0) return distance
          return b.index - a.index
        })
      const available = fallbackCandidates.reduce((total, { module }) => {
        const currentWidth = widths.get(module.id) ?? module.width
        const moduleMaximum = options.maximumWidthById?.get(module.id) ?? maximumWidth
        return total + Math.max(0, moduleMaximum - currentWidth)
      }, 0)
      if (available + REFLOW_CAPACITY_EPSILON < remainingFreedWidth) return []

      const absorbFreedWidth = (
        receivers: typeof fallbackCandidates,
        maximumFor: (module: T) => number,
      ) => {
        for (const { module } of receivers) {
          if (remainingFreedWidth <= REFLOW_CAPACITY_EPSILON) break
          const currentWidth = widths.get(module.id) ?? module.width
          const restoration = Math.min(
            Math.max(0, maximumFor(module) - currentWidth),
            remainingFreedWidth,
          )
          widths.set(module.id, currentWidth + restoration)
          remainingFreedWidth -= restoration
        }
      }
      absorbFreedWidth(
        fallbackCandidates,
        (module) => options.nominalWidthById?.get(module.id) ?? module.width,
      )
      absorbFreedWidth(
        fallbackCandidates,
        (module) => options.maximumWidthById?.get(module.id) ?? maximumWidth,
      )
    }
  }

  const totalWidth = sorted.reduce(
    (total, module, index) => total + (widths.get(module.id) ?? 0) + (layoutGaps[index] ?? 0),
    0,
  )
  let nextLeft = runMinX(sorted) - consumedLeftSlack
  const preserveRightEdge = options.resizeSide === 'left'
  const preserveLeftEdge = options.resizeSide === 'right'
  if (rightConstrained && !leftConstrained) {
    nextLeft = runMaxX(sorted) + consumedRightSlack - totalWidth
  } else if (leftConstrained && !rightConstrained) {
    nextLeft = runMinX(sorted) - consumedLeftSlack
  } else if (preserveExtent && resizeSide === 'right') {
    nextLeft = runMinX(sorted) - consumedLeftSlack
  } else if (preserveExtent && resizeSide === 'left') {
    nextLeft = runMaxX(sorted) + consumedRightSlack - totalWidth
  } else if (preserveRightEdge) {
    nextLeft = runMaxX(sorted) - totalWidth
  } else if (preserveLeftEdge || (!leftConstrained && !rightConstrained && selectedIndex === 0)) {
    nextLeft = preserveLeftEdge ? runMinX(sorted) - consumedLeftSlack : runMaxX(sorted) - totalWidth
  }
  return sorted.map((module, index) => {
    const width = widths.get(module.id) ?? module.width
    const position: T['position'] = [
      nextLeft + width / 2,
      module.position[1],
      module.position[2],
    ] as T['position']
    nextLeft += width + (layoutGaps[index] ?? 0)
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
