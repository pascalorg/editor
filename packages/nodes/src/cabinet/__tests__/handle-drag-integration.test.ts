import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type CabinetModuleNode,
  createSceneApi,
  type LinearResizeHandle,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createLinearResizeDragBinding } from '../../../../editor/src/components/editor/handles/linear-resize-drag'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode as CabinetModuleSchema, CabinetNode } from '../schema'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const restoreRegistry = nodeRegistry._snapshot()

function cabinetFixture() {
  const run = CabinetNode.parse({
    id: 'cabinet_handle-path-run',
    children: ['cabinet-module_handle-path-bottom', 'cabinet-module_handle-path-neighbor'],
  })
  const bottom = CabinetModuleSchema.parse({
    id: 'cabinet-module_handle-path-bottom',
    parentId: run.id,
    children: ['cabinet-module_handle-path-top'],
    position: [-0.3, 0.1, 0],
    width: 0.6,
  })
  const top = CabinetModuleSchema.parse({
    id: 'cabinet-module_handle-path-top',
    name: 'Wall Cabinet',
    parentId: bottom.id,
    position: [0, 1.35, -0.13],
    width: 0.6,
    depth: 0.32,
  })
  const neighbor = CabinetModuleSchema.parse({
    id: 'cabinet-module_handle-path-neighbor',
    parentId: run.id,
    position: [0.3, 0.1, 0],
    width: 0.6,
  })
  const nodes = Object.fromEntries(
    [run, bottom, top, neighbor].map((node) => [node.id, node as AnyNode]),
  ) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [run.id], dirtyNodes: new Set() } as never)
  return { bottom, top }
}

describe('cabinet width handle drag path', () => {
  beforeEach(() => {
    restoreRegistry()
    registerNode(cabinetDefinition as never)
    registerNode(cabinetModuleDefinition as never)
    useLiveNodeOverrides.getState().clearAll()
  })

  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    restoreRegistry()
  })

  test('resizing an attached top cabinet previews and commits only that cabinet', () => {
    const { bottom, top } = cabinetFixture()

    const sceneApi = createSceneApi(useScene)
    const handles = (
      cabinetModuleDefinition.handles as (
        node: CabinetModuleNode,
        sceneApi: ReturnType<typeof createSceneApi>,
      ) => LinearResizeHandle<CabinetModuleNode>[]
    )(top, sceneApi)
    const widthHandle = handles.find((handle) => handle.axis === 'x' && handle.anchor === 'min')
    expect(widthHandle).toBeDefined()

    const binding = createLinearResizeDragBinding({
      descriptor: widthHandle as LinearResizeHandle<AnyNode>,
      initialNode: top as AnyNode,
      nodeId: top.id as AnyNodeId,
      sceneApi,
      initialModifiers: { altKey: false },
    })
    const patch = binding.apply(0.8, { altKey: false })
    useLiveNodeOverrides.getState().set(binding.overrideId, patch as Record<string, unknown>)

    const topPreview = useLiveNodeOverrides.getState().overrides.get(top.id)
    expect(binding.overrideId).toBe(top.id)
    expect(topPreview?.width).toBeCloseTo(0.8)
    expect((topPreview?.position as [number, number, number] | undefined)?.[0]).toBeCloseTo(0.1)
    expect(useLiveNodeOverrides.getState().overrides.has(bottom.id)).toBe(false)
    expect((useScene.getState().nodes[bottom.id] as CabinetModuleNode).width).toBeCloseTo(0.6)

    const commit = binding.commit ?? ((nextPatch) => sceneApi.update(binding.overrideId, nextPatch))
    commit(patch)
    useLiveNodeOverrides.getState().clear(binding.overrideId)
    binding.clearPreview()

    const committedBottom = useScene.getState().nodes[bottom.id] as CabinetModuleNode
    const committedTop = useScene.getState().nodes[top.id] as CabinetModuleNode
    expect(committedBottom.width).toBeCloseTo(0.6)
    expect(committedBottom.position[0]).toBeCloseTo(-0.3)
    expect(committedTop.width).toBeCloseTo(0.8)
    expect(committedTop.position[0]).toBeCloseTo(0.1)
  })
})
