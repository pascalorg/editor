import { expect, test } from 'bun:test'
import { type AnyNode, CabinetModuleNode, CabinetNode, LevelNode } from '@pascal-app/core'
import { validateCabinetRun } from './validation'

test('validateCabinetRun accepts a flush modular base run', () => {
  const run = CabinetNode.parse({ id: 'cabinet_validation-run' })
  const left = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-left',
    parentId: run.id,
    position: [-0.3, 0.1, 0],
    width: 0.6,
  })
  const right = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-right',
    parentId: run.id,
    position: [0.3, 0.1, 0],
    width: 0.6,
  })

  expect(validateCabinetRun(run, [left, right])).toMatchObject({
    valid: true,
    errors: [],
    warnings: [],
  })
})

test('validateCabinetRun reports overlapping modules as an error', () => {
  const run = CabinetNode.parse({ id: 'cabinet_validation-overlap-run' })
  const left = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-overlap-left',
    parentId: run.id,
    position: [-0.1, 0.1, 0],
    width: 0.6,
  })
  const right = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-overlap-right',
    parentId: run.id,
    position: [0.1, 0.1, 0],
    width: 0.6,
  })

  const report = validateCabinetRun(run, [left, right])

  expect(report.valid).toBe(false)
  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'module-overlap',
      nodeIds: [left.id, right.id],
    }),
  )
})

test('validateCabinetRun warns about an unfilled gap without rejecting the run', () => {
  const run = CabinetNode.parse({ id: 'cabinet_validation-gap-run' })
  const left = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-gap-left',
    parentId: run.id,
    position: [-0.35, 0.1, 0],
    width: 0.5,
  })
  const right = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-gap-right',
    parentId: run.id,
    position: [0.35, 0.1, 0],
    width: 0.5,
  })

  const report = validateCabinetRun(run, [left, right])

  expect(report.valid).toBe(true)
  expect(report.warnings).toContainEqual(
    expect.objectContaining({
      code: 'module-gap',
      nodeIds: [left.id, right.id],
    }),
  )
})

test('validateCabinetRun rejects a stack that cannot fit its carcass', () => {
  const run = CabinetNode.parse({ id: 'cabinet_validation-stack-run' })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-stack',
    parentId: run.id,
    carcassHeight: 0.4,
    stack: [{ id: 'compartment-oven', type: 'oven', height: 0.595 }],
  })

  const report = validateCabinetRun(run, [module])

  expect(report.valid).toBe(false)
  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'stack-too-short',
      nodeIds: [module.id],
    }),
  )
})

test('validateCabinetRun warns when a top cabinet is too short to be practical storage', () => {
  const run = CabinetNode.parse({ id: 'cabinet_validation-top-run' })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-top',
    parentId: run.id,
    topFinish: 'top-cabinet',
    topFinishHeight: 0.1,
  })

  const report = validateCabinetRun(run, [module])

  expect(report.valid).toBe(true)
  expect(report.warnings).toContainEqual(
    expect.objectContaining({
      code: 'top-cabinet-too-short',
      nodeIds: [module.id],
    }),
  )
})

test('validateCabinetRun warns when a finished module exceeds the ceiling', () => {
  const level = LevelNode.parse({ id: 'level_validation-ceiling', height: 2.5 })
  const run = CabinetNode.parse({
    id: 'cabinet_validation-ceiling-run',
    parentId: level.id,
  })
  const module = CabinetModuleNode.parse({
    id: 'cabinet-module_validation-ceiling',
    parentId: run.id,
    position: [0, 0.1, 0],
    carcassHeight: 2.07,
    topFinish: 'trim',
    topFinishHeight: 0.4,
  })

  const report = validateCabinetRun(run, [module], {
    nodes: {
      [level.id]: level,
      [run.id]: run,
      [module.id]: module,
    } as Record<string, AnyNode>,
  })

  expect(report.valid).toBe(true)
  expect(report.warnings).toContainEqual(
    expect.objectContaining({
      code: 'ceiling-overflow',
      nodeIds: [run.id, module.id],
    }),
  )
})
