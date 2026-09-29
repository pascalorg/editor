import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { commitDimensionValue, isDimensionEditAllowed } from './floorplan-dimension-edit-overlay'

type Change = { id: AnyNodeId; data: Partial<AnyNode> }

function wall(id: string, start: [number, number], end: [number, number]): AnyNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    start,
    end,
    thickness: 0.15,
    children: [],
  } as unknown as AnyNode
}

function nodes(): Record<string, AnyNode> {
  return {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      level: 0,
      children: ['wall_a', 'wall_b', 'dim_1'],
    } as unknown as AnyNode,
    wall_a: wall('wall_a', [0, 0], [3, 0]),
    wall_b: wall('wall_b', [3, 0], [3, 4]),
    dim_1: {
      object: 'node',
      id: 'dim_1',
      type: 'construction-dimension',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: [],
    } as unknown as AnyNode,
  }
}

let initial: ReturnType<typeof useScene.getState>
let applied: Change[]
let updated: Change[]
let dirty: AnyNodeId[]

beforeEach(() => {
  initial = useScene.getState()
  applied = []
  updated = []
  dirty = []
  useScene.setState({
    nodes: nodes() as ReturnType<typeof useScene.getState>['nodes'],
    applyNodeChanges: ((changes: { update?: Change[] }) => {
      applied.push(...(changes.update ?? []))
    }) as ReturnType<typeof useScene.getState>['applyNodeChanges'],
    updateNode: ((id: AnyNodeId, data: Partial<AnyNode>) => {
      updated.push({ id, data })
    }) as ReturnType<typeof useScene.getState>['updateNode'],
    markDirty: ((id: AnyNodeId) => {
      dirty.push(id)
    }) as ReturnType<typeof useScene.getState>['markDirty'],
  })
})

afterEach(() => {
  useScene.setState(initial, true)
})

describe('commitDimensionValue', () => {
  test('a wall dimension drives the wall end and the wall sharing that corner', () => {
    const outcome = commitDimensionValue({
      target: {
        ownerNodeId: 'wall_a' as AnyNodeId,
        witnessStart: [0, 0],
        witnessEnd: [3, 0],
        value: 3,
      },
      nextLength: 3.5,
    })

    expect(outcome).toEqual({ ok: true })
    const byId = new Map(applied.map((change) => [change.id, change.data]))
    expect(byId.get('wall_a' as AnyNodeId)).toEqual({ start: [0, 0], end: [3.5, 0] })
    expect(byId.get('wall_b' as AnyNodeId)).toEqual({ start: [3.5, 0], end: [3, 4] })
    expect(dirty.sort()).toEqual(['wall_a', 'wall_b'] as AnyNodeId[])
    expect(updated).toEqual([])
  })

  test('an undrivable wall dimension is refused and nothing is written', () => {
    const outcome = commitDimensionValue({
      target: {
        ownerNodeId: 'wall_a' as AnyNodeId,
        witnessStart: [1.5, -1],
        witnessEnd: [1.5, 1],
        value: 2,
      },
      nextLength: 2.5,
    })

    expect(outcome.ok).toBe(false)
    expect(applied).toEqual([])
    expect(updated).toEqual([])
  })

  test('an undrivable construction dimension keeps the typed text as an override', () => {
    const outcome = commitDimensionValue({
      target: {
        ownerNodeId: 'dim_1' as AnyNodeId,
        witnessStart: [10, 10],
        witnessEnd: [12, 10],
        value: 2,
      },
      nextLength: 3,
      unit: 'metric',
    })

    expect(outcome).toEqual({ ok: true })
    expect(applied).toEqual([])
    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe('dim_1' as AnyNodeId)
    expect(typeof (updated[0]?.data as { textOverride?: unknown }).textOverride).toBe('string')
  })
})

describe('isDimensionEditAllowed', () => {
  const idle = {
    workspaceMode: 'edit',
    mode: 'select',
    isPreviewMode: false,
    isCaptureMode: false,
    isFirstPersonMode: false,
  } as const

  test('only an editable scene in select mode of the edit workspace', () => {
    expect(isDimensionEditAllowed(idle, { readOnly: false })).toBe(true)
    expect(isDimensionEditAllowed(idle, { readOnly: true })).toBe(false)
    expect(isDimensionEditAllowed({ ...idle, workspaceMode: 'studio' }, { readOnly: false })).toBe(
      false,
    )
    expect(isDimensionEditAllowed({ ...idle, workspaceMode: 'sheets' }, { readOnly: false })).toBe(
      false,
    )
    expect(isDimensionEditAllowed({ ...idle, mode: 'delete' }, { readOnly: false })).toBe(false)
    expect(isDimensionEditAllowed({ ...idle, isPreviewMode: true }, { readOnly: false })).toBe(
      false,
    )
  })
})
