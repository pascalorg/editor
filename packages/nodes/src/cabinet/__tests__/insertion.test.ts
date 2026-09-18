import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SceneApi } from '@pascal-app/core'
import { applyCabinetModuleInsertion } from '../insertion'
import { planRunModuleInsertion, type RunWallConstraints } from '../run-layout'
import { cornerPinnedEndsForRun } from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'

type TestModule = {
  id: string
  position: [number, number, number]
  width: number
}

const fixedRun: RunWallConstraints = {
  left: { constrained: true, slack: 0 },
  right: { constrained: true, slack: 0 },
}

function module(id: string, x: number, width = 0.5): TestModule {
  return { id, position: [x, 0.1, 0], width }
}

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
        if (parent?.type === 'cabinet') {
          nodes[parentId] = {
            ...parent,
            children: [...new Set([...(parent.children ?? []), node.id as AnyNodeId])],
          }
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

describe('run module insertion planning', () => {
  test('inserts into an existing gap without moving neighbors', () => {
    const left = module('left', 0.25)
    const right = module('right', 1.25)
    const result = planRunModuleInsertion({
      modules: [left, right],
      insertion: module('new', 0.75, 0.4),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pushedSide).toBeNull()
    expect(result.inserted.position[0]).toBeCloseTo(0.75)
    expect(result.modules).toEqual([
      { id: 'left', position: [0.25, 0.1, 0], width: 0.5 },
      { id: 'right', position: [1.25, 0.1, 0], width: 0.5 },
    ])
  })

  test('anchors an insertion to the run edge instead of the cursor position', () => {
    const modules = [module('left', 0.25), module('right', 1.25)]
    const leftAnchored = planRunModuleInsertion({
      modules,
      insertion: module('new-left', 0.7, 0.4),
      anchorInsertionSide: 'left',
    })
    const sameGapDifferentCursor = planRunModuleInsertion({
      modules,
      insertion: module('new-right', 0.8, 0.4),
      anchorInsertionSide: 'left',
    })

    expect(leftAnchored.ok).toBe(true)
    expect(sameGapDifferentCursor.ok).toBe(true)
    if (!leftAnchored.ok || !sameGapDifferentCursor.ok) return
    expect(leftAnchored.inserted.position[0]).toBeCloseTo(0.7)
    expect(sameGapDifferentCursor.inserted.position[0]).toBeCloseTo(0.7)
  })

  test('pushes the right side of a full run apart', () => {
    const result = planRunModuleInsertion({
      modules: [module('left', 0.25), module('right', 0.75)],
      insertion: module('new', 0.5),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pushedSide).toBe('right')
    expect(result.inserted.position[0]).toBeCloseTo(0.75)
    expect(result.modules.find((entry) => entry.id === 'right')?.position[0]).toBeCloseTo(1.25)
  })

  test('keeps an oversized insertion in its selected slot when neighbor widths differ', () => {
    const left = module('left', 0.3, 0.6)
    const right = module('right', 0.7, 0.05)
    const result = planRunModuleInsertion({
      modules: [left, right],
      insertion: module('new', 0.61, 0.35),
      anchorInsertionSide: 'left',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inserted.position[0]).toBeCloseTo(0.775)
    expect(result.modules.find((entry) => entry.id === 'right')?.position[0]).toBeGreaterThan(0.7)
    expect(result.modules.find((entry) => entry.id === 'left')?.position[0]).toBeCloseTo(0.3)
  })

  test('keeps a right-pinned oversized insertion in its selected slot', () => {
    const left = module('left', 0.3, 0.6)
    const right = module('right', 0.7, 0.05)
    const result = planRunModuleInsertion({
      modules: [left, right],
      insertion: module('new', 0.61, 0.35),
      preserveEnds: { right: true },
      anchorInsertionSide: 'right',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inserted.position[0]).toBeCloseTo(0.5)
    expect(result.modules.find((entry) => entry.id === 'left')?.position[0]).toBeLessThan(0.3)
    expect(result.modules.find((entry) => entry.id === 'right')?.position[0]).toBeCloseTo(0.7)
  })

  test('does not enlarge a narrow filler while absorbing a fixed-run insertion', () => {
    const result = planRunModuleInsertion({
      modules: [
        module('left', 0.025, 0.05),
        module('middle', 0.075, 0.05),
        module('filler', 0.15, 0.1),
      ],
      insertion: module('new', 0.06, 0.05),
      wallConstraints: fixedRun,
      fillerIds: new Set(['filler']),
      anchorInsertionSide: 'left',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shrunkFillerIds).toEqual(['filler'])
    expect(result.modules.find((entry) => entry.id === 'filler')?.width).toBeCloseTo(0.05)
    const all = [...result.modules, result.inserted].sort((a, b) => a.position[0] - b.position[0])
    expect(all.at(-1)!.position[0] + all.at(-1)!.width / 2).toBeCloseTo(0.2)
  })

  test('keeps a pinned corner end in place while pushing the opposite side', () => {
    const corner = CabinetModuleNode.parse({
      id: 'cabinet-module_insertion-corner',
      position: [0.75, 0.1, 0],
      width: 0.5,
      metadata: {
        cabinetCornerSourceLink: {
          side: 'right',
          linkedRunIds: ['cabinet_insertion-corner-run'],
        },
      },
    })
    const result = planRunModuleInsertion({
      modules: [module('left', 0.25), corner],
      insertion: module('new', 0.5),
      preserveEnds: cornerPinnedEndsForRun([corner]),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pushedSide).toBe('left')
    expect(result.inserted.position[0]).toBeCloseTo(0.25)
    expect(result.modules.find((entry) => entry.id === corner.id)?.position[0]).toBeCloseTo(0.75)
    expect(result.modules.find((entry) => entry.id === 'left')?.position[0]).toBeCloseTo(-0.25)
  })

  test('shrinks a filler when a fixed run has no movement slack', () => {
    const filler = module('filler', 0.8, 0.6)
    const result = planRunModuleInsertion({
      modules: [module('left', 0.25), filler, module('right', 1.35)],
      insertion: module('new', 0.5),
      wallConstraints: fixedRun,
      fillerIds: new Set(['filler']),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shrunkFillerIds).toEqual(['filler'])
    expect(result.modules.find((entry) => entry.id === 'filler')?.width).toBeCloseTo(0.1)
    expect(result.inserted.width).toBeCloseTo(0.5)
  })

  test('rejects a fixed run when no filler can absorb the insertion', () => {
    const result = planRunModuleInsertion({
      modules: [module('left', 0.25), module('right', 0.75)],
      insertion: module('new', 0.5),
      wallConstraints: fixedRun,
    })

    expect(result).toEqual({ ok: false, reason: 'no-space' })
  })

  test('rejects invalid and duplicate insertions before planning', () => {
    expect(
      planRunModuleInsertion({
        modules: [module('left', 0.25)],
        insertion: module('new', 0, 0),
      }),
    ).toEqual({ ok: false, reason: 'invalid-width' })
    expect(
      planRunModuleInsertion({
        modules: [module('left', 0.25)],
        insertion: module('left', 0.75),
      }),
    ).toEqual({ ok: false, reason: 'duplicate-id' })
  })

  test('applies the planned neighbors and inserts the new module atomically', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_insertion-commit-run',
      children: ['cabinet-module_insertion-commit-left', 'cabinet-module_insertion-commit-right'],
      width: 1,
      showPlinth: true,
      plinthHeight: 0.1,
      withCountertop: true,
      countertopThickness: 0.04,
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_insertion-commit-left',
      parentId: run.id,
      position: [0.25, 0.1, 0],
      width: 0.5,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_insertion-commit-right',
      parentId: run.id,
      position: [0.75, 0.1, 0],
      width: 0.5,
    })
    const sceneApi = sceneApiFixture([run, left, right])
    const inserted = CabinetModuleNode.parse({
      id: 'cabinet-module_insertion-commit-new',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.5,
      showPlinth: true,
      plinthHeight: 0.1,
      withCountertop: true,
      countertopThickness: 0.04,
    })

    const id = applyCabinetModuleInsertion({
      module: inserted,
      plan: {
        modules: [
          { id: left.id as AnyNodeId, position: [0.25, 0.1, 0], width: 0.5 },
          { id: right.id as AnyNodeId, position: [1.25, 0.1, 0], width: 0.5 },
        ],
        inserted: { position: [0.75, 0.1, 0], width: 0.5 },
      },
      run,
      sceneApi,
    })

    expect(id).toBe(inserted.id)
    expect(sceneApi.get<CabinetModuleNode>(right.id)?.position[0]).toBeCloseTo(1.25)
    expect(sceneApi.get<CabinetModuleNode>(inserted.id)?.position[0]).toBeCloseTo(0.75)
    expect(sceneApi.get<CabinetModuleNode>(inserted.id)?.showPlinth).toBe(false)
    expect(sceneApi.get<CabinetModuleNode>(inserted.id)?.withCountertop).toBe(false)
    expect(sceneApi.get<CabinetModuleNode>(inserted.id)?.plinthHeight).toBeCloseTo(0.1)
    expect(sceneApi.get<CabinetModuleNode>(inserted.id)?.countertopThickness).toBe(0)
    expect(sceneApi.get<CabinetNode>(run.id)?.children).toEqual([left.id, inserted.id, right.id])
    expect(sceneApi.get<CabinetNode>(run.id)?.width).toBeCloseTo(1.5)
  })
})
