import { expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { cabinetPresetById } from '../presets'
import { addWallChildAbove } from '../run-ops'
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
      if (current) nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent) {
          nodes[parentId] = {
            ...parent,
            children: [...new Set([...(parent.children ?? []), node.id as AnyNodeId])],
          } as AnyNode
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

test('the default base cabinet preset uses overlay fronts', () => {
  expect(cabinetPresetById('base-door').createPatch().frontOverlay).toBe('full')
})

test('a wall cabinet added from an inset base starts with overlay fronts', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_default-front-run',
    children: ['cabinet-module_default-front-base'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_default-front-base',
    parentId: run.id,
    frontOverlay: 'inset',
  })
  const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

  const wallId = addWallChildAbove({ kind: 'cabinet', module, run, sceneApi })

  expect(wallId).not.toBeNull()
  expect(sceneApi.get<CabinetModuleNode>(wallId!)?.frontOverlay).toBe('full')
})
