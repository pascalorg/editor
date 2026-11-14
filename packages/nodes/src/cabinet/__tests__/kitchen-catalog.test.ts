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

test('an upper attached to a module is found as a wall cabinet, by its shown name too', () => {
  const run = CabinetNode.parse({})
  const base = CabinetModuleNode.parse({ parentId: run.id })
  const upper = CabinetModuleNode.parse({ parentId: base.id })
  const nodes = Object.fromEntries([run, base, upper].map((node) => [node.id, node]))
  expect(findKitchenItems(nodes, 'overhead').map((node) => node.id)).toEqual([upper.id])
  const shown = (id: string) => (id === 'wall-cabinet' ? 'Meuble haut' : 'Meuble bas')
  expect(findKitchenItems(nodes, 'meuble haut', shown).map((node) => node.id)).toEqual([upper.id])
})
