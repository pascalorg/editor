import { expect, test } from 'bun:test'
import { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { findKitchenItems } from '@pascal-app/nodes'

test('finding placed kitchen items lists modules, not the fillers of their run', () => {
  const run = CabinetNode.parse({})
  const cabinet = CabinetModuleNode.parse({ parentId: run.id, name: 'Base' })
  const fillers = (['corner-filler', 'wall-filler'] as const).map((moduleKind) =>
    CabinetModuleNode.parse({ parentId: run.id, moduleKind }),
  )
  const nodes = Object.fromEntries([run, cabinet, ...fillers].map((node) => [node.id, node]))
  expect(findKitchenItems(nodes, '').map((node) => node.id)).toEqual([cabinet.id])
  expect(findKitchenItems(nodes, 'cupboard').map((node) => node.id)).toEqual([cabinet.id])
  expect(findKitchenItems(nodes, 'dishwasher')).toEqual([])
})
