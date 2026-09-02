import type { AnyNode, AnyNodeId, CabinetModuleNode, CabinetNode, SceneApi } from '@pascal-app/core'

export function cabinetModuleForRunInsertion(
  module: CabinetModuleNode,
  run: CabinetNode,
): CabinetModuleNode {
  return {
    ...module,
    parentId: run.id,
    plinthHeight: run.plinthHeight,
    showPlinth: false,
    countertopThickness: 0,
    countertopOverhang: run.countertopOverhang,
    countertopBackOverhang: run.countertopBackOverhang,
    withCountertop: false,
  }
}

export function applyCabinetModuleInsertion({
  module,
  plan,
  run,
  sceneApi,
}: {
  module: CabinetModuleNode
  plan: {
    modules: ReadonlyArray<{
      id: AnyNodeId
      position: [number, number, number]
      width: number
    }>
    inserted: {
      position: [number, number, number]
      width: number
    }
  }
  run: CabinetNode
  sceneApi: SceneApi
}): AnyNodeId | null {
  const liveRun = sceneApi.get<CabinetNode>(run.id as AnyNodeId)
  if (!liveRun) return null

  const plannedIds = new Set(plan.modules.map((entry) => entry.id as AnyNodeId))
  for (const planned of plan.modules) {
    const current = sceneApi.get<CabinetModuleNode>(planned.id as AnyNodeId)
    if (!current || current.parentId !== liveRun.id) return null
    sceneApi.update(current.id as AnyNodeId, {
      position: planned.position,
      width: planned.width,
    })
  }

  const inserted = {
    ...cabinetModuleForRunInsertion(module, liveRun),
    position: plan.inserted.position,
    width: plan.inserted.width,
  }
  sceneApi.upsert(inserted as CabinetModuleNode as AnyNode, liveRun.id as AnyNodeId)

  const orderedModules = [
    ...plan.modules.map((entry) => ({ id: entry.id as AnyNodeId, x: entry.position[0] })),
    { id: inserted.id as AnyNodeId, x: inserted.position[0] },
  ].sort((left, right) => left.x - right.x)
  const otherChildren = (liveRun.children ?? []).filter(
    (id) => !plannedIds.has(id as AnyNodeId) && id !== inserted.id,
  )
  const allModules = [
    ...plan.modules.map((entry) => ({ width: entry.width, x: entry.position[0] })),
    { width: inserted.width, x: inserted.position[0] },
  ]
  const minX = Math.min(...allModules.map(({ x, width }) => x - width / 2))
  const maxX = Math.max(...allModules.map(({ x, width }) => x + width / 2))
  sceneApi.update(liveRun.id as AnyNodeId, {
    children: [...otherChildren, ...orderedModules.map(({ id }) => id)],
    width: maxX - minX,
  })
  return inserted.id as AnyNodeId
}
