import type { CabinetModuleNode, CabinetNode } from '../../schema/nodes/cabinet'

export const RUN_ADJACENCY_EPSILON = 1e-4

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

type SpanModule = Pick<
  CabinetModuleNode,
  'position' | 'width' | 'depth' | 'carcassHeight' | 'cabinetType'
>

/**
 * Contiguous same-height module groups along the run — the units the
 * countertop, plinth, and appliance-gap logic operate on. A gap, a
 * base↔tall transition, a top-height change, or a depth-footprint change
 * starts a new span.
 */
export function getRunSpans(
  modules: readonly SpanModule[],
  opts: { runTier?: CabinetNode['runTier'] } = {},
): RunSpan[] {
  return getRunSpanGroups(modules, opts).map((group) => group.span)
}

export function getRunSpanGroups<T extends SpanModule>(
  modules: readonly T[],
  opts: {
    runTier?: CabinetNode['runTier']
  } = {},
): Array<{ span: RunSpan; modules: T[] }> {
  const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
  const groups: Array<{ span: RunSpan; modules: T[] }> = []
  const runTier = opts.runTier ?? 'base'

  for (const module of sorted) {
    const minX = module.position[0] - module.width / 2
    const maxX = module.position[0] + module.width / 2
    const minZ = module.position[2] - module.depth / 2
    const maxZ = module.position[2] + module.depth / 2
    const topY = module.position[1] + module.carcassHeight
    const hasCountertop = runTier === 'base' && (module.cabinetType ?? 'base') !== 'tall'
    const group = groups.at(-1)
    const current = group?.span
    if (
      !current ||
      minX - current.maxX > RUN_ADJACENCY_EPSILON ||
      current.hasCountertop !== hasCountertop ||
      Math.abs(current.topY - topY) > RUN_ADJACENCY_EPSILON ||
      Math.abs(current.minZ - minZ) > RUN_ADJACENCY_EPSILON ||
      Math.abs(current.maxZ - maxZ) > RUN_ADJACENCY_EPSILON
    ) {
      groups.push({
        modules: [module],
        span: {
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
        },
      })
      continue
    }

    group!.modules.push(module)
    current.maxX = Math.max(current.maxX, maxX)
    current.minZ = Math.min(current.minZ, minZ)
    current.maxZ = Math.max(current.maxZ, maxZ)
    current.width = Math.max(0.01, current.maxX - current.minX)
    current.centerX = (current.minX + current.maxX) / 2
    current.depth = Math.max(0.01, current.maxZ - current.minZ)
    current.centerZ = (current.minZ + current.maxZ) / 2
    current.topY = Math.max(current.topY, topY)
  }

  return groups
}
