import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, createSceneApi, LevelNode, useScene } from '@pascal-app/core'
import { cabinetModuleDefinition } from '../definition'
import { addCornerRun } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

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

describe('manual width reflow', () => {
  test('keeps nested corner runs in world space when a handle moves their source module', () => {
    const level = LevelNode.parse({ id: 'level_handle-corner-world-space' })
    const run = CabinetNode.parse({
      id: 'cabinet_handle-corner-world-space',
      parentId: level.id,
      children: [
        'cabinet-module_handle-corner-world-space-source',
        'cabinet-module_handle-corner-world-space-selected',
        'cabinet-module_handle-corner-world-space-neighbor',
      ],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_handle-corner-world-space-source',
      parentId: run.id,
      position: [-0.5, 0.1, 0],
      width: 0.5,
    })
    const selected = CabinetModuleNode.parse({
      id: 'cabinet-module_handle-corner-world-space-selected',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.5,
    })
    const neighbor = CabinetModuleNode.parse({
      id: 'cabinet-module_handle-corner-world-space-neighbor',
      parentId: run.id,
      position: [0.5, 0.1, 0],
      width: 0.5,
    })
    useScene.setState({
      nodes: Object.fromEntries(
        ([level, run, source, selected, neighbor] as AnyNode[]).map((node) => [node.id, node]),
      ),
      rootNodeIds: [level.id],
    } as never)

    const scene = createSceneApi(useScene)
    expect(addCornerRun({ module: source, run, sceneApi: scene, side: 'left' })).toBeTruthy()
    const nodesBefore = scene.nodes() as Record<AnyNodeId, AnyNode>
    const derivedBaseRun = Object.values(nodesBefore).find(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' &&
        node.parentId === run.id &&
        (node.metadata as Record<string, { role?: string }>).cabinetCornerDerivedRun?.role ===
          'base-leg',
    )!
    const nestedSource = derivedBaseRun.children
      .map((id) => nodesBefore[id])
      .find(
        (node): node is ReturnType<typeof CabinetModuleNode.parse> =>
          node?.type === 'cabinet-module' && node.name === 'Corner Filler',
      )!
    const nestedRuns = Object.values(nodesBefore).filter(
      (node): node is ReturnType<typeof CabinetNode.parse> =>
        node.type === 'cabinet' && node.parentId === nestedSource.id,
    )
    expect(nestedRuns.length).toBeGreaterThan(0)
    const worldBefore = new Map(
      nestedRuns.map((nestedRun) => [
        nestedRun.id,
        worldTransform(nestedRun, nodesBefore).position,
      ]),
    )

    const widthHandle = cabinetModuleDefinition.handles!(nestedSource, scene).find(
      (handle) => handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === 'max',
    )
    expect(widthHandle?.kind).toBe('linear-resize')
    if (widthHandle?.kind !== 'linear-resize') return
    const widthPatch = widthHandle.apply(nestedSource, nestedSource.width + 0.2, scene)
    widthHandle.commit?.(nestedSource, widthPatch, scene)

    const nodesAfter = scene.nodes() as Record<AnyNodeId, AnyNode>
    expect(
      (nodesAfter[nestedSource.id] as ReturnType<typeof CabinetModuleNode.parse>).position[0],
    ).not.toBeCloseTo(nestedSource.position[0])
    for (const nestedRun of nestedRuns) {
      const before = worldBefore.get(nestedRun.id)!
      const after = worldTransform(
        nodesAfter[nestedRun.id] as ReturnType<typeof CabinetNode.parse>,
        nodesAfter,
      ).position
      expect(after[0]).toBeCloseTo(before[0])
      expect(after[2]).toBeCloseTo(before[2])
    }
  })

  test.each([
    ['left', 'max', -1, true],
    ['right', 'min', 1, false],
  ] as const)('%s-handle resize reflows an open run', (_side, anchor, direction, movesLeft) => {
    const level = LevelNode.parse({ id: 'level_preset-debt-affinity' })
    const run = CabinetNode.parse({
      id: 'cabinet_preset-debt-affinity',
      parentId: level.id,
      children: [
        'cabinet-module_preset-debt-affinity-a',
        'cabinet-module_preset-debt-affinity-b',
        'cabinet-module_preset-debt-affinity-c',
      ],
    })
    const a = CabinetModuleNode.parse({
      id: 'cabinet-module_preset-debt-affinity-a',
      parentId: run.id,
      position: [-0.5, 0.1, 0],
      width: 0.5,
    })
    const b = CabinetModuleNode.parse({
      id: 'cabinet-module_preset-debt-affinity-b',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.5,
    })
    const c = CabinetModuleNode.parse({
      id: 'cabinet-module_preset-debt-affinity-c',
      parentId: run.id,
      position: [0.5, 0.1, 0],
      width: 0.5,
    })
    useScene.setState({
      nodes: Object.fromEntries(
        ([level, run, a, b, c] as AnyNode[]).map((node) => [node.id, node]),
      ),
      rootNodeIds: [level.id],
    } as never)

    const scene = createSceneApi(useScene)
    const widthHandle = cabinetModuleDefinition.handles!(b, scene).find(
      (handle) =>
        handle.kind === 'linear-resize' && handle.axis === 'x' && handle.anchor === anchor,
    )
    expect(widthHandle?.kind).toBe('linear-resize')
    if (widthHandle?.kind !== 'linear-resize') return
    expect(widthHandle.visible?.(b, scene) ?? true).toBe(true)
    const widthPatch = widthHandle.apply(b, 0.7, scene)
    widthHandle.commit?.(b, widthPatch, scene)

    const widened = useScene.getState().nodes
    expect((widened[a.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.5)
    expect((widened[b.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.7)
    expect((widened[c.id] as ReturnType<typeof CabinetModuleNode.parse>).width).toBeCloseTo(0.5)
    const movedEnd = widened[movesLeft ? a.id : c.id] as ReturnType<typeof CabinetModuleNode.parse>
    const fixedEnd = widened[movesLeft ? c.id : a.id] as ReturnType<typeof CabinetModuleNode.parse>
    if (direction < 0) {
      expect(movedEnd.position[0]).toBeLessThan(-0.5)
    } else {
      expect(movedEnd.position[0]).toBeGreaterThan(0.5)
    }
    expect(fixedEnd.position[0]).toBeCloseTo(movesLeft ? 0.5 : -0.5)
  })
})
