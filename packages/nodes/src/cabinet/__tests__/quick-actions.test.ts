import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type SceneApi, WallNode } from '@pascal-app/core'
import { cabinetQuickActions } from '../quick-actions'
import { addCabinetModuleSide, addCornerRun } from '../run-ops'
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
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent && Array.isArray((parent as { children?: unknown }).children)) {
          const children = new Set(((parent as { children?: AnyNodeId[] }).children ?? []).slice())
          children.add(node.id as AnyNodeId)
          nodes[parentId] = { ...parent, children: [...children] } as AnyNode
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

describe('cabinet quick actions', () => {
  test.each([
    'left',
    'right',
  ] as const)('selects the outer base cabinet after an L %s action', (side) => {
    const levelId = `level_quick-actions-select-outer-${side}` as AnyNodeId
    const run = CabinetNode.parse({
      id: `cabinet_run-quick-actions-select-outer-${side}`,
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [`cabinet-module_source-quick-actions-select-outer-${side}`],
    })
    const source = CabinetModuleNode.parse({
      id: `cabinet-module_source-quick-actions-select-outer-${side}`,
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode])
    const action = cabinetQuickActions({ node: source, nodes: sceneApi.nodes() }).find(
      (candidate) => candidate.id === `cabinet:add-corner-${side}`,
    )

    expect(action?.disabled).toBeFalsy()
    const selectedId = action?.run({ sceneApi })?.selectedIds?.[0]
    const selected = selectedId ? sceneApi.get<CabinetModuleNode>(selectedId) : null

    expect(selected?.name).toBe('Base Cabinet')
    expect(selected?.moduleKind).toBe('standard')
  })

  test('offers and runs an L-corner action from run selection using the end module', () => {
    const levelId = 'level_quick_actions_corner' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-corner',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-quick-actions-corner',
        'cabinet-module_right-quick-actions-corner',
      ],
    })
    const leftModule = CabinetModuleNode.parse({
      id: 'cabinet-module_left-quick-actions-corner',
      parentId: run.id,
      position: [-0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-left-quick-actions-corner', type: 'door', shelfCount: 2 }],
    })
    const rightModule = CabinetModuleNode.parse({
      id: 'cabinet-module_right-quick-actions-corner',
      parentId: run.id,
      position: [0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-right-quick-actions-corner', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_quick-actions-corner-blocker',
      parentId: levelId,
      start: [-1, 0.95],
      end: [3, 0.95],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      leftModule as AnyNode,
      rightModule as AnyNode,
      blockingWall as AnyNode,
    ])

    const actions = cabinetQuickActions({
      node: run,
      nodes: sceneApi.nodes(),
    })
    const cornerAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(cornerAction).toBeTruthy()
    const result = cornerAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
    expect(sceneApi.get<CabinetModuleNode>(rightModule.id)?.width).toBeLessThan(0.9)
  })

  test('offers L Right with Right on the outer end of an extended right-corner leg', () => {
    const levelId = 'level_quick_actions_extended-leg-right-action' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-extended-leg-right-action',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-quick-actions-extended-leg-right-action'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-quick-actions-extended-leg-right-action',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [
        { id: 'door-source-quick-actions-extended-leg-right-action', type: 'door', shelfCount: 2 },
      ],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode])
    const firstSelectedId = addCornerRun({ module: source, run, sceneApi, side: 'right' })!
    const firstSelectedModule = sceneApi.get<CabinetModuleNode>(firstSelectedId)!
    const firstDerivedRun = sceneApi.get<CabinetNode>(firstSelectedModule.parentId as AnyNodeId)!
    const extendedId = addCabinetModuleSide({
      anchorModule: firstSelectedModule,
      run: firstDerivedRun,
      sceneApi,
      side: 'right',
    })!
    const extendedModule = sceneApi.get<CabinetModuleNode>(extendedId)!

    const actions = cabinetQuickActions({
      node: extendedModule,
      nodes: sceneApi.nodes(),
    })
    const cornerAction = actions.find((action) => action.id === 'cabinet:add-corner-right')
    const oppositeCornerAction = actions.find((action) => action.id === 'cabinet:add-corner-left')

    expect(actions.some((action) => action.id === 'cabinet:add-right')).toBe(true)
    expect(oppositeCornerAction?.disabled).toBe(true)
    expect(cornerAction?.label).toBe('L Right')
    expect(cornerAction?.disabled).toBeFalsy()
    const result = cornerAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
  })

  test('offers L Left with Left on the outer end of an extended left-corner leg', () => {
    const levelId = 'level_quick_actions_extended-leg-left-action' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-extended-leg-left-action',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-quick-actions-extended-leg-left-action'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-quick-actions-extended-leg-left-action',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [
        { id: 'door-source-quick-actions-extended-leg-left-action', type: 'door', shelfCount: 2 },
      ],
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode])
    const firstSelectedId = addCornerRun({ module: source, run, sceneApi, side: 'left' })!
    const firstSelectedModule = sceneApi.get<CabinetModuleNode>(firstSelectedId)!
    const firstDerivedRun = sceneApi.get<CabinetNode>(firstSelectedModule.parentId as AnyNodeId)!
    const standardModule = firstDerivedRun.children
      .map((id) => sceneApi.get<CabinetModuleNode>(id as AnyNodeId))
      .find((node) => node?.type === 'cabinet-module' && node.moduleKind === 'standard')!
    const extendedId = addCabinetModuleSide({
      anchorModule: standardModule,
      run: firstDerivedRun,
      sceneApi,
      side: 'left',
    })!
    const extendedModule = sceneApi.get<CabinetModuleNode>(extendedId)!

    const actions = cabinetQuickActions({
      node: extendedModule,
      nodes: sceneApi.nodes(),
    })
    const cornerAction = actions.find((action) => action.id === 'cabinet:add-corner-left')
    const oppositeCornerAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(actions.some((action) => action.id === 'cabinet:add-left')).toBe(true)
    expect(oppositeCornerAction?.disabled).toBe(true)
    expect(cornerAction?.label).toBe('L Left')
    expect(cornerAction?.disabled).toBeFalsy()
    const result = cornerAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
  })

  test('runs L Left from the floating action and trims against a left wall', () => {
    const levelId = 'level_quick_actions_left-wall-corner' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-left-wall-corner',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-quick-actions-left-wall-corner'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-quick-actions-left-wall-corner',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-quick-actions-left-wall-corner', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_quick-actions-left-corner-blocker',
      parentId: levelId,
      start: [-0.82, -1],
      end: [-0.82, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, blockingWall as AnyNode])

    const actions = cabinetQuickActions({
      node: source,
      nodes: sceneApi.nodes(),
    })
    const cornerAction = actions.find((action) => action.id === 'cabinet:add-corner-left')

    expect(cornerAction?.label).toBe('L Left')
    const result = cornerAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
    expect(sceneApi.get<CabinetModuleNode>(source.id)?.width).toBeCloseTo(0.67)
  })

  test('disables blocked side and corner actions instead of hiding them', () => {
    const levelId = 'level_quick_actions_disabled-blocked-side' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-disabled-blocked-side',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-quick-actions-disabled-blocked-side',
        'cabinet-module_right-quick-actions-disabled-blocked-side',
      ],
    })
    const leftModule = CabinetModuleNode.parse({
      id: 'cabinet-module_left-quick-actions-disabled-blocked-side',
      parentId: run.id,
      position: [-0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-left-quick-actions-disabled-blocked-side', type: 'door', shelfCount: 2 }],
    })
    const rightModule = CabinetModuleNode.parse({
      id: 'cabinet-module_right-quick-actions-disabled-blocked-side',
      parentId: run.id,
      position: [0.45, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [
        { id: 'door-right-quick-actions-disabled-blocked-side', type: 'door', shelfCount: 2 },
      ],
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      leftModule as AnyNode,
      rightModule as AnyNode,
    ])

    const actions = cabinetQuickActions({
      node: leftModule,
      nodes: sceneApi.nodes(),
    })
    const moduleCountBefore = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetModuleNode => node.type === 'cabinet-module',
    ).length
    const rightAction = actions.find((action) => action.id === 'cabinet:add-right')
    const cornerRightAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(rightAction?.disabled).toBe(true)
    expect(cornerRightAction?.disabled).toBe(true)
    expect(rightAction?.run({ sceneApi })).toBeUndefined()
    expect(cornerRightAction?.run({ sceneApi })).toBeUndefined()
    expect(
      Object.values(sceneApi.nodes()).filter(
        (node): node is CabinetModuleNode => node.type === 'cabinet-module',
      ),
    ).toHaveLength(moduleCountBefore)
  })

  test('disables wall-blocked side add while keeping shrinkable L action enabled', () => {
    const levelId = 'level_quick_actions_disabled-wall-side' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-disabled-wall-side',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-quick-actions-disabled-wall-side'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-quick-actions-disabled-wall-side',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-source-quick-actions-disabled-wall-side', type: 'door', shelfCount: 2 }],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_quick-actions-disabled-wall-side',
      parentId: levelId,
      start: [0.6, -1],
      end: [0.6, 1],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, blockingWall as AnyNode])

    const actions = cabinetQuickActions({
      node: source,
      nodes: sceneApi.nodes(),
    })
    const rightAction = actions.find((action) => action.id === 'cabinet:add-right')
    const cornerRightAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(rightAction?.disabled).toBe(true)
    expect(cornerRightAction?.disabled).toBeFalsy()
  })

  test('disables L action when the corner preview has no usable width', () => {
    const levelId = 'level_quick_actions_disabled-corner-wall' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-disabled-corner-wall',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_source-quick-actions-disabled-corner-wall'],
    })
    const source = CabinetModuleNode.parse({
      id: 'cabinet-module_source-quick-actions-disabled-corner-wall',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [
        { id: 'door-source-quick-actions-disabled-corner-wall', type: 'door', shelfCount: 2 },
      ],
    })
    const blockingWall = WallNode.parse({
      id: 'wall_quick-actions-disabled-corner-wall',
      parentId: levelId,
      start: [-1, 0.55],
      end: [2, 0.55],
      thickness: 0.2,
    })
    const sceneApi = sceneApiFixture([run as AnyNode, source as AnyNode, blockingWall as AnyNode])

    const actions = cabinetQuickActions({
      node: source,
      nodes: sceneApi.nodes(),
    })
    const cornerRightAction = actions.find((action) => action.id === 'cabinet:add-corner-right')

    expect(cornerRightAction?.disabled).toBe(true)
    expect(cornerRightAction?.run({ sceneApi })).toBeUndefined()
  })

  test('runs L Left with an existing right corner and walls on both sides', () => {
    const levelId = 'level_quick-actions-two-wall-left-corner' as AnyNodeId
    const run = CabinetNode.parse({
      id: 'cabinet_run-quick-actions-two-wall-left-corner',
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      children: [
        'cabinet-module_left-quick-actions-two-wall-left-corner',
        'cabinet-module_mid-quick-actions-two-wall-left-corner',
        'cabinet-module_right-quick-actions-two-wall-left-corner',
      ],
    })
    const left = CabinetModuleNode.parse({
      id: 'cabinet-module_left-quick-actions-two-wall-left-corner',
      parentId: run.id,
      position: [-0.9, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-left-quick-actions-two-wall-left-corner', type: 'door', shelfCount: 2 }],
    })
    const middle = CabinetModuleNode.parse({
      id: 'cabinet-module_mid-quick-actions-two-wall-left-corner',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
    })
    const right = CabinetModuleNode.parse({
      id: 'cabinet-module_right-quick-actions-two-wall-left-corner',
      parentId: run.id,
      position: [0.9, 0.1, 0],
      width: 0.9,
      depth: 0.58,
      carcassHeight: 0.72,
      stack: [{ id: 'door-right-quick-actions-two-wall-left-corner', type: 'door', shelfCount: 2 }],
    })
    const sceneApi = sceneApiFixture([
      run as AnyNode,
      left as AnyNode,
      middle as AnyNode,
      right as AnyNode,
    ])
    expect(addCornerRun({ module: right, run, sceneApi, side: 'right' })).toBeTruthy()
    sceneApi.upsert(
      WallNode.parse({
        id: 'wall_quick-actions-two-wall-left-side',
        parentId: levelId,
        start: [-1.3, -1],
        end: [-1.3, 1],
        thickness: 0.2,
      }) as AnyNode,
    )
    sceneApi.upsert(
      WallNode.parse({
        id: 'wall_quick-actions-two-wall-right-side',
        parentId: levelId,
        start: [1.3, -1],
        end: [1.3, 1],
        thickness: 0.2,
      }) as AnyNode,
    )

    const actions = cabinetQuickActions({
      node: sceneApi.get<CabinetModuleNode>(left.id)!,
      nodes: sceneApi.nodes(),
    })
    const cornerLeftAction = actions.find((action) => action.id === 'cabinet:add-corner-left')

    expect(cornerLeftAction?.disabled).toBeFalsy()
    const result = cornerLeftAction!.run({ sceneApi })

    expect(result?.selectedIds?.length).toBe(1)
    expect(sceneApi.get<CabinetModuleNode>(left.id)?.width).toBeCloseTo(0.25)
  })
})
