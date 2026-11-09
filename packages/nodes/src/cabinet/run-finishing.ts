import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode, SceneApi } from '@pascal-app/core'
import { applyCabinetModuleInsertion } from './insertion'
import { moduleMaxX, moduleMinX, runWallConstraints, sortRunModules } from './run-layout'
import {
  backAlignZ,
  cabinetModulesForRun,
  cornerPinnedEndsForRun,
  resolveCabinetType,
  runModuleBaseY,
  syncCornerRunsFromRunSources,
  wallChildOf,
} from './run-ops'
import { CabinetModuleNode as ModuleSchema } from './schema'
import { minCabinetCarcassHeightForStack } from './stack'

export function cabinetWallFillerPlan(
  run: CabinetNode,
  modules: readonly CabinetModuleNode[],
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const sorted = sortRunModules(modules)
  const constraints = runWallConstraints(run, modules, nodes)
  const pinned = cornerPinnedEndsForRun(modules)
  return (['left', 'right'] as const).flatMap((side) => {
    const edge = side === 'left' ? sorted[0] : sorted.at(-1)
    const wall = constraints[side]
    if (
      pinned[side] ||
      edge?.moduleKind !== 'standard' ||
      !wall.constrained ||
      wall.slack < 0.05 ||
      wall.slack > 0.15
    )
      return []
    return [{ side, width: wall.slack, edge }]
  })
}

export function fitCabinetWallFillers(run: CabinetNode, scene: SceneApi) {
  const nodes = scene.nodes()
  const modules = cabinetModulesForRun(run, nodes)
  const plan = cabinetWallFillerPlan(run, modules, nodes as Record<AnyNodeId, AnyNode>)
  for (const { side, width, edge } of plan) {
    const liveRun = scene.get<CabinetNode>(run.id)!
    const current = cabinetModulesForRun(liveRun, scene.nodes())
    const x = side === 'left' ? moduleMinX(edge) - width / 2 : moduleMaxX(edge) + width / 2
    const filler = ModuleSchema.parse({
      ...edge,
      id: undefined,
      children: [],
      name: 'Wall filler',
      moduleKind: 'wall-filler',
      width,
      stack: [],
      handleStyle: 'none',
      topFinish: 'none',
      metadata: {},
      position: [x, edge.position[1], edge.position[2]],
    })
    applyCabinetModuleInsertion({
      run: liveRun,
      sceneApi: scene,
      module: filler,
      plan: {
        modules: current.map((module) => ({
          id: module.id,
          position: module.position,
          width: module.width,
        })),
        inserted: { position: filler.position, width },
      },
    })
  }
  scene.markDirty(run.id)
}

export function alignCabinetRun(run: CabinetNode, scene: SceneApi) {
  const modules = cabinetModulesForRun(run, scene.nodes())
  const hasTall = modules.some((module) => resolveCabinetType(module, run) === 'tall')
  const baseHeight = hasTall
    ? Math.min(
        run.carcassHeight,
        ...modules
          .filter((module) => resolveCabinetType(module, run) !== 'tall')
          .map((module) => module.carcassHeight),
      )
    : run.carcassHeight
  const wallReference = modules
    .map((module) => ({ module, wall: wallChildOf(module, scene.nodes()) }))
    .find(({ wall }) => wall)
  const wallY = wallReference?.wall
    ? wallReference.module.position[1] + wallReference.wall.position[1]
    : null
  for (const module of modules) {
    if (module.moduleKind === 'corner-filler') continue
    // Preserve tall appliance envelopes and compartment contents.
    const height =
      resolveCabinetType(module, run) === 'tall'
        ? module.carcassHeight
        : Math.max(baseHeight, minCabinetCarcassHeightForStack(module))
    scene.update(module.id, {
      position: [module.position[0], runModuleBaseY(run), (module.depth - run.depth) / 2],
      carcassHeight: height,
      frontGap: run.frontGap,
      frontOverlay: run.frontOverlay,
      handleStyle: module.moduleKind === 'wall-filler' ? 'none' : run.handleStyle,
      handlePosition: run.handlePosition,
    })
    const wall = wallChildOf(module, scene.nodes())
    if (wall && wallY !== null)
      scene.update(wall.id, {
        position: [0, wallY - runModuleBaseY(run), backAlignZ(module.depth, wall.depth)],
        frontGap: run.frontGap,
        frontOverlay: run.frontOverlay,
        handleStyle: run.handleStyle,
        handlePosition: run.handlePosition,
      })
  }
  syncCornerRunsFromRunSources({ sceneApi: scene, run, previousModules: modules })
  scene.markDirty(run.id)
}
