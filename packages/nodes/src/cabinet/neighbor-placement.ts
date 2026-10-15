import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import {
  moduleMaxX,
  moduleMinX,
  planRunModuleInsertion,
  planToRunLocal,
  runWallConstraints,
  sortRunModules,
} from './run-layout'
import { cabinetModulesForRun, cornerPinnedEndsForRun } from './run-ops'

/** Attach at a run's exposed ends; interior insertion keeps its existing wall planner. */
export function resolveCabinetNeighborPlacement({
  nodes,
  levelId,
  position,
  module,
  wallTier,
  threshold = 0.25,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  levelId: string
  position: [number, number, number]
  module: CabinetModuleNode
  wallTier: boolean
  threshold?: number
}) {
  let best: {
    distance: number
    run: CabinetNode
    neighbor: CabinetModuleNode
    side: 'left' | 'right'
    x: number
  } | null = null
  for (const candidate of Object.values(nodes)) {
    if (
      candidate.type !== 'cabinet' ||
      candidate.parentId !== levelId ||
      candidate.visible === false ||
      (candidate.runTier === 'wall') !== wallTier
    )
      continue
    const modules = sortRunModules(cabinetModulesForRun(candidate, nodes))
    if (!modules.length) continue
    const local = planToRunLocal(candidate, position[0], position[1], position[2])
    const pinned = cornerPinnedEndsForRun(modules)
    for (const side of ['left', 'right'] as const) {
      if (pinned[side]) continue
      const neighbor = side === 'left' ? modules[0]! : modules[modules.length - 1]!
      if (neighbor.moduleKind !== 'standard') continue
      const x =
        side === 'left'
          ? moduleMinX(neighbor) - module.width / 2
          : moduleMaxX(neighbor) + module.width / 2
      const distance = Math.hypot(local[0] - x, local[2] - neighbor.position[2])
      if (distance <= threshold && (!best || distance < best.distance))
        best = { distance, run: candidate, neighbor, side, x }
    }
  }
  if (!best) return null
  const { run, neighbor, side, x } = best
  const modules = cabinetModulesForRun(run, nodes)
  const result = planRunModuleInsertion({
    modules,
    insertion: {
      id: module.id,
      width: module.width,
      position: [x, neighbor.position[1], neighbor.position[2]],
    },
    wallConstraints: runWallConstraints(run, modules, nodes, { widthGrowth: module.width }),
    fillerIds: new Set(
      modules.filter((entry) => entry.moduleKind === 'corner-filler').map((entry) => entry.id),
    ),
    preserveEnds: cornerPinnedEndsForRun(modules),
    anchorInsertionSide: side === 'left' ? 'right' : 'left',
  })
  return { run, side, depth: neighbor.depth, result }
}
