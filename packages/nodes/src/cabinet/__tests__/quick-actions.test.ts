import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type SceneApi, WallNode } from '@pascal-app/core'
import { cabinetQuickActions } from '../quick-actions'
import { CabinetModuleNode, CabinetNode } from '../schema'

function sceneApiFixture(seed: AnyNode[]): SceneApi {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >

  return {
    get: (id) => nodes[id],
    nodes: () => nodes,
    update: (id, patch) => {
      const current = nodes[id]
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent && Array.isArray((parent as { children?: unknown }).children)) {
          const children = new Set(((parent as { children?: AnyNodeId[] }).children ?? []).slice())
          children.add(node.id as AnyNodeId)
          nodes[parentId] = { ...parent, children: [...children] } as AnyNode
        }
      }
      return node.id as AnyNodeId
    },
    delete: () => {},
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

describe('cabinet quick actions', () => {
  test('offers and runs an L-corner action from run selection using the end module', () => {
    const levelId = 'level_quick_actions_corner' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-corner',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_left-quick-actions-corner', 'cabinet-module_right-quick-actions-corner'],
    })
    const leftModule = CabinetModuleNode.parse({
      id: 'cabinet-module_left-quick-actions-corner',
      parentId: run.id,
      position: [-0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-left-quick-actions-corner', type: 'door', shelfCount: 2 }],
    })
    const rightModule = CabinetModuleNode.parse({
      id: 'cabinet-module_right-quick-actions-corner',
      parentId: run.id,
      position: [0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-right-quick-actions-corner', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_quick-actions-corner-blocker',
      parentId: levelId,
      start: [-1, 0.95],
      end: [3, 0.95],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      leftModule as AnyNode,
      rightModule as AnyNode,
      blockingWall as AnyNode,
    ])

    const actions = cabinetQuickActions({
      node: run,
      nodes: sceneApi.nodes(),
    })
    const cornerAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(cornerAction).toBeTruthy()
    const result = cornerAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
    expect(sceneApi.get<CabinetModuleNode>(rightModule.id)?.width).toBeLessThan(0.9)
  })
})
