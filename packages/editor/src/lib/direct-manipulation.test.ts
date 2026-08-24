import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  DEFAULT_ANGLE_STEP,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { z } from 'zod'
import {
  canDirectMoveNode,
  resolveDirectManipulationNode,
  resolveDirectRotationDragDelta,
  resolveHandlePortalTargetId,
  resolveMoveActionNode,
  shouldShowMoveCrossHandle,
  snapDirectRotationDelta,
} from './direct-manipulation'

function registerTestDefinition(kind: string, overrides: Partial<AnyNodeDefinition>) {
  if (nodeRegistry.has(kind)) return
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'structure',
    defaults: () => ({ type: kind }) as never,
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  } as AnyNodeDefinition)
}

describe('snapDirectRotationDelta', () => {
  test('snaps rotation deltas to the default angle increment', () => {
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.49, false)).toBe(0)
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.51, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * -1.49, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps the raw rotation delta while free-rotating', () => {
    const rawDelta = DEFAULT_ANGLE_STEP * 0.42
    expect(snapDirectRotationDelta(rawDelta, true)).toBe(rawDelta)
  })
})

describe('resolveDirectRotationDragDelta', () => {
  test('maps horizontal pointer motion to the direct rotation delta direction', () => {
    const radiansPerPixel = DEFAULT_ANGLE_STEP / 12

    expect(resolveDirectRotationDragDelta(100, 112, radiansPerPixel, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
    expect(resolveDirectRotationDragDelta(100, 88, radiansPerPixel, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps unsnapped drag deltas while free-rotating', () => {
    expect(resolveDirectRotationDragDelta(100, 103, 0.1, true)).toBeCloseTo(-0.3)
  })
})

describe('canDirectMoveNode', () => {
  // Accepts kinds with a 3D-mountable move tool (`movable` or
  // `affordanceTools.move`); floorplan-only movers (zone) are excluded.
  test('rejects floorplan-only move targets (no 3D tool mounts)', () => {
    const kind = 'direct-move-floorplan-only-test'
    registerTestDefinition(kind, { floorplanMoveTarget: {} as never })

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
  })

  test('rejects MEP kinds that own move through bespoke selection affordances', () => {
    for (const kind of [
      'duct-segment',
      'duct-fitting',
      'pipe-segment',
      'pipe-fitting',
      'lineset',
      'liquid-line',
    ]) {
      expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
    }
  })

  test('accepts kinds with a bespoke move tool', () => {
    const kind = 'direct-move-bespoke-tool-test'
    registerTestDefinition(kind, {
      affordanceTools: {
        move: async () => ({ default: () => null }),
      } as never,
    })

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(true)
  })

  test('accepts nodes with the generic movable capability', () => {
    const kind = 'direct-move-movable-test'
    registerTestDefinition(kind, {
      capabilities: {
        movable: { axes: ['x', 'z'], gridSnap: true },
      },
    } as Partial<AnyNodeDefinition>)

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(true)
  })

  test('rejects kinds with no registered move path', () => {
    const kind = 'direct-move-none-test'
    registerTestDefinition(kind, {})

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
  })
})

describe('shouldShowMoveCrossHandle', () => {
  test('shows the drag grip only for dormer-hosted windows', () => {
    expect(
      shouldShowMoveCrossHandle({
        id: 'window_dormer',
        type: 'window',
        dormerId: 'dormer_1',
      } as unknown as AnyNode),
    ).toBe(true)
    expect(
      shouldShowMoveCrossHandle({
        id: 'window_wall',
        type: 'window',
        wallId: 'wall_1',
      } as unknown as AnyNode),
    ).toBe(false)
    expect(shouldShowMoveCrossHandle({ id: 'door_1', type: 'door' } as unknown as AnyNode)).toBe(
      false,
    )
  })
})

describe('resolveHandlePortalTargetId', () => {
  test('portals dormer-window handles outside the hidden roof-segment container', () => {
    const roof = { id: 'roof_1', type: 'roof' } as unknown as AnyNode
    const segment = {
      id: 'roof_segment_1',
      type: 'roof-segment',
      parentId: roof.id,
    } as unknown as AnyNode
    const dormer = {
      id: 'dormer_1',
      type: 'dormer',
      parentId: segment.id,
    } as unknown as AnyNode
    const window = {
      id: 'window_1',
      type: 'window',
      parentId: dormer.id,
      dormerId: dormer.id,
    } as unknown as AnyNode
    const nodes = {
      [roof.id]: roof,
      [segment.id]: segment,
      [dormer.id]: dormer,
      [window.id]: window,
    }

    expect(resolveHandlePortalTargetId(window, nodes, 'grandparent')).toBe(roof.id)
  })

  test('keeps the regular grandparent portal for wall-hosted windows', () => {
    const level = { id: 'level_1', type: 'level' } as unknown as AnyNode
    const wall = {
      id: 'wall_1',
      type: 'wall',
      parentId: level.id,
    } as unknown as AnyNode
    const window = {
      id: 'window_1',
      type: 'window',
      parentId: wall.id,
      wallId: wall.id,
    } as unknown as AnyNode

    expect(
      resolveHandlePortalTargetId(window, { [level.id]: level, [wall.id]: wall }, 'grandparent'),
    ).toBe(level.id)
  })
})

describe('resolveDirectManipulationNode', () => {
  test('routes proxied members to their assembly for direct transforms', () => {
    const group = {
      id: 'direct_manipulation_group',
      type: 'direct-manipulation-group-test',
    } as unknown as AnyNode
    const member = {
      id: 'direct_manipulation_member',
      type: 'direct-manipulation-member-test',
      metadata: { nodeSelectionProxyId: group.id },
    } as unknown as AnyNode

    expect(
      resolveDirectManipulationNode(member, {
        [group.id]: group,
        [member.id]: member,
      }),
    ).toBe(group)
  })

  test('falls back to the selected node when the proxy target is missing', () => {
    const member = {
      id: 'direct_manipulation_orphan_member',
      type: 'direct-manipulation-member-test',
      metadata: { nodeSelectionProxyId: 'missing_group' },
    } as unknown as AnyNode

    expect(resolveDirectManipulationNode(member, { [member.id]: member })).toBe(member)
  })

  test('routes parent-frame children to their rotatable parent', () => {
    const parentKind = 'direct-manipulation-parent-frame-parent-test'
    const childKind = 'direct-manipulation-parent-frame-child-test'
    registerTestDefinition(parentKind, {
      capabilities: { rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] } },
    })
    registerTestDefinition(childKind, {
      capabilities: {
        movable: {
          axes: ['x', 'z'],
          gridSnap: true,
          parentFrame: {
            resolveParent: (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) =>
              (node.parentId ? nodes[node.parentId] : null) ?? null,
            parentRotationY: () => 0,
            localToPlan: (_parent: AnyNode, local: readonly [number, number, number]) => [
              local[0],
              local[1],
              local[2],
            ],
            planToLocal: (_parent: AnyNode, planX: number, localY: number, planZ: number) => [
              planX,
              localY,
              planZ,
            ],
          },
        },
      },
    })

    const parent = { id: 'direct_manipulation_parent', type: parentKind } as unknown as AnyNode
    const child = {
      id: 'direct_manipulation_child',
      type: childKind,
      parentId: parent.id,
    } as unknown as AnyNode

    expect(
      resolveDirectManipulationNode(child, {
        [parent.id]: parent,
        [child.id]: child,
      }),
    ).toBe(parent)
  })
})

describe('resolveMoveActionNode', () => {
  test('routes a nested same-kind child move to its host', () => {
    const kind = 'move-action-nested-kind-test'
    registerTestDefinition(kind, {
      capabilities: {
        movable: {
          axes: ['x', 'z'],
          parentFrame: {
            resolveParent: (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) =>
              (node.parentId ? nodes[node.parentId] : null) ?? null,
            parentRotationY: () => 0,
            localToPlan: (_parent: AnyNode, local: readonly [number, number, number]) => [
              local[0],
              local[1],
              local[2],
            ],
            planToLocal: (_parent: AnyNode, planX: number, localY: number, planZ: number) => [
              planX,
              localY,
              planZ,
            ],
          },
        },
      },
    })
    const parent = { id: 'move_action_parent', type: kind } as unknown as AnyNode
    const child = {
      id: 'move_action_child',
      type: kind,
      parentId: parent.id,
    } as unknown as AnyNode

    expect(
      resolveMoveActionNode(child, {
        [parent.id]: parent,
        [child.id]: child,
      }),
    ).toBe(parent)
  })

  test('keeps a child independently movable when its parent is a different kind', () => {
    const parentKind = 'move-action-parent-kind-test'
    const childKind = 'move-action-child-kind-test'
    registerTestDefinition(parentKind, {})
    registerTestDefinition(childKind, {
      capabilities: {
        movable: {
          axes: ['x', 'z'],
          parentFrame: {
            resolveParent: (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) =>
              (node.parentId ? nodes[node.parentId] : null) ?? null,
            parentRotationY: () => 0,
            localToPlan: (_parent: AnyNode, local: readonly [number, number, number]) => [
              local[0],
              local[1],
              local[2],
            ],
            planToLocal: (_parent: AnyNode, planX: number, localY: number, planZ: number) => [
              planX,
              localY,
              planZ,
            ],
          },
        },
      },
    })
    const parent = { id: 'move_action_run', type: parentKind } as unknown as AnyNode
    const child = {
      id: 'move_action_module',
      type: childKind,
      parentId: parent.id,
    } as unknown as AnyNode

    expect(
      resolveMoveActionNode(child, {
        [parent.id]: parent,
        [child.id]: child,
      }),
    ).toBe(child)
  })
})
