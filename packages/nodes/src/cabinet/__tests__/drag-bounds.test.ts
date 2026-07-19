import { describe, expect, test } from 'bun:test'
import { cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'

describe('cabinet module drag bounds', () => {
  test('uses schema dimensions instead of measured render geometry', () => {
    const module = CabinetModuleNode.parse({
      width: 0.82,
      depth: 0.64,
      carcassHeight: 0.74,
      plinthHeight: 0.11,
      countertopThickness: 0.03,
      showPlinth: true,
      withCountertop: true,
    })

    const bounds = cabinetModuleDefinition.capabilities.dragBounds?.(module, {})

    expect(bounds?.size).toEqual([0.82, 0.88, 0.64])
    expect(bounds?.center).toEqual([0, 0.44, 0])
  })

  test('moves an attached wall cabinet with its host module and bounds the full stack', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_wall-drag-run',
      children: ['cabinet-module_wall-drag-base'],
    })
    const base = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-drag-base',
      parentId: run.id,
      children: ['cabinet-module_wall-drag-upper'],
      position: [0, 0.1, 0],
      width: 0.6,
      depth: 0.58,
    })
    const wall = CabinetModuleNode.parse({
      id: 'cabinet-module_wall-drag-upper',
      parentId: base.id,
      position: [0, 1.25, -0.13],
      width: 0.6,
      depth: 0.32,
      carcassHeight: 0.72,
      plinthHeight: 0,
      showPlinth: false,
      withCountertop: false,
    })
    const nodes = { [run.id]: run, [base.id]: base, [wall.id]: wall }

    const parent = cabinetModuleDefinition.capabilities.movable?.parentFrame?.resolveParent(
      wall,
      nodes,
    )
    const bounds = cabinetModuleDefinition.capabilities.dragBounds?.(base, nodes)

    expect(parent?.id).toBe(base.id)
    expect(bounds?.size[0]).toBeCloseTo(0.6)
    expect(bounds?.size[1]).toBeCloseTo(1.97)
    expect(bounds?.size[2]).toBeCloseTo(0.58)
    expect(bounds?.center[0]).toBeCloseTo(0)
    expect(bounds?.center[1]).toBeCloseTo(0.985)
    expect(bounds?.center[2]).toBeCloseTo(0)
  })
})
