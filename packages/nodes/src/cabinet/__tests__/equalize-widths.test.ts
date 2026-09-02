import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { planRunModuleWidthEqualization } from '../run-layout'
import { cabinetRunWidthEqualizationPlan, equalizeCabinetRunWidths } from '../run-ops'
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
    upsert: (node) => {
      nodes[node.id as AnyNodeId] = node
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

describe('planRunModuleWidthEqualization', () => {
  test('equalizes target modules across the existing span and removes gaps', () => {
    const modules = [
      { id: 'left', position: [-0.85, 0, 0] as [number, number, number], width: 0.3 },
      { id: 'middle', position: [-0.1, 0, 0] as [number, number, number], width: 0.8 },
      { id: 'right', position: [0.8, 0, 0] as [number, number, number], width: 0.4 },
    ]

    const plan = planRunModuleWidthEqualization({
      equalizedIds: new Set(['left', 'right']),
      modules,
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.targetWidth).toBeCloseTo(0.6)
    expect(plan.equalizedIds).toEqual(['left', 'right'])
    expect(plan.modules.map((module) => module.width)).toEqual([0.6, 0.8, 0.6])
    expect(plan.modules[0]!.position[0]).toBeCloseTo(-0.7)
    expect(plan.modules[1]!.position[0]).toBeCloseTo(0)
    expect(plan.modules[2]!.position[0]).toBeCloseTo(0.7)
    expect(plan.modules[0]!.position[0] - plan.modules[0]!.width / 2).toBeCloseTo(-1)
    expect(plan.modules.at(-1)!.position[0] + plan.modules.at(-1)!.width / 2).toBeCloseTo(1)
  })

  test('does not equalize fixed modules and reports impossible width limits', () => {
    const modules = [
      { id: 'left', position: [-0.75, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'fixed', position: [0, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.75, 0, 0] as [number, number, number], width: 1 },
    ]

    const plan = planRunModuleWidthEqualization({
      equalizedIds: new Set(['left', 'right']),
      maximumWidthById: new Map([
        ['left', 0.8],
        ['right', 0.8],
      ]),
      modules,
    })

    expect(plan).toEqual({ ok: false, reason: 'width-limits' })
  })
})

describe('cabinet width equalization', () => {
  test('keeps appliances fixed while updating wall children and the run revision', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_equalize-run',
      children: [
        'cabinet-module_equalize-left',
        'cabinet-module_equalize-oven',
        'cabinet-module_equalize-right',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_equalize-left',
      parentId: run.id,
      position: [-0.85, 0, 0],
      width: 0.3,
      children: ['cabinet-module_equalize-wall'],
    })
    const oven = CabinetModuleNode.parse({
      id: 'cabinet-module_equalize-oven',
      parentId: run.id,
      position: [-0.1, 0, 0],
      width: 0.8,
      stack: [{ id: 'oven', type: 'oven' }],
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_equalize-right',
      parentId: run.id,
      position: [0.8, 0, 0],
      width: 0.4,
    })
    const wall = CabinetModuleNode.parse({
      id: 'cabinet-module_equalize-wall',
      parentId: left.id,
      cabinetType: 'base',
      position: [0, 1.2, -0.14],
      width: 0.3,
      depth: 0.32,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      oven as AnyNode,
      right as AnyNode,
      wall as AnyNode,
    ])

    const plan = cabinetRunWidthEqualizationPlan(run, sceneApi.nodes())
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.equalizedIds).toEqual([left.id, right.id])
    expect(plan.targetWidth).toBeCloseTo(0.6)

    expect(equalizeCabinetRunWidths({ run, sceneApi })).toBe(true)
    expect(sceneApi.get<CabinetModuleNode>(left.id)?.width).toBeCloseTo(0.6)
    expect(sceneApi.get<CabinetModuleNode>(right.id)?.width).toBeCloseTo(0.6)
    expect(sceneApi.get<CabinetModuleNode>(oven.id)?.width).toBeCloseTo(0.8)
    expect(sceneApi.get<CabinetModuleNode>(wall.id)?.width).toBeCloseTo(0.6)
    expect(sceneApi.get<CabinetModuleNode>(wall.id)?.position[2]).toBeCloseTo(-0.14)
    expect(sceneApi.get<CabinetNode>(run.id)?.metadata).toMatchObject({
      cabinetLayoutRevision: 1,
    })
  })

  test('does not offer equalization when a run has fewer than two standard base modules', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_equalize-single-run',
      children: ['cabinet-module_equalize-single'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_equalize-single',
      parentId: run.id,
      width: 0.6,
      moduleKind: 'corner-filler',
    })
    const nodes = {
      [run.id]: run,
      [module.id]: module,
    } as Record<AnyNodeId, AnyNode>

    expect(cabinetRunWidthEqualizationPlan(run, nodes)).toEqual({
      ok: false,
      reason: 'not-enough-modules',
    })
  })
})
