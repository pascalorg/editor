import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { runWallConstraints } from '../run-layout'
import { addCornerRun } from '../run-ops'
import { reflowRunModules } from '../run-panel'
import { CabinetModuleNode, CabinetNode } from '../schema'

function worldPosition(
  node: ReturnType<typeof CabinetNode.parse> | ReturnType<typeof CabinetModuleNode.parse>,
  nodes: Record<AnyNodeId, AnyNode>,
): [number, number, number] {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (parent?.type !== 'cabinet' && parent?.type !== 'cabinet-module') {
    return [...node.position]
  }

  const parentPosition = worldPosition(parent, nodes)
  const parentRotation = parent.rotation
  const cos = Math.cos(parentRotation)
  const sin = Math.sin(parentRotation)
  return [
    parentPosition[0] + node.position[0] * cos + node.position[2] * sin,
    parentPosition[1] + node.position[1],
    parentPosition[2] - node.position[0] * sin + node.position[2] * cos,
  ]
}

function seedScene(nodes: AnyNode[], levelId: AnyNodeId) {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [levelId],
  } as never)
}

function wallConstraintFlags(constraints: ReturnType<typeof runWallConstraints>) {
  return {
    left: constraints.left.constrained,
    right: constraints.right.constrained,
  }
}

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})

afterEach(() => {
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
})

describe('cabinet preset run reflow', () => {
  test.each([
    { cornerSide: 'left', openDirection: -1, wallX: 0.5 },
    { cornerSide: 'right', openDirection: 1, wallX: -0.5 },
  ] as const)('moves a linked $cornerSide L layout toward its unconstrained side', ({
    cornerSide,
    openDirection,
    wallX,
  }) => {
    const level = LevelNode.parse({ id: `level_reflow-l-${cornerSide}` })
    const run = CabinetNode.parse({
      id: `cabinet_reflow-l-${cornerSide}`,
      parentId: level.id,
      children: [
        `cabinet-module_reflow-l-${cornerSide}-left`,
        `cabinet-module_reflow-l-${cornerSide}-right`,
      ],
    })
    const sourceIsLeft = cornerSide === 'left'
    const left = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-${cornerSide}-left`,
      parentId: run.id,
      position: sourceIsLeft ? [-0.4, 0.1, 0] : [-0.25, 0.1, 0],
      width: sourceIsLeft ? 0.8 : 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-${cornerSide}-right`,
      parentId: run.id,
      position: sourceIsLeft ? [0.25, 0.1, 0] : [0.4, 0.1, 0],
      width: sourceIsLeft ? 0.5 : 0.8,
    })
    const source = sourceIsLeft ? left : right
    const selected = sourceIsLeft ? right : left
    const wall = WallNode.parse({
      id: `wall_reflow-l-${cornerSide}`,
      parentId: level.id,
      start: [wallX, -1],
      end: [wallX, 1],
    })
    seedScene([level, run, left, right, wall] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: cornerSide })).toBeTruthy()

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const liveSelected = nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const before = worldPosition(derivedBaseRun, nodesBefore)
    const sourceXBefore = (nodesBefore[source.id] as ReturnType<typeof CabinetModuleNode.parse>)
      .position[0]
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)

    expect(wallConstraintFlags(constraints)).toEqual(
      cornerSide === 'left' ? { left: false, right: true } : { left: true, right: false },
    )
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected: liveSelected,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const after = worldPosition(
      nodesAfter[derivedBaseRun.id] as ReturnType<typeof CabinetNode.parse>,
      nodesAfter,
    )
    const sourceAfter = nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    expect(sourceAfter.position[0] - sourceXBefore).toBeCloseTo(openDirection * 0.26)
    expect((sourceAfter.metadata as Record<string, unknown>).cabinetCornerSourceLink).toBeDefined()
    expect(after[0] - before[0]).toBeCloseTo(openDirection * 0.26)
    expect(after[2]).toBeCloseTo(before[2])
    expect(sourceAfter.width).toBeCloseTo(0.8)
  })

  test.each([
    { cornerSide: 'left', openDirection: -1, turnSide: 'left', wallX: 0.8 },
    { cornerSide: 'left', openDirection: -1, turnSide: 'right', wallX: 0.8 },
    { cornerSide: 'right', openDirection: 1, turnSide: 'left', wallX: -0.8 },
    { cornerSide: 'right', openDirection: 1, turnSide: 'right', wallX: -0.8 },
  ] as const)('moves a linked $cornerSide L layout turning $turnSide when its source grows', ({
    cornerSide,
    openDirection,
    turnSide,
    wallX,
  }) => {
    const level = LevelNode.parse({ id: `level_reflow-l-source-${cornerSide}-${turnSide}` })
    const run = CabinetNode.parse({
      id: `cabinet_reflow-l-source-${cornerSide}-${turnSide}`,
      parentId: level.id,
      children: [
        `cabinet-module_reflow-l-source-${cornerSide}-${turnSide}-left`,
        `cabinet-module_reflow-l-source-${cornerSide}-${turnSide}-right`,
      ],
    })
    const sourceIsLeft = cornerSide === 'left'
    const left = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-source-${cornerSide}-${turnSide}-left`,
      parentId: run.id,
      position: sourceIsLeft ? [-0.25, 0.1, 0] : [-0.4, 0.1, 0],
      width: sourceIsLeft ? 0.5 : 0.8,
    })
    const right = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-source-${cornerSide}-${turnSide}-right`,
      parentId: run.id,
      position: sourceIsLeft ? [0.4, 0.1, 0] : [0.25, 0.1, 0],
      width: sourceIsLeft ? 0.8 : 0.5,
    })
    const source = sourceIsLeft ? left : right
    const wall = WallNode.parse({
      id: `wall_reflow-l-source-${cornerSide}-${turnSide}`,
      parentId: level.id,
      start: [wallX, -1],
      end: [wallX, 1],
    })
    seedScene([level, run, left, right, wall] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: turnSide })).toBeTruthy()

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const liveSource = nodesBefore[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const derivedPositionBefore = worldPosition(derivedBaseRun, nodesBefore)
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)

    expect(wallConstraintFlags(constraints)).toEqual(
      cornerSide === 'left' ? { left: false, right: true } : { left: true, right: false },
    )
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected: liveSource,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const derivedPositionAfter = worldPosition(
      nodesAfter[derivedBaseRun.id] as ReturnType<typeof CabinetNode.parse>,
      nodesAfter,
    )
    expect(derivedPositionAfter[0] - derivedPositionBefore[0]).toBeCloseTo(openDirection * 0.26)
    expect(derivedPositionAfter[2]).toBeCloseTo(derivedPositionBefore[2])
  })

  test.each([
    'left',
    'right',
  ] as const)('resizes the closest eligible cabinet in a constrained %s L layout', (cornerSide) => {
    const level = LevelNode.parse({ id: `level_reflow-l-constrained-${cornerSide}` })
    const run = CabinetNode.parse({
      id: `cabinet_reflow-l-constrained-${cornerSide}`,
      parentId: level.id,
      children: [
        `cabinet-module_reflow-l-constrained-${cornerSide}-left`,
        `cabinet-module_reflow-l-constrained-${cornerSide}-right`,
      ],
    })
    const sourceIsLeft = cornerSide === 'left'
    const left = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-constrained-${cornerSide}-left`,
      parentId: run.id,
      position: sourceIsLeft ? [-0.4, 0.1, 0] : [-0.25, 0.1, 0],
      width: sourceIsLeft ? 0.8 : 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-constrained-${cornerSide}-right`,
      parentId: run.id,
      position: sourceIsLeft ? [0.25, 0.1, 0] : [0.4, 0.1, 0],
      width: sourceIsLeft ? 0.5 : 0.8,
    })
    const source = sourceIsLeft ? left : right
    const selected = sourceIsLeft ? right : left
    const outerEdges = sourceIsLeft ? [-0.8, 0.5] : [-0.5, 0.8]
    const walls = outerEdges.map((x, index) =>
      WallNode.parse({
        id: `wall_reflow-l-constrained-${cornerSide}-${index}`,
        parentId: level.id,
        start: [x, -1],
        end: [x, 1],
      }),
    )
    seedScene([level, run, left, right] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: cornerSide })).toBeTruthy()
    for (const wall of walls) sceneApi.upsert(wall as AnyNode, level.id as AnyNodeId)

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const derivedPositionBefore = worldPosition(derivedBaseRun, nodesBefore)
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)

    expect(wallConstraintFlags(constraints)).toEqual({ left: true, right: true })
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected: nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const sourceAfter = nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedPositionAfter = worldPosition(
      nodesAfter[derivedBaseRun.id] as ReturnType<typeof CabinetNode.parse>,
      nodesAfter,
    )
    expect(sourceAfter.width).toBeCloseTo(0.54)
    expect(derivedPositionAfter[0]).toBeCloseTo(derivedPositionBefore[0])
    expect(derivedPositionAfter[2]).toBeCloseTo(derivedPositionBefore[2])
  })

  test.each([
    { cornerSide: 'left', outward: -1 },
    { cornerSide: 'right', outward: 1 },
  ] as const)('consumes wall slack before resizing a cabinet in a linked $cornerSide L layout', ({
    cornerSide,
    outward,
  }) => {
    const level = LevelNode.parse({ id: `level_reflow-l-slack-${cornerSide}` })
    const run = CabinetNode.parse({
      id: `cabinet_reflow-l-slack-${cornerSide}`,
      parentId: level.id,
      children: [
        `cabinet-module_reflow-l-slack-${cornerSide}-left`,
        `cabinet-module_reflow-l-slack-${cornerSide}-right`,
      ],
    })
    const sourceIsLeft = cornerSide === 'left'
    const left = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-slack-${cornerSide}-left`,
      parentId: run.id,
      position: sourceIsLeft ? [-0.4, 0.1, 0] : [-0.25, 0.1, 0],
      width: sourceIsLeft ? 0.8 : 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-slack-${cornerSide}-right`,
      parentId: run.id,
      position: sourceIsLeft ? [0.25, 0.1, 0] : [0.4, 0.1, 0],
      width: sourceIsLeft ? 0.5 : 0.8,
    })
    const source = sourceIsLeft ? left : right
    const selected = sourceIsLeft ? right : left
    const outerEdges = sourceIsLeft ? [-0.8, 0.5] : [-0.5, 0.8]
    const walls = outerEdges.map((edge, index) => {
      const side = index === 0 ? -1 : 1
      const x = edge + side * 0.23
      return WallNode.parse({
        id: `wall_reflow-l-slack-${cornerSide}-${index}`,
        parentId: level.id,
        start: [x, -1],
        end: [x, 1],
        thickness: 0.2,
      })
    })
    seedScene([level, run, left, right] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: cornerSide })).toBeTruthy()
    for (const wall of walls) sceneApi.upsert(wall as AnyNode, level.id as AnyNodeId)

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const liveSource = nodesBefore[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    const liveSelected = nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const sourceXBefore = liveSource.position[0]
    const derivedPositionBefore = worldPosition(derivedBaseRun, nodesBefore)
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)

    expect(constraints.left.slack).toBeCloseTo(0.13)
    expect(constraints.right.slack).toBeCloseTo(0.13)
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected: liveSelected,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const sourceAfter = nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedPositionAfter = worldPosition(
      nodesAfter[derivedBaseRun.id] as ReturnType<typeof CabinetNode.parse>,
      nodesAfter,
    )
    expect(sourceAfter.width).toBeCloseTo(0.8)
    expect({
      derivedX: derivedPositionAfter[0] - derivedPositionBefore[0],
      derivedZ: derivedPositionAfter[2] - derivedPositionBefore[2],
      sourceX: sourceAfter.position[0] - sourceXBefore,
    }).toEqual({
      derivedX: expect.closeTo(outward * 0.13),
      derivedZ: expect.closeTo(0),
      sourceX: expect.closeTo(outward * 0.13),
    })
  })

  test('resizes the closest eligible cabinet when both run ends are constrained', () => {
    const level = LevelNode.parse({ id: 'level_reflow-constrained' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-constrained',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-constrained-left',
        'cabinet-module_reflow-constrained-selected',
        'cabinet-module_reflow-constrained-right',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-constrained-left',
      parentId: run.id,
      position: [-0.9, 0.1, 0],
      width: 0.8,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-constrained-selected',
      parentId: run.id,
      position: [-0.25, 0.1, 0],
      width: 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-constrained-right',
      parentId: run.id,
      position: [0.5, 0.1, 0],
      width: 1,
    })
    const walls = [-1.3, 1].map((x, index) =>
      WallNode.parse({
        id: `wall_reflow-constrained-${index}`,
        parentId: level.id,
        start: [x, -1],
        end: [x, 1],
      }),
    )
    seedScene([level, run, left, selected, right, ...walls] as AnyNode[], level.id as AnyNodeId)
    const constraints = runWallConstraints(run, [left, selected, right], useScene.getState().nodes)

    expect(wallConstraintFlags(constraints)).toEqual({ left: true, right: true })
    expect(
      reflowRunModules({
        modules: [left, selected, right],
        parentRun: run,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected,
      }),
    ).toBe(true)

    const nodes = useScene.getState().nodes
    expect((nodes[right.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.74)
    expect((nodes[left.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.8)
    const liveModules = [left.id, selected.id, right.id].map(
      (id) => nodes[id] as ReturnType<typeof CabinetModuleNode.parse>,
    )
    expect(
      Math.min(...liveModules.map((module) => module.position[0] - module.width / 2)),
    ).toBeCloseTo(-1.3)
    expect(
      Math.max(...liveModules.map((module) => module.position[0] + module.width / 2)),
    ).toBeCloseTo(1)
  })

  test('skips an eligible cabinet without enough capacity for the fridge width', () => {
    const level = LevelNode.parse({ id: 'level_reflow-capable-donor' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-capable-donor',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-capable-donor-tall',
        'cabinet-module_reflow-capable-donor-selected',
        'cabinet-module_reflow-capable-donor-near',
        'cabinet-module_reflow-capable-donor-far',
      ],
    })
    const tall = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-capable-donor-tall',
      parentId: run.id,
      cabinetType: 'tall',
      position: [-0.9, 0.1, 0],
      width: 0.76,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-capable-donor-selected',
      parentId: run.id,
      position: [-0.27, 0.1, 0],
      width: 0.5,
    })
    const near = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-capable-donor-near',
      parentId: run.id,
      position: [0.23, 0.1, 0],
      width: 0.5,
    })
    const far = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-capable-donor-far',
      parentId: run.id,
      position: [0.88, 0.1, 0],
      width: 0.8,
    })
    const walls = [-1.28, 1.28].map((x, index) =>
      WallNode.parse({
        id: `wall_reflow-capable-donor-${index}`,
        parentId: level.id,
        start: [x, -1],
        end: [x, 1],
      }),
    )
    seedScene([level, run, tall, selected, near, far, ...walls] as AnyNode[], level.id as AnyNodeId)
    expect(
      wallConstraintFlags(
        runWallConstraints(run, [tall, selected, near, far], useScene.getState().nodes),
      ),
    ).toEqual({ left: true, right: true })

    expect(
      reflowRunModules({
        modules: [tall, selected, near, far],
        parentRun: run,
        patch: { cabinetType: 'tall', width: 0.76 },
        scene: useScene.getState(),
        selected,
      }),
    ).toBe(true)

    const nodes = useScene.getState().nodes
    expect((nodes[near.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.5)
    expect((nodes[far.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.54)
  })
})
