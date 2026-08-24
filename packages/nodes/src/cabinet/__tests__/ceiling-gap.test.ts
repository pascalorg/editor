import { expect, test } from 'bun:test'
import { type AnyNode, CabinetModuleNode, CabinetNode, LevelNode } from '@pascal-app/core'
import { cabinetCeilingGap } from '../run-ops'

test('ceiling gap resolves the remaining space above a nested tall module', () => {
  const level = LevelNode.parse({ id: 'level_ceiling-gap', height: 2.5 })
  const run = CabinetNode.parse({
    id: 'cabinet_ceiling-gap-run',
    parentId: level.id,
    children: ['cabinet-module_ceiling-gap-module'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_ceiling-gap-module',
    parentId: run.id,
    position: [0, 0.1, 0],
    carcassHeight: 2.07,
    showPlinth: false,
    withCountertop: false,
  })

  expect(
    cabinetCeilingGap(module, {
      [level.id]: level,
      [run.id]: run,
      [module.id]: module,
    } as Record<string, AnyNode>),
  ).toBeCloseTo(0.33)
})
