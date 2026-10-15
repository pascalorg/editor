import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CabinetModuleNode,
  CabinetNode,
  createSceneApi,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  runAsSingleSceneHistoryStep,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { finishKitchenRun } from '../../agent-operations'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
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

test('filling both run ends undoes together and preserves original modules', () => {
  const previous = useScene.getState(),
    history = useScene.temporal.getState()
  const raf = globalThis.requestAnimationFrame,
    cancelRaf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const level = LevelNode.parse({})
  const run = CabinetNode.parse({ parentId: level.id, depth: 0.6 })
  const module = CabinetModuleNode.parse({ parentId: run.id, width: 0.6, depth: 0.6 })
  run.children = [module.id]
  const walls = [-0.5, 0.5].map((x) =>
    WallNode.parse({ parentId: level.id, start: [x, -1], end: [x, 1], thickness: 0.2 }),
  )
  const nodes = Object.fromEntries([level, run, module, ...walls].map((node) => [node.id, node]))
  try {
    useScene.setState({ nodes, rootNodeIds: [level.id] })
    useScene.temporal.getState().clear()
    const outcome = finishKitchenRun(
      nodes,
      { runId: run.id, action: 'fill' },
      { activeLevelId: null },
    )
    expect(nodes[run.id]!.children).toEqual([module.id])
    runAsSingleSceneHistoryStep(useScene, () =>
      useScene.getState().applyNodeChanges(outcome.changes as never),
    )
    const again = finishKitchenRun(
      useScene.getState().nodes,
      { runId: run.id, action: 'fill' },
      { activeLevelId: null },
    )
    expect(again.changes?.create).toEqual([])
    expect(again.changes?.update).toEqual([])
    expect(useScene.getState().nodes[run.id]!.children).toHaveLength(3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[run.id]!.children).toEqual([module.id])
    expect(useScene.getState().nodes[module.id]).toEqual(module)
  } finally {
    useScene.setState(previous)
    useScene.temporal.setState(history)
    globalThis.requestAnimationFrame = raf
    globalThis.cancelAnimationFrame = cancelRaf
  }
})

test('finishing refuses a missing run without changing the input', () => {
  const nodes = {}
  expect(() =>
    finishKitchenRun(nodes, { runId: 'cabinet_missing', action: 'align' }, { activeLevelId: null }),
  ).toThrow('Choose a kitchen run')
  expect(nodes).toEqual({})
})

for (const topologyChange of [false, true]) {
  test(`finishing ${topologyChange ? 'refuses a disappearing support' : 'carries a hosted item'} without mutating its input`, () => {
    const restore = nodeRegistry._snapshot()
    try {
      registerNode(cabinetDefinition)
      registerNode(cabinetModuleDefinition)
      const level = LevelNode.parse({})
      const run = CabinetNode.parse({
        parentId: level.id,
        carcassHeight: 0.72,
        withCountertop: true,
      })
      const modules = [0, 1].map((i) =>
        CabinetModuleNode.parse({
          parentId: run.id,
          width: 0.6,
          depth: 0.6,
          carcassHeight: topologyChange && i === 1 ? 0.9 : 0.8,
          showPlinth: false,
          position: [i * 0.6, 0.1, 0],
        }),
      )
      run.children = modules.map((node) => node.id)
      const nodes = Object.fromEntries([level, run, ...modules].map((node) => [node.id, node]))
      const surfaces = getSurfaceProvider(run).surfaces!(run, {
        scene: { nodes: () => nodes, get: (id) => nodes[id] as never },
      })
      const surface = surfaces.at(-1)!
      const item = ItemNode.parse({
        parentId: run.id,
        position: [topologyChange ? 0.6 : 0, surface.position[1], 0],
        asset: {
          id: 'cup',
          name: 'Cup',
          category: 'fixture',
          thumbnail: '',
          src: '/cup.glb',
          dimensions: [0.1, 0.1, 0.1],
        },
      })
      nodes[item.id] = item
      run.children.push(item.id)
      const before = JSON.stringify(nodes)
      // The operation must preserve support even before a browser loads definitions.
      nodeRegistry._reset()
      if (topologyChange)
        expect(() =>
          finishKitchenRun(nodes, { runId: run.id, action: 'align' }, { activeLevelId: null }),
        ).toThrow('keeping hosted items supported')
      else {
        const result = finishKitchenRun(
          nodes,
          { runId: run.id, action: 'align' },
          { activeLevelId: null },
        )
        const patch = result.changes?.update?.find((entry) => entry.id === item.id)?.data
        expect((patch as typeof item).position[1]).toBeCloseTo(item.position[1] - 0.08)
      }
      expect(JSON.stringify(nodes)).toBe(before)
    } finally {
      restore()
    }
  })
}
