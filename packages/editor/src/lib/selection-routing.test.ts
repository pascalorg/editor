import { describe, expect, test } from 'bun:test'
import { type AnyNode, BlockNode, nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import useEditor from '../store/use-editor'
import {
  deleteNodeFromCanvas,
  enterBuildingFromCanvas,
  enterBuildingFromPlanHit,
  resolveCanvasBuildingId,
  resolveCanvasSelectionNode,
  resolveSelectedIdsForNodeClick,
  selectionModifiersFromEvent,
  shouldPreserveSelectedRoofHostTarget,
} from './selection-routing'

describe('building entry from either canvas', () => {
  test('a Site hit enters the owning building before selecting an element', () => {
    const previousScene = useScene.getState()
    const previousSelection = useViewer.getState().selection
    const previousEditor = useEditor.getState()
    const building = { id: 'building_pick', type: 'building', children: ['level_pick'] }
    const level = {
      id: 'level_pick',
      type: 'level',
      level: 0,
      parentId: building.id,
      children: ['wall_pick'],
    }
    const wall = { id: 'wall_pick', type: 'wall', parentId: level.id }
    const shelf = { id: 'shelf_pick', type: 'shelf', parentId: wall.id }
    const elevator = { id: 'elevator_pick', type: 'elevator', parentId: building.id }
    const nodes = Object.fromEntries(
      [building, level, wall, shelf, elevator].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    try {
      useScene.setState({ nodes: nodes as never, rootNodeIds: [building.id as never] })
      for (const hit of [wall, shelf, elevator]) {
        useEditor.getState().setPhase('site')
        useEditor.getState().armToolMode({ mode: 'select' })
        const node = nodes[hit.id]!
        expect(resolveCanvasBuildingId(node, nodes)).toBe(building.id as never)
        expect(enterBuildingFromCanvas(node)).toBe(true)
        expect(useEditor.getState().phase).toBe('building')
        expect(useViewer.getState().selection).toMatchObject({
          buildingId: building.id,
          levelId: level.id,
          selectedIds: [],
        })
        useViewer.getState().setSelection({ selectedIds: [wall.id as never] })
        expect(enterBuildingFromCanvas(node)).toBe(false)
        expect(useViewer.getState().selection.selectedIds).toEqual([wall.id])
      }
      useEditor.getState().setPhase('site')
      useEditor.getState().armToolMode({ mode: 'build', tool: 'item' })
      expect(enterBuildingFromCanvas(nodes[wall.id]!)).toBe(false)
      expect(useEditor.getState().phase).toBe('site')
    } finally {
      useScene.setState(previousScene)
      useViewer.setState({ selection: previousSelection })
      useEditor.setState(previousEditor)
    }
  })

  test('a 2D plan click from Site on a wall picks the whole building; bare ground stays in Site', () => {
    const previousScene = useScene.getState()
    const previousSelection = useViewer.getState().selection
    const previousEditor = useEditor.getState()
    const building = { id: 'building_plan', type: 'building', children: ['level_plan'] }
    const level = { id: 'level_plan', type: 'level', level: 0, parentId: building.id, children: [] }
    const wall = { id: 'wall_plan', type: 'wall', parentId: level.id }
    const spawn = { id: 'spawn_plan', type: 'spawn', parentId: level.id }
    const ground = { id: 'surface-material_plan', type: 'surface-material', parentId: 'site_plan' }
    const siteFence = { id: 'fence_plan', type: 'fence', parentId: 'site_plan' }
    const nodes = Object.fromEntries(
      [building, level, wall, spawn, ground, siteFence].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    try {
      useScene.setState({ nodes: nodes as never, rootNodeIds: [building.id as never] })
      useViewer.getState().setSelection({ buildingId: null })
      useEditor.getState().setPhase('site')
      useEditor.getState().armToolMode({ mode: 'select' })
      for (const hit of [null, 'missing_plan', ground.id, siteFence.id]) {
        expect(enterBuildingFromPlanHit(hit)).toBe(false)
        expect(useEditor.getState().phase).toBe('site')
      }
      expect(enterBuildingFromPlanHit(wall.id)).toBe(true)
      expect(useEditor.getState().phase).toBe('building')
      expect(useViewer.getState().selection).toMatchObject({
        buildingId: building.id,
        selectedIds: [],
      })
      // Inside the building the same hit is an ordinary selection again.
      expect(enterBuildingFromPlanHit(wall.id)).toBe(false)
      useEditor.getState().setPhase('site')
      expect(enterBuildingFromPlanHit(spawn.id)).toBe(true)
      expect(useViewer.getState().selection).toMatchObject({
        buildingId: building.id,
        selectedIds: [],
      })
    } finally {
      useScene.setState(previousScene)
      useViewer.setState({ selection: previousSelection })
      useEditor.setState(previousEditor)
    }
  })
})

function registerTestDefinition(kind: string, overrides: Record<string, unknown> = {}) {
  if (nodeRegistry.has(kind)) return
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'furnish',
    defaults: () => ({ type: kind }) as never,
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  } as never)
}

describe('resolveSelectedIdsForNodeClick', () => {
  test('preserves the pre-routing selection when a phase switch clears current ids', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        baseSelectedIds: ['wall_1'],
        currentSelectedIds: [],
        modifierKeys: { meta: true, ctrl: false, shift: false, alt: false },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1', 'item_1'])
  })

  test('toggles from the pre-routing selection while a modifier is held', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        baseSelectedIds: ['wall_1', 'item_1'],
        currentSelectedIds: [],
        modifierKeys: { meta: false, ctrl: false, shift: true, alt: false },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1'])
  })

  test('plain click expands session groups', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        currentSelectedIds: [],
        modifierKeys: { meta: false, ctrl: false, shift: false, alt: false },
        nodeId: 'item_2',
        expandIdsForNode: () => ['item_2', 'item_1'],
      }),
    ).toEqual(['item_2', 'item_1'])
  })
})

describe('deleteNodeFromCanvas', () => {
  test('deletes the clicked plan node and clears the selection', () => {
    const node = BlockNode.parse({ id: 'block_floorplan-delete-target' })
    const previousScene = useScene.getState()
    const previousSelection = useViewer.getState().selection

    try {
      useScene.setState({
        nodes: { [node.id]: node },
        rootNodeIds: [node.id],
        readOnly: false,
      })
      useViewer.getState().setSelection({ selectedIds: [node.id] })

      deleteNodeFromCanvas(node)

      expect(useScene.getState().nodes[node.id]).toBeUndefined()
      expect(useViewer.getState().selection.selectedIds).toEqual([])
    } finally {
      useScene.setState(previousScene)
      useViewer.setState({ selection: previousSelection })
    }
  })

  test('preserves a plan node and its selection when the scene is read-only', () => {
    const node = BlockNode.parse({ id: 'block_floorplan-read-only-target' })
    const previousScene = useScene.getState()
    const previousSelection = useViewer.getState().selection

    try {
      useScene.setState({
        nodes: { [node.id]: node },
        rootNodeIds: [node.id],
        readOnly: true,
      })
      useViewer.getState().setSelection({ selectedIds: [node.id] })

      deleteNodeFromCanvas(node)

      expect(useScene.getState().nodes[node.id]).toEqual(node)
      expect(useViewer.getState().selection.selectedIds).toEqual([node.id])
    } finally {
      useScene.setState(previousScene)
      useViewer.setState({ selection: previousSelection })
    }
  })
})

describe('selectionModifiersFromEvent', () => {
  test('falls back to tracked modifier state when the click event omits keys', () => {
    expect(
      selectionModifiersFromEvent({}, { meta: false, ctrl: true, shift: false, alt: false }),
    ).toEqual({
      meta: false,
      ctrl: true,
      shift: false,
      alt: false,
    })
  })

  test('prefers explicit event key state over stale tracked modifiers', () => {
    expect(
      selectionModifiersFromEvent(
        { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
        { meta: true, ctrl: true, shift: true, alt: true },
      ),
    ).toEqual({
      meta: false,
      ctrl: false,
      shift: false,
      alt: false,
    })
  })
})

describe('resolveCanvasSelectionNode', () => {
  // Mirrors the cabinet-module setup: modules proxy to their run for grouped
  // move / rotate, but declare `selectionProxy.bypassDirectPick` so a direct
  // body click selects the clicked module.
  const groupKind = 'selection-routing-proxy-group-test'
  const memberKind = 'selection-routing-proxy-member-test'

  function registerBypassKinds() {
    registerTestDefinition(groupKind)
    registerTestDefinition(memberKind, {
      selectionProxy: {
        bypassDirectPick: (node: AnyNode, proxyTarget: AnyNode) =>
          (node.type as string) === memberKind && (proxyTarget.type as string) === groupKind,
      },
    })
  }

  test('keeps proxied members individually selectable when the kind declares bypassDirectPick', () => {
    registerBypassKinds()
    const run = { id: 'group_run', type: groupKind, metadata: {} } as unknown as AnyNode
    const module = {
      id: 'group_member',
      type: memberKind,
      parentId: run.id,
      metadata: { nodeSelectionProxyId: run.id },
    } as unknown as AnyNode

    expect(
      resolveCanvasSelectionNode({
        node: module,
        nodes: {
          [run.id]: run,
          [module.id]: module,
        },
        selectedIds: [],
      }),
    ).toBe(module)
  })

  test('keeps nested proxied members leaf-selectable by default', () => {
    registerBypassKinds()
    const rootRun = { id: 'group_root_run', type: groupKind, metadata: {} } as unknown as AnyNode
    const legRun = {
      id: 'group_leg_run',
      type: groupKind,
      parentId: rootRun.id,
      metadata: { nodeSelectionProxyId: rootRun.id },
    } as unknown as AnyNode
    const nestedCornerBase = {
      id: 'group_nested_member',
      type: memberKind,
      parentId: legRun.id,
      metadata: { nodeSelectionProxyId: legRun.id },
    } as unknown as AnyNode

    expect(
      resolveCanvasSelectionNode({
        node: nestedCornerBase,
        nodes: {
          [rootRun.id]: rootRun,
          [legRun.id]: legRun,
          [nestedCornerBase.id]: nestedCornerBase,
        },
        selectedIds: [],
      }),
    ).toBe(nestedCornerBase)
  })

  test('follows the proxy when the kind declares no bypass', () => {
    const kind = 'selection-routing-proxy-no-bypass-test'
    registerTestDefinition(kind)
    const group = { id: 'plain_group', type: kind, metadata: {} } as unknown as AnyNode
    const member = {
      id: 'plain_member',
      type: kind,
      parentId: group.id,
      metadata: { nodeSelectionProxyId: group.id },
    } as unknown as AnyNode

    expect(
      resolveCanvasSelectionNode({
        node: member,
        nodes: {
          [group.id]: group,
          [member.id]: member,
        },
        selectedIds: [],
      }),
    ).toBe(group)
  })

  test('keeps parent-frame children routed to their parent when that parent is solely selected', () => {
    const kind = 'selection-routing-parent-frame-test'
    registerTestDefinition(kind, {
      capabilities: {
        movable: {
          axes: ['x', 'z'],
          gridSnap: true,
          parentFrame: {
            resolveParent: (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) =>
              (node.parentId ? nodes[node.parentId] : null) ?? null,
          },
        },
      },
    })

    const parent = { id: 'parent_1', type: groupKind, metadata: {} } as unknown as AnyNode
    const child = {
      id: 'child_1',
      type: kind,
      parentId: parent.id,
      metadata: {},
    } as unknown as AnyNode

    expect(
      resolveCanvasSelectionNode({
        node: child,
        nodes: {
          [parent.id]: parent,
          [child.id]: child,
        },
        selectedIds: [parent.id],
      }),
    ).toBe(parent)
  })

  test('prefers an explicit selection proxy before parent-frame routing', () => {
    const kind = 'selection-routing-proxy-before-parent-frame-test'
    registerTestDefinition(kind, {
      capabilities: {
        movable: {
          axes: ['x', 'z'],
          gridSnap: true,
          parentFrame: {
            resolveParent: (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) =>
              (node.parentId ? nodes[node.parentId] : null) ?? null,
          },
        },
      },
    })

    const root = { id: 'root_1', type: groupKind, metadata: {} } as unknown as AnyNode
    const proxyGroup = { id: 'proxy_1', type: groupKind, metadata: {} } as unknown as AnyNode
    const child = {
      id: 'child_proxy_1',
      type: kind,
      parentId: root.id,
      metadata: { nodeSelectionProxyId: proxyGroup.id },
    } as unknown as AnyNode

    expect(
      resolveCanvasSelectionNode({
        node: child,
        nodes: {
          [root.id]: root,
          [proxyGroup.id]: proxyGroup,
          [child.id]: child,
        },
        selectedIds: [root.id],
      }),
    ).toBe(proxyGroup)
  })

  test('routes proxied lean-to roof children to the owning extension', () => {
    const leanTo = {
      id: 'lean_to_1',
      type: 'lean-to-extension',
      metadata: {},
    } as unknown as AnyNode
    const roof = {
      id: 'roof_lean_to',
      type: 'roof',
      parentId: leanTo.id,
      metadata: {
        managedByLeanTo: leanTo.id,
        leanToRole: 'roof',
        nodeSelectionProxyId: leanTo.id,
      },
    } as unknown as AnyNode
    const segment = {
      id: 'rseg_lean_to',
      type: 'roof-segment',
      parentId: roof.id,
      metadata: {
        managedByLeanTo: leanTo.id,
        leanToRole: 'roof-segment',
        nodeSelectionProxyId: leanTo.id,
      },
    } as unknown as AnyNode

    const nodes = {
      [leanTo.id]: leanTo,
      [roof.id]: roof,
      [segment.id]: segment,
    }

    expect(resolveCanvasSelectionNode({ node: roof, nodes, selectedIds: [] })).toBe(leanTo)
    expect(resolveCanvasSelectionNode({ node: segment, nodes, selectedIds: [] })).toBe(leanTo)
  })
})

describe('shouldPreserveSelectedRoofHostTarget', () => {
  test('keeps the roof host target while that roof is the sole armed selection', () => {
    const node = { id: 'roof_1', type: 'roof' } as unknown as AnyNode

    expect(
      shouldPreserveSelectedRoofHostTarget({
        node,
        selectedIds: ['roof_1'],
        armedRoofId: 'roof_1',
      }),
    ).toBe(true)
  })

  test('falls back to segment targeting when the roof host is not armed', () => {
    const node = { id: 'roof_1', type: 'roof' } as unknown as AnyNode

    expect(
      shouldPreserveSelectedRoofHostTarget({
        node,
        selectedIds: ['roof_1'],
        armedRoofId: null,
      }),
    ).toBe(false)
  })

  test('falls back to segment targeting when the roof is no longer the sole selection', () => {
    const node = { id: 'roof_1', type: 'roof' } as unknown as AnyNode

    expect(
      shouldPreserveSelectedRoofHostTarget({
        node,
        selectedIds: ['roof_1', 'wall_1'],
        armedRoofId: 'roof_1',
      }),
    ).toBe(false)
  })
})
