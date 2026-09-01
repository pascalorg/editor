import { expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { applyCabinetModuleFrontPatch } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

test('module front settings propagate to its nested wall and top cabinet', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_front-family-run',
    children: ['cabinet-module_front-family-base'],
  })
  const base = CabinetModuleNode.parse({
    id: 'cabinet-module_front-family-base',
    parentId: run.id,
    children: ['cabinet-module_front-family-wall'],
    frontOverlay: 'full',
    frontStyle: 'slab',
  })
  const wall = CabinetModuleNode.parse({
    id: 'cabinet-module_front-family-wall',
    parentId: base.id,
    frontOverlay: 'full',
    frontStyle: 'slab',
    topFinish: 'top-cabinet',
  })
  const nodes = Object.fromEntries(
    [run, base, wall].map((node) => [node.id as AnyNodeId, node as AnyNode]),
  ) as Record<AnyNodeId, AnyNode>
  const sceneApi = {
    get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    nodes: () => nodes,
    update: (id: AnyNodeId, patch: Partial<AnyNode>) => {
      nodes[id] = { ...nodes[id], ...patch } as AnyNode
    },
    markDirty: () => {},
  } as SceneApi

  applyCabinetModuleFrontPatch({
    module: base,
    patch: { frontOverlay: 'inset', frontStyle: 'raised-arch' },
    sceneApi,
  })

  expect(sceneApi.get<typeof base>(base.id)?.frontOverlay).toBe('inset')
  expect(sceneApi.get<typeof wall>(wall.id)?.frontOverlay).toBe('inset')
  expect(sceneApi.get<typeof wall>(wall.id)?.frontStyle).toBe('raised-arch')

  applyCabinetModuleFrontPatch({
    module: sceneApi.get<typeof base>(base.id)!,
    patch: { frontOverlay: 'full', frontStyle: 'slab' },
    sceneApi,
  })

  expect(sceneApi.get<typeof wall>(wall.id)?.frontOverlay).toBe('full')
  expect(sceneApi.get<typeof wall>(wall.id)?.frontStyle).toBe('slab')
})
