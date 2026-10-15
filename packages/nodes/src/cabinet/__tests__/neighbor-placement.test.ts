import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  createSceneApi,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { applyCabinetModuleInsertion } from '../insertion'
import { resolveCabinetNeighborPlacement } from '../neighbor-placement'
import { runLocalToPlan } from '../run-layout'

function fixture(rotation = 0) {
  const run = CabinetNode.parse({
    parentId: 'level_test',
    position: [3, 0, 2],
    rotation,
    depth: 0.75,
  })
  const neighbor = CabinetModuleNode.parse({
    parentId: run.id,
    width: 0.6,
    depth: 0.75,
    position: [0, 0.1, 0],
  })
  run.children = [neighbor.id]
  const module = CabinetModuleNode.parse({ width: 0.8, depth: 0.6 })
  const nodes: Record<AnyNodeId, AnyNode> = { [run.id]: run, [neighbor.id]: neighbor }
  return { run, neighbor, module, nodes }
}

for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
  for (const side of ['left', 'right'] as const) {
    test(`joins ${side} at rotation ${rotation} with the neighbor depth`, () => {
      const { run, neighbor, module, nodes } = fixture(rotation)
      const x = side === 'left' ? -0.7 : 0.7
      const result = resolveCabinetNeighborPlacement({
        nodes,
        module,
        levelId: 'level_test',
        wallTier: false,
        position: runLocalToPlan(run, [x + 0.05, 0, 0.04]),
      })
      expect(result?.run.id).toBe(run.id)
      expect(result?.side).toBe(side)
      expect(result?.depth).toBe(0.75)
      expect(result?.result.ok).toBe(true)
      if (!result?.result.ok) throw new Error('Expected insertion')
      expect(result.result.inserted.position).toEqual([x, 0.1, 0])
      expect(result.result.modules[0]?.position).toEqual(neighbor.position)
      expect(run.children).toEqual([neighbor.id])
    })
  }
}

test('does not join distant, hidden, other-level, or incompatible-tier runs', () => {
  const { run, module, nodes } = fixture()
  const input = {
    nodes,
    module,
    levelId: 'level_test',
    wallTier: false,
    position: runLocalToPlan(run, [0.7, 0, 0]),
  }
  expect(resolveCabinetNeighborPlacement({ ...input, position: [20, 0, 20] })).toBeNull()
  expect(resolveCabinetNeighborPlacement({ ...input, levelId: 'level_other' })).toBeNull()
  expect(resolveCabinetNeighborPlacement({ ...input, wallTier: true })).toBeNull()
  run.visible = false
  expect(resolveCabinetNeighborPlacement(input)).toBeNull()
})

test('joining preserves the run and existing module and undoes as one step', () => {
  const previous = useScene.getState()
  const history = useScene.temporal.getState()
  const raf = globalThis.requestAnimationFrame
  const cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const { run, neighbor, module, nodes } = fixture(Math.PI / 4)
  try {
    useScene.setState({ nodes, rootNodeIds: [run.id] })
    useScene.temporal.getState().clear()
    const planned = resolveCabinetNeighborPlacement({
      nodes,
      module,
      levelId: 'level_test',
      wallTier: false,
      position: runLocalToPlan(run, [0.7, 0, 0]),
    })
    if (!planned?.result.ok) throw new Error('Expected join')
    runAsSingleSceneHistoryStep(useScene, () =>
      applyCabinetModuleInsertion({
        module: { ...module, depth: planned.depth },
        plan: planned.result as Extract<typeof planned.result, { ok: true }>,
        run,
        sceneApi: createSceneApi(useScene),
      }),
    )
    expect(useScene.getState().nodes[module.id]?.parentId).toBe(run.id)
    expect((useScene.getState().nodes[module.id] as typeof module).depth).toBe(0.75)
    expect(useScene.getState().nodes[run.id]?.children).toContain(module.id)
    expect(useScene.getState().nodes[neighbor.id]?.position).toEqual(neighbor.position)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[module.id]).toBeUndefined()
    expect(useScene.getState().nodes[run.id]?.children).toEqual([neighbor.id])
  } finally {
    useScene.setState(previous)
    useScene.temporal.setState(history)
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = cancelRaf
  }
})
