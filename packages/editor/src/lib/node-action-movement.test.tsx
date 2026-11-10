import { beforeAll, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  isMoveLocked,
  isNodeDuplicable,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { z } from 'zod'
import { duplicateNodeAndPickUp } from '../components/editor/duplicate-node'
import { classifyParticipant } from '../components/editor/group-transform-shared'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { canDirectMoveNode } from './direct-manipulation'
import { createEditorApi } from './editor-api'
import { registryMoveDisabled } from './node-action-movement'
import { copySelectedNodesToEditorClipboard } from './scene-clipboard'

// Mirrors a lean-to post: a kind-level 2D mover plus per-node move and duplicate locks.
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
      duplicable: {
        allow: ({ node }) => !(node as { metadata?: { locked?: boolean } }).metadata?.locked,
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

test('every moving-node entry refuses a locked node', () => {
  const api = createEditorApi()
  useEditor.getState().setMovingNode(node(true))
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  api.engageMoveDrag(node(true))
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  expect(useEditor.getState().placementDragMode).toBe(false)
  api.engageMove(node(false))
  expect(useInteractionScope.getState().scope.kind).toBe('moving')
  useEditor.getState().setMovingNode(null)
})

test('a locked node cannot be duplicated or copied', () => {
  const level = {
    id: 'level_move_lock',
    type: 'level',
    parentId: null,
    children: ['move_lock_locked', 'move_lock_free'],
  } as unknown as AnyNode
  const locked = node(true)
  const free = node(false)
  useScene.setState({
    nodes: { [level.id]: level, [locked.id]: locked, [free.id]: free } as never,
    rootNodeIds: [level.id as AnyNodeId],
  })
  expect(isNodeDuplicable(locked)).toBe(false)
  expect(isNodeDuplicable(free)).toBe(true)
  duplicateNodeAndPickUp(locked)
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(3)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
  expect(copySelectedNodesToEditorClipboard([locked.id as AnyNodeId])).toBe(false)
  expect(copySelectedNodesToEditorClipboard([free.id as AnyNodeId])).toBe(true)
})
