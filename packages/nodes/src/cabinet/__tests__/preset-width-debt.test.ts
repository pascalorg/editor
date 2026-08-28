import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { type AnyNode, createSceneApi, LevelNode, useScene } from '@pascal-app/core'
import { cabinetModuleDefinition } from '../definition'
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

describe('manual width reflow', () => {
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
