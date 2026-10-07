import type { CabinetModuleNode } from '@pascal-app/core'
import type { SinkLayout } from './stack'

export const BASIN_WALL = 0.012
const BASIN_CORNER_MARGIN = 0.06
// Centers the faucet base in the strip between the bowl's back edge and the
// countertop's back edge (BASIN_CORNER_MARGIN wide).
export const FAUCET_SETBACK = 0.03

export type SinkBowlSpec = { centerX: number; width: number; depth: number }

/**
 * Bowl rects in module-local X/Z given the usable countertop footprint.
 * Shared by the 3D cut, the run-countertop cut, and the 2D floorplan symbol.
 */
export function sinkBowls(
  layout: SinkLayout,
  usableWidth: number,
  usableDepth: number,
): SinkBowlSpec[] {
  const depth = Math.max(0.1, usableDepth - BASIN_CORNER_MARGIN * 2)
  const full = Math.max(0.15, usableWidth - BASIN_CORNER_MARGIN * 2)
  if (layout === 'single') {
    const width = Math.min(0.7, full)
    return [{ centerX: 0, width, depth }]
  }
  const divider = 0.03
  if (layout === 'double') {
    const width = Math.min(0.42, (full - divider) / 2)
    return [
      { centerX: -(width + divider) / 2, width, depth },
      { centerX: (width + divider) / 2, width, depth },
    ]
  }
  // double-offset: 60/40 split
  const total = Math.min(0.86, full)
  const main = (total - divider) * 0.6
  const side = (total - divider) * 0.4
  return [
    { centerX: -(total / 2) + main / 2, width: main, depth },
    { centerX: total / 2 - side / 2, width: side, depth },
  ]
}

export function sinkOpening(bowl: SinkBowlSpec): SinkBowlSpec {
  return { ...bowl, width: bowl.width - BASIN_WALL, depth: bowl.depth - BASIN_WALL }
}

export function cooktopFootprint(node: Pick<CabinetModuleNode, 'width' | 'depth'>) {
  return {
    width: Math.max(0.32, Math.min(node.width - 0.01, 0.76)),
    depth: Math.max(0.28, Math.min(node.depth - 0.04, 0.53)),
  }
}

export const FAUCET_BASE_RADIUS = 0.032

export function sinkFaucetFootprint(bowls: readonly SinkBowlSpec[]) {
  const minX = Math.min(...bowls.map((bowl) => bowl.centerX - bowl.width / 2))
  const maxX = Math.max(...bowls.map((bowl) => bowl.centerX + bowl.width / 2))
  return {
    x: (minX + maxX) / 2,
    z: -bowls[0]!.depth / 2 - FAUCET_SETBACK,
    radius: FAUCET_BASE_RADIUS,
  }
}
