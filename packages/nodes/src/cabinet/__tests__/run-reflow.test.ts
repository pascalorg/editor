import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createSceneApi,
  LevelNode,
  SiteNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { cabinetPresetById } from '../presets'
import { runMaxX, runMinX, runWallConstraints } from '../run-layout'
import { addCornerRun } from '../run-ops'
import { reflowRunModules } from '../run-panel'
import { CabinetModuleNode, CabinetNode } from '../schema'

function worldTransform(
  node: ReturnType<typeof CabinetNode.parse> | ReturnType<typeof CabinetModuleNode.parse>,
  nodes: Record<AnyNodeId, AnyNode>,
): { position: [number, number, number]; rotation: number } {
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : null
  if (parent?.type !== 'cabinet' && parent?.type !== 'cabinet-module') {
    return { position: [...node.position], rotation: node.rotation }
  }

  const parentTransform = worldTransform(parent, nodes)
  const cos = Math.cos(parentTransform.rotation)
  const sin = Math.sin(parentTransform.rotation)
  return {
    position: [
      parentTransform.position[0] + node.position[0] * cos + node.position[2] * sin,
      parentTransform.position[1] + node.position[1],
      parentTransform.position[2] - node.position[0] * sin + node.position[2] * cos,
    ],
    rotation: parentTransform.rotation + node.rotation,
  }
}

function worldPosition(
  node: ReturnType<typeof CabinetNode.parse> | ReturnType<typeof CabinetModuleNode.parse>,
  nodes: Record<AnyNodeId, AnyNode>,
): [number, number, number] {
  return worldTransform(node, nodes).position
}

function moduleWorldBounds(
  modules: ReturnType<typeof CabinetModuleNode.parse>[],
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const points = modules.flatMap((module) => {
    const { position, rotation } = worldTransform(module, nodes)
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return [-1, 1].flatMap((xSign) =>
      [-1, 1].map((zSign) => {
        const x = (xSign * module.width) / 2
        const z = (zSign * module.depth) / 2
        return [position[0] + x * cos + z * sin, position[2] - x * sin + z * cos]
      }),
    )
  })

  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z)),
  }
}

function runModuleBounds(runId: AnyNodeId, nodes: Record<AnyNodeId, AnyNode>) {
  const run = nodes[runId]
  const modules =
    run?.type === 'cabinet'
      ? run.children
          .map((id) => nodes[id])
          .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
            Boolean(node?.type === 'cabinet-module'),
          )
      : []
  return moduleWorldBounds(modules, nodes)
}

function moduleSubtreeBounds(rootId: AnyNodeId, nodes: Record<AnyNodeId, AnyNode>) {
  const pending = [rootId]
  const modules: ReturnType<typeof CabinetModuleNode.parse>[] = []

  while (pending.length > 0) {
    const id = pending.pop()!
    const node = nodes[id]
    if (!node) continue
    if (node.type === 'cabinet-module') modules.push(node)
    if ('children' in node && Array.isArray(node.children)) {
      pending.push(...(node.children as AnyNodeId[]))
    }
  }

  return moduleWorldBounds(modules, nodes)
}

function derivedBaseRunForSource(
  sourceId: AnyNodeId,
  nodes: Record<AnyNodeId, AnyNode>,
): ReturnType<typeof CabinetNode.parse> {
  return Object.values(nodes).find((node): node is ReturnType<typeof CabinetNode.parse> => {
    if (node.type !== 'cabinet' || node.runTier !== 'base') return false
    const link = (node.metadata as Record<string, unknown> | null)?.cabinetCornerDerivedRun
    return (
      Boolean(link && typeof link === 'object' && !Array.isArray(link)) &&
      (link as { sourceModuleId?: unknown }).sourceModuleId === sourceId
    )
  })!
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
  test('reanchors an existing right L inside a newly recognized perpendicular wall', () => {
    const level = LevelNode.parse({ id: 'level_reflow-room-bound-right-l' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-room-bound-right-l',
      parentId: level.id,
      position: [1.75, 0, -4.65],
      children: [
        'cabinet-module_reflow-room-bound-right-l-left',
        'cabinet-module_reflow-room-bound-right-l-selected',
        'cabinet-module_reflow-room-bound-right-l-neighbor',
        'cabinet-module_reflow-room-bound-right-l-source',
      ],
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_reflow-room-bound-right-l-left',
        parentId: run.id,
        position: [-1.06, 0.1, 0],
        width: 0.5,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_reflow-room-bound-right-l-selected',
        parentId: run.id,
        position: [-0.56, 0.1, 0],
        width: 0.5,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_reflow-room-bound-right-l-neighbor',
        parentId: run.id,
        position: [0.07, 0.1, 0],
        width: 0.76,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_reflow-room-bound-right-l-source',
        parentId: run.id,
        position: [0.655, 0.1, 0],
        width: 0.41,
      }),
    ]
    const walls = [
      WallNode.parse({
        id: 'wall_reflow-room-bound-right-l-left',
        parentId: level.id,
        start: [0, -1],
        end: [0, -5],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_reflow-room-bound-right-l-back',
        parentId: level.id,
        start: [0, -5],
        end: [3, -5],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_reflow-room-bound-right-l-right',
        parentId: level.id,
        start: [3, -5],
        end: [3, -3.78],
        thickness: 0.2,
      }),
    ]
    seedScene([level, run, ...modules] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: modules[3]!, run, sceneApi, side: 'right' })).toBeTruthy()
    for (const wall of walls) sceneApi.upsert(wall as AnyNode, level.id as AnyNodeId)

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const derivedRun = derivedBaseRunForSource(modules[3]!.id, nodesBefore)
    const footprintBefore = runModuleBounds(derivedRun.id, nodesBefore)
    const rightWallInnerFace = 3 - walls[2]!.thickness / 2
    expect(wallConstraintFlags(runWallConstraints(liveRun, liveModules, nodesBefore))).toEqual({
      left: true,
      right: true,
    })
    expect(footprintBefore.maxX).toBeGreaterThan(rightWallInnerFace)
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
        scene: useScene.getState(),
        selected: nodesBefore[modules[1]!.id] as ReturnType<typeof CabinetModuleNode.parse>,
      }),
    ).toBe(true)

    const footprintAfter = runModuleBounds(derivedRun.id, useScene.getState().nodes)
    expect(footprintAfter.maxX).toBeLessThanOrEqual(rightWallInnerFace + 1e-4)
  })

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
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
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
    { cornerSide: 'left', turnSide: 'left' },
    { cornerSide: 'left', turnSide: 'right' },
    { cornerSide: 'right', turnSide: 'left' },
    { cornerSide: 'right', turnSide: 'right' },
  ] as const)('respects source-wall anchoring for a constrained $cornerSide-end/$turnSide-turn L', ({
    cornerSide,
    turnSide,
  }) => {
    const level = LevelNode.parse({ id: `level_reflow-l-constrained-${cornerSide}` })
    const room = SiteNode.parse({
      id: `site_reflow-l-constrained-${cornerSide}`,
      parentId: level.id,
    })
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
    const walls = outerEdges.map((edge, index) => {
      const x = edge + (index === 0 ? -0.1 : 0.1)
      return WallNode.parse({
        id: `wall_reflow-l-constrained-${cornerSide}-${index}`,
        parentId: room.id,
        start: [x, -1],
        end: [x, 1],
      })
    })
    seedScene([level, room, run, left, right] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: turnSide })).toBeTruthy()
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
    const footprintBefore = runModuleBounds(derivedBaseRun.id, nodesBefore)
    const derivedPositionBefore = worldPosition(derivedBaseRun, nodesBefore)
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)
    const extentBefore = { minX: runMinX(liveModules), maxX: runMaxX(liveModules) }

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
    const liveModulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const footprintAfter = runModuleBounds(derivedBaseRun.id, nodesAfter)
    const derivedPositionAfter = worldPosition(
      nodesAfter[derivedBaseRun.id] as ReturnType<typeof CabinetNode.parse>,
      nodesAfter,
    )
    expect(sourceAfter.width).toBeCloseTo(0.54)
    expect(
      (nodesAfter[selected.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.76)
    expect(runMinX(liveModulesAfter)).toBeCloseTo(extentBefore.minX)
    expect(runMaxX(liveModulesAfter)).toBeCloseTo(extentBefore.maxX)
    const sideWallInnerFace =
      cornerSide === 'left'
        ? walls[0]!.start[0] + (walls[0]!.thickness ?? 0.2) / 2
        : walls[1]!.start[0] - (walls[1]!.thickness ?? 0.2) / 2
    if (turnSide === cornerSide) {
      if (cornerSide === 'left') {
        expect(footprintBefore.minX).toBeLessThan(sideWallInnerFace)
        expect(footprintAfter.minX).toBeGreaterThanOrEqual(sideWallInnerFace - 1e-4)
      } else {
        expect(footprintBefore.maxX).toBeGreaterThan(sideWallInnerFace)
        expect(footprintAfter.maxX).toBeLessThanOrEqual(sideWallInnerFace + 1e-4)
      }
    } else {
      expect(derivedPositionAfter[0]).toBeCloseTo(derivedPositionBefore[0])
      expect(derivedPositionAfter[2]).toBeCloseTo(derivedPositionBefore[2])
    }
    expect(footprintAfter.minZ).toBeCloseTo(footprintBefore.minZ)
    expect(footprintAfter.maxZ).toBeCloseTo(footprintBefore.maxZ)
  })

  test.each([
    'left',
    'right',
  ] as const)('reanchors a two-wall %s L when its corner source donates', (cornerSide) => {
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
    const liveSelected = nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const footprintBefore = runModuleBounds(derivedBaseRun.id, nodesBefore)
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)
    const extentBefore = { minX: runMinX(liveModules), maxX: runMaxX(liveModules) }

    expect(constraints.left.slack).toBeCloseTo(0.13)
    expect(constraints.right.slack).toBeCloseTo(0.13)
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
        scene: useScene.getState(),
        selected: liveSelected,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const sourceAfter = nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>
    const liveModulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const footprintAfter = runModuleBounds(derivedBaseRun.id, nodesAfter)
    expect(sourceAfter.width).toBeCloseTo(0.54)
    expect(
      (nodesAfter[selected.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.76)
    expect(runMinX(liveModulesAfter)).toBeCloseTo(extentBefore.minX)
    expect(runMaxX(liveModulesAfter)).toBeCloseTo(extentBefore.maxX)
    const sideWall = cornerSide === 'left' ? walls[0]! : walls[1]!
    const sideWallInnerFace =
      sideWall.start[0] + ((cornerSide === 'left' ? 1 : -1) * (sideWall.thickness ?? 0.2)) / 2
    if (cornerSide === 'left') {
      expect(footprintBefore.minX).toBeLessThan(sideWallInnerFace)
      expect(footprintAfter.minX).toBeGreaterThanOrEqual(sideWallInnerFace - 1e-4)
    } else {
      expect(footprintBefore.maxX).toBeGreaterThan(sideWallInnerFace)
      expect(footprintAfter.maxX).toBeLessThanOrEqual(sideWallInnerFace + 1e-4)
    }
    expect(footprintAfter.minZ).toBeCloseTo(footprintBefore.minZ)
    expect(footprintAfter.maxZ).toBeCloseTo(footprintBefore.maxZ)
  })

  test('keeps the native L footprint fixed when its corner source wins donor selection', () => {
    const level = LevelNode.parse({ id: 'level_reflow-native-l' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-native-l',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-native-l-source',
        'cabinet-module_reflow-native-l-selected',
        'cabinet-module_reflow-native-l-donor',
      ],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-native-l-source',
      parentId: run.id,
      position: [-0.65, 0.1, 0],
      width: 0.8,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-native-l-selected',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.5,
    })
    const donor = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-native-l-donor',
      parentId: run.id,
      position: [0.55, 0.1, 0],
      width: 0.6,
    })
    seedScene([level, run, source, selected, donor] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: 'left' })).toBeTruthy()
    const nodesAfterCorner = useScene.getState().nodes
    const liveRunAfterCorner = nodesAfterCorner[run.id] as ReturnType<typeof CabinetNode.parse>
    const modulesAfterCorner = liveRunAfterCorner.children
      .map((id) => nodesAfterCorner[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const walls = [runMinX(modulesAfterCorner) - 0.1, runMaxX(modulesAfterCorner) + 0.1].map(
      (x, index) =>
        WallNode.parse({
          id: `wall_reflow-native-l-${index}`,
          parentId: level.id,
          start: [x, -1],
          end: [x, 1],
          thickness: 0.2,
        }),
    )
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
    const footprintBefore = moduleSubtreeBounds(derivedBaseRun.id, nodesBefore)
    const extentBefore = { minX: runMinX(liveModules), maxX: runMaxX(liveModules) }

    expect(wallConstraintFlags(runWallConstraints(liveRun, liveModules, nodesBefore))).toEqual({
      left: true,
      right: true,
    })
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
        scene: useScene.getState(),
        selected: nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const liveModulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const footprintAfter = moduleSubtreeBounds(derivedBaseRun.id, nodesAfter)

    expect((nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(
      0.54,
    )
    expect((nodesAfter[donor.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(
      0.6,
    )
    expect(runMinX(liveModulesAfter)).toBeCloseTo(extentBefore.minX)
    expect(runMaxX(liveModulesAfter)).toBeCloseTo(extentBefore.maxX)
    expect(footprintBefore.minX).toBeLessThan(extentBefore.minX)
    expect(footprintAfter.minX).toBeGreaterThanOrEqual(extentBefore.minX - 1e-4)
    expect(footprintAfter.minZ).toBeCloseTo(footprintBefore.minZ)
    expect(footprintAfter.maxZ).toBeCloseTo(footprintBefore.maxZ)
  })

  test('uses the original straight run constraints when editing the nested L leg', () => {
    const level = LevelNode.parse({ id: 'level_reflow-nested-l-leg' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-nested-l-leg',
      parentId: level.id,
      position: [2, 0, 3],
      rotation: Math.PI / 2,
      children: [
        'cabinet-module_reflow-nested-l-leg-source',
        'cabinet-module_reflow-nested-l-leg-neighbor',
      ],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-nested-l-leg-source',
      parentId: run.id,
      position: [-0.4, 0.1, 0],
      width: 0.8,
    })
    const neighbor = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-nested-l-leg-neighbor',
      parentId: run.id,
      position: [0.3, 0.1, 0],
      width: 0.6,
    })
    seedScene([level, run, source, neighbor] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: 'left' })).toBeTruthy()

    const nodesBeforeWalls = useScene.getState().nodes
    const liveRun = nodesBeforeWalls[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBeforeWalls[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const nestedRun = Object.values(nodesBeforeWalls).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.id !== run.id && node.runTier === 'base',
    )!
    const nestedModules = nestedRun.children
      .map((id) => nodesBeforeWalls[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const sourceTransform = worldTransform(liveRun, nodesBeforeWalls)
    const cos = Math.cos(sourceTransform.rotation)
    const sin = Math.sin(sourceTransform.rotation)
    const wallAxis: [number, number] = [sin, cos]
    const worldEnd = (localX: number): [number, number] => [
      sourceTransform.position[0] + localX * cos,
      sourceTransform.position[2] - localX * sin,
    ]
    const walls = [runMinX(liveModules), runMaxX(liveModules)].map((localX, index) => {
      const [x, z] = worldEnd(localX)
      return WallNode.parse({
        id: `wall_reflow-nested-l-leg-${index}`,
        parentId: level.id,
        start: [x - wallAxis[0], z - wallAxis[1]],
        end: [x + wallAxis[0], z + wallAxis[1]],
      })
    })
    for (const wall of walls) sceneApi.upsert(wall as AnyNode, level.id as AnyNodeId)

    const nodesBefore = useScene.getState().nodes
    const footprintBefore = moduleSubtreeBounds(nestedRun.id, nodesBefore)
    expect(wallConstraintFlags(runWallConstraints(liveRun, liveModules, nodesBefore))).toEqual({
      left: true,
      right: true,
    })
    expect(wallConstraintFlags(runWallConstraints(nestedRun, nestedModules, nodesBefore))).toEqual({
      left: false,
      right: false,
    })
    expect(
      reflowRunModules({
        modules: nestedModules,
        parentRun: nestedRun,
        patch: cabinetPresetById('fridge-single').createPatch(nestedRun),
        scene: useScene.getState(),
        selected: nestedModules.at(-1)!,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const footprintAfter = moduleSubtreeBounds(nestedRun.id, nodesAfter)
    expect(footprintAfter.minX).toBeCloseTo(footprintBefore.minX)
    expect(footprintAfter.maxX).toBeCloseTo(footprintBefore.maxX)
    expect(footprintAfter.minZ).toBeCloseTo(footprintBefore.minZ)
    expect(footprintAfter.maxZ).toBeCloseTo(footprintBefore.maxZ)
  })

  test.each([
    { endSide: 'left', turnSide: 'left' },
    { endSide: 'left', turnSide: 'right' },
    { endSide: 'right', turnSide: 'left' },
    { endSide: 'right', turnSide: 'right' },
  ] as const)('ignores derived-leg walls for an open $endSide-end/$turnSide-turn source run', ({
    endSide,
    turnSide,
  }) => {
    const suffix = `${endSide}-${turnSide}`
    const level = LevelNode.parse({ id: `level_reflow-l-leg-base-${suffix}` })
    const run = CabinetNode.parse({
      id: `cabinet_reflow-l-leg-base-${suffix}`,
      parentId: level.id,
      children:
        endSide === 'left'
          ? [
              `cabinet-module_reflow-l-leg-base-source-${suffix}`,
              `cabinet-module_reflow-l-leg-base-donor-${suffix}`,
            ]
          : [
              `cabinet-module_reflow-l-leg-base-donor-${suffix}`,
              `cabinet-module_reflow-l-leg-base-source-${suffix}`,
            ],
    })
    const source = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-leg-base-source-${suffix}`,
      parentId: run.id,
      position: [endSide === 'left' ? -0.4 : 0.4, 0.1, 0],
      width: 0.5,
    })
    const donor = CabinetModuleNode.parse({
      id: `cabinet-module_reflow-l-leg-base-donor-${suffix}`,
      parentId: run.id,
      position: [endSide === 'left' ? 0.25 : -0.25, 0.1, 0],
      width: 0.8,
    })
    seedScene([level, run, source, donor] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: turnSide })).toBeTruthy()

    const nodesBeforeWalls = useScene.getState().nodes
    const legRun = derivedBaseRunForSource(source.id, nodesBeforeWalls)
    const legModules = legRun.children
      .map((id) => nodesBeforeWalls[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const selected = legModules.find((module) => module.name === 'Base Cabinet')!
    const transform = worldTransform(legRun, nodesBeforeWalls)
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    const wallAxis: [number, number] = [sin, cos]
    for (const [index, localX] of [runMinX(legModules), runMaxX(legModules)].entries()) {
      const x = transform.position[0] + localX * cos
      const z = transform.position[2] - localX * sin
      sceneApi.upsert(
        WallNode.parse({
          id: `wall_reflow-l-leg-base-${suffix}-${index}`,
          parentId: level.id,
          start: [x - wallAxis[0], z - wallAxis[1]],
          end: [x + wallAxis[0], z + wallAxis[1]],
        }) as AnyNode,
        level.id as AnyNodeId,
      )
    }

    const nodesBefore = useScene.getState().nodes
    const footprintBefore = moduleSubtreeBounds(legRun.id, nodesBefore)
    expect(wallConstraintFlags(runWallConstraints(run, [source, donor], nodesBefore))).toEqual({
      left: false,
      right: false,
    })
    expect(wallConstraintFlags(runWallConstraints(legRun, legModules, nodesBefore))).toEqual({
      left: true,
      right: true,
    })
    expect(
      reflowRunModules({
        modules: legModules,
        parentRun: legRun,
        patch: cabinetPresetById('fridge-single').createPatch(legRun),
        scene: useScene.getState(),
        selected,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    expect(
      (nodesAfter[selected.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.76)
    const footprintAfter = moduleSubtreeBounds(legRun.id, nodesAfter)
    const footprintLength = (bounds: ReturnType<typeof moduleSubtreeBounds>) =>
      bounds.maxX - bounds.minX + (bounds.maxZ - bounds.minZ)
    expect(footprintLength(footprintAfter) - footprintLength(footprintBefore)).toBeCloseTo(0.26)
  })

  test('uses only the real source wall when both source ends have L returns', () => {
    const level = LevelNode.parse({ id: 'level_reflow-two-corners' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-two-corners',
      parentId: level.id,
      position: [2, 0, 3],
      rotation: Math.PI / 2,
      children: [
        'cabinet-module_reflow-two-corners-left',
        'cabinet-module_reflow-two-corners-selected',
        'cabinet-module_reflow-two-corners-neighbor',
        'cabinet-module_reflow-two-corners-right',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-two-corners-left',
      parentId: run.id,
      position: [-0.675, 0.1, 0],
      width: 0.35,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-two-corners-selected',
      parentId: run.id,
      position: [-0.25, 0.1, 0],
      width: 0.5,
    })
    const neighbor = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-two-corners-neighbor',
      parentId: run.id,
      position: [0.25, 0.1, 0],
      width: 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-two-corners-right',
      parentId: run.id,
      position: [0.675, 0.1, 0],
      width: 0.35,
    })
    seedScene([level, run, left, selected, neighbor, right] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: left, run, sceneApi, side: 'left' })).toBeTruthy()
    expect(addCornerRun({ module: right, run, sceneApi, side: 'right' })).toBeTruthy()

    const nodesBeforeWalls = useScene.getState().nodes
    const liveRun = nodesBeforeWalls[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBeforeWalls[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const runTransform = worldTransform(liveRun, nodesBeforeWalls)
    const cos = Math.cos(runTransform.rotation)
    const sin = Math.sin(runTransform.rotation)
    const wallAxis: [number, number] = [sin, cos]
    const rightX = runTransform.position[0] + runMaxX(liveModules) * cos
    const rightZ = runTransform.position[2] - runMaxX(liveModules) * sin
    const wallOffset = 0.39
    const wall = WallNode.parse({
      id: 'wall_reflow-two-corners-right',
      parentId: level.id,
      start: [rightX + cos * wallOffset - wallAxis[0], rightZ - sin * wallOffset - wallAxis[1]],
      end: [rightX + cos * wallOffset + wallAxis[0], rightZ - sin * wallOffset + wallAxis[1]],
    })
    sceneApi.upsert(wall as AnyNode, level.id as AnyNodeId)

    const nodesBefore = useScene.getState().nodes
    const leftRun = derivedBaseRunForSource(left.id, nodesBefore)
    const rightRun = derivedBaseRunForSource(right.id, nodesBefore)
    const leftBefore = moduleSubtreeBounds(leftRun.id, nodesBefore)
    const rightBefore = moduleSubtreeBounds(rightRun.id, nodesBefore)
    const extentBefore = { minX: runMinX(liveModules), maxX: runMaxX(liveModules) }
    const constraints = runWallConstraints(liveRun, liveModules, nodesBefore)
    expect(wallConstraintFlags(constraints)).toEqual({
      left: false,
      right: true,
    })
    expect(constraints.right.slack).toBeCloseTo(0.29)
    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
        scene: useScene.getState(),
        selected: nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const leftAfter = moduleSubtreeBounds(leftRun.id, nodesAfter)
    const rightAfter = moduleSubtreeBounds(rightRun.id, nodesAfter)
    const liveModulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    expect(
      (nodesAfter[selected.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.76)
    expect(liveModulesAfter.every((module) => module.width >= 0.3)).toBe(true)
    expect(
      liveModulesAfter.reduce((sum, module) => sum + module.width, 0) -
        liveModules.reduce((sum, module) => sum + module.width, 0),
    ).toBeCloseTo(0.26)
    expect(runMinX(liveModulesAfter)).toBeCloseTo(extentBefore.minX - 0.26)
    expect(runMaxX(liveModulesAfter)).toBeCloseTo(extentBefore.maxX)
    expect((leftAfter.minX + leftAfter.maxX) / 2).toBeCloseTo(
      (leftBefore.minX + leftBefore.maxX) / 2,
    )
    expect(
      Math.abs((leftAfter.minZ + leftAfter.maxZ - leftBefore.minZ - leftBefore.maxZ) / 2),
    ).toBeCloseTo(0.26)
    const rightWallInset = liveRun.depth - constraints.right.slack
    expect(rightAfter.minX).toBeCloseTo(rightBefore.minX)
    expect(rightAfter.maxX).toBeCloseTo(rightBefore.maxX)
    expect(rightAfter.minZ).toBeCloseTo(rightBefore.minZ + rightWallInset)
    expect(rightAfter.maxZ).toBeCloseTo(rightBefore.maxZ + rightWallInset)
  })

  test('does not turn two linked L returns into wall constraints', () => {
    const level = LevelNode.parse({ id: 'level_reflow-corner-trim' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-corner-trim',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-corner-trim-donor',
        'cabinet-module_reflow-corner-trim-selected',
      ],
    })
    const donor = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-corner-trim-donor',
      parentId: run.id,
      position: [-0.25, 0.1, 0],
      width: 0.35,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-corner-trim-selected',
      parentId: run.id,
      position: [0.175, 0.1, 0],
      width: 0.5,
    })
    seedScene([level, run, donor, selected] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: donor, run, sceneApi, side: 'left' })).toBeTruthy()
    expect(addCornerRun({ module: selected, run, sceneApi, side: 'right' })).toBeTruthy()

    const nodesBefore = useScene.getState().nodes
    const liveRun = nodesBefore[run.id] as ReturnType<typeof CabinetNode.parse>
    const liveModules = liveRun.children
      .map((id) => nodesBefore[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const donorRun = derivedBaseRunForSource(donor.id, nodesBefore)
    const selectedRun = derivedBaseRunForSource(selected.id, nodesBefore)
    const donorFootprintBefore = moduleSubtreeBounds(donorRun.id, nodesBefore)
    const selectedFootprintBefore = moduleSubtreeBounds(selectedRun.id, nodesBefore)
    const extentBefore = { minX: runMinX(liveModules), maxX: runMaxX(liveModules) }
    expect(wallConstraintFlags(runWallConstraints(liveRun, liveModules, nodesBefore))).toEqual({
      left: false,
      right: false,
    })

    expect(
      reflowRunModules({
        modules: liveModules,
        parentRun: liveRun,
        patch: cabinetPresetById('fridge-single').createPatch(liveRun),
        scene: useScene.getState(),
        selected: nodesBefore[selected.id] as ReturnType<typeof CabinetModuleNode.parse>,
      }),
    ).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const liveModulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    expect(
      (nodesAfter[selected.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.76)
    expect((nodesAfter[donor.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(
      0.35,
    )
    expect(runMinX(liveModulesAfter)).toBeCloseTo(extentBefore.minX)
    expect(runMaxX(liveModulesAfter)).toBeCloseTo(extentBefore.maxX + 0.26)
    expect(moduleSubtreeBounds(donorRun.id, nodesAfter)).toEqual(donorFootprintBefore)
    expect(moduleSubtreeBounds(selectedRun.id, nodesAfter)).toEqual({
      minX: expect.closeTo(selectedFootprintBefore.minX + 0.26),
      maxX: expect.closeTo(selectedFootprintBefore.maxX + 0.26),
      minZ: expect.closeTo(selectedFootprintBefore.minZ),
      maxZ: expect.closeTo(selectedFootprintBefore.maxZ),
    })
  })

  test('restores exact widths after alternating preset changes in a constrained two-L run', () => {
    const level = LevelNode.parse({ id: 'level_reflow-alternating-two-l' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-alternating-two-l',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-alternating-two-l-left',
        'cabinet-module_reflow-alternating-two-l-a',
        'cabinet-module_reflow-alternating-two-l-b',
        'cabinet-module_reflow-alternating-two-l-right',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-alternating-two-l-left',
      parentId: run.id,
      position: [-0.675, 0.1, 0],
      width: 0.35,
    })
    const a = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-alternating-two-l-a',
      parentId: run.id,
      position: [-0.25, 0.1, 0],
      width: 0.5,
    })
    const b = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-alternating-two-l-b',
      parentId: run.id,
      position: [0.25, 0.1, 0],
      width: 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-alternating-two-l-right',
      parentId: run.id,
      position: [0.675, 0.1, 0],
      width: 0.35,
    })
    seedScene([level, run, left, a, b, right] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: left, run, sceneApi, side: 'left' })).toBeTruthy()
    expect(addCornerRun({ module: right, run, sceneApi, side: 'right' })).toBeTruthy()

    const nodesAfterCorners = useScene.getState().nodes
    const liveRun = nodesAfterCorners[run.id] as ReturnType<typeof CabinetNode.parse>
    const initialModules = liveRun.children
      .map((id) => nodesAfterCorners[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    for (const [index, x] of [
      runMinX(initialModules) - 0.1,
      runMaxX(initialModules) + 0.1,
    ].entries()) {
      sceneApi.upsert(
        WallNode.parse({
          id: `wall_reflow-alternating-two-l-${index}`,
          parentId: level.id,
          start: [x, -1],
          end: [x, 1],
          thickness: 0.2,
        }) as AnyNode,
        level.id as AnyNodeId,
      )
    }
    const initialWidths = initialModules.map((module) => module.width)
    const initialExtent = { minX: runMinX(initialModules), maxX: runMaxX(initialModules) }
    const apply = (moduleId: AnyNodeId, presetId: 'base-door' | 'fridge-single') => {
      const scene = useScene.getState()
      const liveParent = scene.nodes[run.id] as ReturnType<typeof CabinetNode.parse>
      const liveModules = liveParent.children
        .map((id) => scene.nodes[id])
        .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
          Boolean(node?.type === 'cabinet-module'),
        )
      return reflowRunModules({
        modules: liveModules,
        parentRun: liveParent,
        patch: cabinetPresetById(presetId).createPatch(liveParent),
        scene,
        selected: scene.nodes[moduleId] as ReturnType<typeof CabinetModuleNode.parse>,
      })
    }
    expect(apply(a.id as AnyNodeId, 'fridge-single')).toBe(true)
    expect(
      (useScene.getState().nodes[b.id]?.metadata as Record<string, unknown> | null)
        ?.cabinetPresetWidthDebtBySource,
    ).toBeDefined()
    expect(apply(b.id as AnyNodeId, 'fridge-single')).toBe(true)
    expect(
      (useScene.getState().nodes[b.id]?.metadata as Record<string, unknown> | null)
        ?.cabinetPresetWidthDebtBySource,
    ).toBeUndefined()
    expect(apply(b.id as AnyNodeId, 'base-door')).toBe(true)
    expect(apply(a.id as AnyNodeId, 'base-door')).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const modulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    expect(modulesAfter).toHaveLength(initialWidths.length)
    modulesAfter.forEach((module, index) => {
      expect(module.width).toBeCloseTo(initialWidths[index]!)
    })
    expect(runMinX(modulesAfter)).toBeCloseTo(initialExtent.minX)
    expect(runMaxX(modulesAfter)).toBeCloseTo(initialExtent.maxX)
  })

  test('lets a neighbor absorb the full width when an L source shrinks below its original width', () => {
    const level = LevelNode.parse({ id: 'level_reflow-l-source-shrink' })
    const run = CabinetNode.parse({
      id: 'cabinet_reflow-l-source-shrink',
      parentId: level.id,
      children: [
        'cabinet-module_reflow-l-source-shrink-source',
        'cabinet-module_reflow-l-source-shrink-neighbor',
      ],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-l-source-shrink-source',
      parentId: run.id,
      position: [-0.25, 0.1, 0],
      width: 0.64,
    })
    const neighbor = CabinetModuleNode.parse({
      id: 'cabinet-module_reflow-l-source-shrink-neighbor',
      parentId: run.id,
      position: [0.32, 0.1, 0],
      width: 0.5,
    })
    seedScene([level, run, source, neighbor] as AnyNode[], level.id as AnyNodeId)
    const sceneApi = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi, side: 'left' })).toBeTruthy()

    const nodesAfterCorner = useScene.getState().nodes
    const liveRun = nodesAfterCorner[run.id] as ReturnType<typeof CabinetNode.parse>
    const initialModules = liveRun.children
      .map((id) => nodesAfterCorner[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    const initialExtent = { minX: runMinX(initialModules), maxX: runMaxX(initialModules) }
    for (const [index, x] of [initialExtent.minX - 0.1, initialExtent.maxX + 0.1].entries()) {
      sceneApi.upsert(
        WallNode.parse({
          id: `wall_reflow-l-source-shrink-${index}`,
          parentId: level.id,
          start: [x, -1],
          end: [x, 1],
          thickness: 0.2,
        }) as AnyNode,
        level.id as AnyNodeId,
      )
    }
    const applyPreset = (presetId: 'base-door' | 'fridge-single') => {
      const scene = useScene.getState()
      const parent = scene.nodes[run.id] as ReturnType<typeof CabinetNode.parse>
      const modules = parent.children
        .map((id) => scene.nodes[id])
        .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
          Boolean(node?.type === 'cabinet-module'),
        )
      return reflowRunModules({
        modules,
        parentRun: parent,
        patch: cabinetPresetById(presetId).createPatch(parent),
        scene,
        selected: scene.nodes[source.id] as ReturnType<typeof CabinetModuleNode.parse>,
      })
    }

    expect(applyPreset('fridge-single')).toBe(true)
    expect(
      (useScene.getState().nodes[neighbor.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.38)
    expect(applyPreset('base-door')).toBe(true)

    const nodesAfter = useScene.getState().nodes
    const modulesAfter = liveRun.children
      .map((id) => nodesAfter[id])
      .filter((node): node is ReturnType<typeof CabinetModuleNode.parse> =>
        Boolean(node?.type === 'cabinet-module'),
      )
    expect((nodesAfter[source.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(
      0.5,
    )
    expect(
      (nodesAfter[neighbor.id] as ReturnType<typeof CabinetModuleNode.parse>).width,
    ).toBeCloseTo(0.64)
    expect(runMinX(modulesAfter)).toBeCloseTo(initialExtent.minX)
    expect(runMaxX(modulesAfter)).toBeCloseTo(initialExtent.maxX)
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

  test('combines eligible cabinets when the closest cannot absorb the fridge width', () => {
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
    expect((nodes[near.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.3)
    expect((nodes[far.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.74)
  })
})
