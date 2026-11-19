import type { CabinetModuleNode, CabinetNode } from '../../schema/nodes/cabinet'

type ModuleExtent = Pick<CabinetModuleNode, 'position' | 'width'>
export type RunLike = Pick<CabinetNode, 'position' | 'rotation'>

export function moduleMinX(module: ModuleExtent): number {
  return module.position[0] - module.width / 2
}

export function moduleMaxX(module: ModuleExtent): number {
  return module.position[0] + module.width / 2
}

export function runMinX(modules: readonly ModuleExtent[]): number {
  return Math.min(...modules.map(moduleMinX))
}

export function runMaxX(modules: readonly ModuleExtent[]): number {
  return Math.max(...modules.map(moduleMaxX))
}

/** Full-run bounds in the run's local frame; an empty run has no extent. */
export function runLocalXExtent(modules: readonly ModuleExtent[]): {
  minX: number
  maxX: number
  centerX: number
  width: number
} | null {
  if (!modules.length) return null
  const minX = runMinX(modules)
  const maxX = runMaxX(modules)
  return { minX, maxX, centerX: (minX + maxX) / 2, width: Math.max(0.01, maxX - minX) }
}

/** Yaw and translate a local point into its parent's frame. */
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
