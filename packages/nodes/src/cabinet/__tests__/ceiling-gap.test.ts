import { expect, test } from 'bun:test'
import { type AnyNode, CabinetModuleNode, CabinetNode, LevelNode } from '@pascal-app/core'
import { cabinetCeilingGap, cabinetModuleCeilingOverflow } from '../run-ops'

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

test('ceiling gap clamps an oversized room gap to the finish maximum', () => {
  const level = LevelNode.parse({ id: 'level_ceiling-gap-max', height: 4 })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_ceiling-gap-max',
    parentId: level.id,
    carcassHeight: 1,
    showPlinth: false,
    withCountertop: false,
  })

  expect(cabinetCeilingGap(module, { [level.id]: level, [module.id]: module })).toBe(1.2)
})

test('ceiling gap returns zero when the module already reaches the ceiling', () => {
  const level = LevelNode.parse({ id: 'level_ceiling-gap-zero', height: 2.4 })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_ceiling-gap-zero',
    parentId: level.id,
    position: [0, 0, 0],
    carcassHeight: 2.4,
    showPlinth: false,
    withCountertop: false,
  })

  expect(cabinetCeilingGap(module, { [level.id]: level, [module.id]: module })).toBe(0)
})

test('ceiling gap does not count a plinth already included in module position', () => {
  const level = LevelNode.parse({ id: 'level_ceiling-gap-plinth', height: 2.5 })
  const run = CabinetNode.parse({
    id: 'cabinet_ceiling-gap-plinth-run',
    parentId: level.id,
    showPlinth: true,
    plinthHeight: 0.1,
    children: ['cabinet-module_ceiling-gap-plinth'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_ceiling-gap-plinth',
    parentId: run.id,
    position: [0, 0.1, 0],
    carcassHeight: 2.07,
    showPlinth: true,
    plinthHeight: 0.1,
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

test('ceiling overflow includes a nested top finish without double-counting the plinth', () => {
  const level = LevelNode.parse({ id: 'level_ceiling-overflow', height: 2.5 })
  const run = CabinetNode.parse({
    id: 'cabinet_ceiling-overflow-run',
    parentId: level.id,
    children: ['cabinet-module_ceiling-overflow-module'],
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_ceiling-overflow-module',
    parentId: run.id,
    position: [0, 0.1, 0],
    carcassHeight: 2.07,
    showPlinth: true,
    plinthHeight: 0.1,
    withCountertop: false,
    topFinish: 'trim',
    topFinishHeight: 0.4,
  })

  expect(
    cabinetModuleCeilingOverflow(module, {
      [level.id]: level,
      [run.id]: run,
      [module.id]: module,
    } as Record<string, AnyNode>),
  ).toBeCloseTo(0.07)
})
