import { beforeAll, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  isMoveLocked,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { z } from 'zod'
import { classifyParticipant } from '../components/editor/group-transform-shared'
import { MoveTool } from '../components/tools/item/move-tool'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { canDirectMoveNode } from './direct-manipulation'
import { registryMoveDisabled } from './node-action-movement'

// Mirrors a lean-to post: a kind-level 2D mover plus a per-node override lock.
const KIND = 'move-lock-test'

beforeAll(() => {
  if (nodeRegistry.has(KIND)) return
  registerNode({
    kind: KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(KIND) }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {
      movable: {
        axes: ['x', 'z'],
        gridSnap: true,
        override: ({ node }) =>
          (node as { metadata?: { locked?: boolean } }).metadata?.locked
            ? { axes: [], gridSnap: false }
            : null,
      },
    },
    floorplanMoveTarget: () => ({
      affectedIds: [],
      apply() {},
      canCommit: () => false,
      commit() {},
    }),
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
})

function node(locked: boolean) {
  return {
    id: locked ? 'move_lock_locked' : 'move_lock_free',
    type: KIND,
    parentId: 'level_move_lock',
    position: [1, 0, 2],
    rotation: 0,
    metadata: locked ? { locked: true } : {},
  } as unknown as AnyNode
}

test('a per-node override lock outranks the kind-level 2D mover', () => {
  expect(isMoveLocked(node(true))).toBe(true)
  expect(isMoveLocked(node(false))).toBe(false)
  expect(registryMoveDisabled(node(true))).toBe(true)
  expect(registryMoveDisabled(node(false))).toBe(false)
  expect(canDirectMoveNode(node(true))).toBe(false)
})

test('group pick-up leaves a locked node behind', () => {
  const locked = node(true)
  const free = node(false)
  const nodes = { [locked.id]: locked, [free.id]: free }
  expect(classifyParticipant(locked, 'level_move_lock', nodes)).toBeNull()
  expect(classifyParticipant(free, 'level_move_lock', nodes)).toBe('scalar')
})

test('the move tool refuses a locked node instead of mounting a mover', async () => {
  const renderer = await create(<MoveTool />)
  await act(async () => useEditor.getState().setMovingNode(node(true)))
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  await act(async () => renderer.unmount())
})
