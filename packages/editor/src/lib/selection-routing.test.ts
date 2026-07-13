import { describe, expect, test } from 'bun:test'
import { type AnyNode, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import {
  resolveCanvasSelectionNode,
  resolveNodeSelectionTarget,
  resolveSelectedIdsForNodeClick,
  selectionModifiersFromEvent,
  shouldPreserveSelectedRoofHostTarget,
} from './selection-routing'

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
        modifierKeys: { meta: true, ctrl: false, shift: false },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1', 'item_1'])
  })

  test('toggles from the pre-routing selection while a modifier is held', () => {
    expect(
      resolveSelectedIdsForNodeClick({
        baseSelectedIds: ['wall_1', 'item_1'],
        currentSelectedIds: [],
        modifierKeys: { meta: false, ctrl: false, shift: true },
        nodeId: 'item_1',
      }),
    ).toEqual(['wall_1'])
  })
})

describe('selectionModifiersFromEvent', () => {
  test('falls back to tracked modifier state when the click event omits keys', () => {
    expect(selectionModifiersFromEvent({}, { meta: false, ctrl: true, shift: false })).toEqual({
      meta: false,
      ctrl: true,
      shift: false,
    })
  })

  test('prefers explicit event key state over stale tracked modifiers', () => {
    expect(
      selectionModifiersFromEvent(
        { metaKey: false, ctrlKey: false, shiftKey: false },
        { meta: true, ctrl: true, shift: true },
      ),
    ).toEqual({
      meta: false,
      ctrl: false,
      shift: false,
    })
  })
})

describe('resolveNodeSelectionTarget', () => {
  test('routes furniture items to furnish', () => {
    const node = {
      id: 'item_1',
      type: 'item',
      asset: { category: 'furniture' },
    } as unknown as AnyNode

    expect(resolveNodeSelectionTarget(node)).toEqual({ phase: 'furnish' })
  })

  test('routes door and window catalog items to structure', () => {
    const node = {
      id: 'item_1',
      type: 'item',
      asset: { category: 'door' },
    } as unknown as AnyNode

    expect(resolveNodeSelectionTarget(node)).toEqual({
      phase: 'structure',
      structureLayer: 'elements',
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
