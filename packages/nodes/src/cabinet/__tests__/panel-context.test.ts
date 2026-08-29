import { expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { cabinetModulePanelContext } from '../panel-context'
import { CabinetModuleNode, CabinetNode } from '../schema'

test('maps a derived L-leg module to its source module and run for panel reflow', () => {
  const sourceRun = CabinetNode.parse({
    id: 'cabinet_panel-context-source-run',
    children: ['cabinet-module_panel-context-source'],
  })
  const sourceModule = CabinetModuleNode.parse({
    id: 'cabinet-module_panel-context-source',
    parentId: sourceRun.id,
  })
  const derivedRun = CabinetNode.parse({
    id: 'cabinet_panel-context-derived-run',
    parentId: sourceRun.id,
    children: ['cabinet-module_panel-context-derived'],
    metadata: {
      cabinetCornerDerivedRun: {
        role: 'base-leg',
        side: 'right',
        turnSide: 'right',
        sourceModuleId: sourceModule.id,
        sourceRunId: sourceRun.id,
      },
    },
  })
  const derivedModule = CabinetModuleNode.parse({
    id: 'cabinet-module_panel-context-derived',
    parentId: derivedRun.id,
  })
  const nodes = Object.fromEntries(
    [sourceRun, sourceModule, derivedRun, derivedModule].map((node) => [node.id, node]),
  ) as Partial<Record<AnyNodeId, AnyNode>>

  const context = cabinetModulePanelContext(derivedModule, nodes)

  expect(context?.parentRun.id).toBe(sourceRun.id)
  expect(context?.reflowModule?.id).toBe(sourceModule.id)
})

test('keeps a nested wall cabinet out of run reflow', () => {
  const run = CabinetNode.parse({
    id: 'cabinet_panel-context-wall-run',
    children: ['cabinet-module_panel-context-base'],
  })
  const base = CabinetModuleNode.parse({
    id: 'cabinet-module_panel-context-base',
    parentId: run.id,
    children: ['cabinet-module_panel-context-wall'],
  })
  const wall = CabinetModuleNode.parse({
    id: 'cabinet-module_panel-context-wall',
    parentId: base.id,
  })
  const nodes = Object.fromEntries([run, base, wall].map((node) => [node.id, node])) as Partial<
    Record<AnyNodeId, AnyNode>
  >

  const context = cabinetModulePanelContext(wall, nodes)

  expect(context?.parentRun.id).toBe(run.id)
  expect(context?.reflowModule).toBeNull()
})
