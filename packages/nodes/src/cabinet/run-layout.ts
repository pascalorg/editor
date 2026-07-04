import type { CabinetModuleNode, CabinetNode } from '@pascal-app/core'

/**
 * Straight-line run layout math — the single home for the "modules sit on the
 * run's local X axis" assumption. Ordering, edges, adjacency, spans, and
 * insert positions all live here so a future corner (L-shape) module changes
 * one file instead of five call sites.
 */

export const RUN_ADJACENCY_EPSILON = 1e-4

type ModuleLike = Pick<CabinetModuleNode, 'id' | 'position' | 'width'>

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
 * base↔tall transition, or a top-height change starts a new span.
 */
export function getRunSpans(
  modules: readonly Pick<
    CabinetModuleNode,
    'position' | 'width' | 'depth' | 'carcassHeight' | 'cabinetType'
  >[],
): RunSpan[] {
  const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
  const spans: RunSpan[] = []

  for (const module of sorted) {
    const minX = module.position[0] - module.width / 2
    const maxX = module.position[0] + module.width / 2
    const minZ = module.position[2] - module.depth / 2
    const maxZ = module.position[2] + module.depth / 2
    const topY = module.position[1] + module.carcassHeight
    const hasCountertop = (module.cabinetType ?? 'base') !== 'tall'
    const current = spans.at(-1)
    if (
      !current ||
      minX - current.maxX > RUN_ADJACENCY_EPSILON ||
      current.hasCountertop !== hasCountertop ||
      Math.abs(current.topY - topY) > RUN_ADJACENCY_EPSILON
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
): Array<{ id: T['id']; position: T['position']; width: number }> {
  const sorted = sortRunModules(modules)
  if (!sorted.some((module) => module.id === selectedId)) return []

  let nextLeft = runMinX(sorted)
  return sorted.map((module) => {
    const width = module.id === selectedId ? selectedWidth : module.width
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
