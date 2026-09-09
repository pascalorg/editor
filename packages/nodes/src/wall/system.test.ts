import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'
import { resetWallTreatmentLevels, updateWallTreatmentLevels } from './system'
import { useWallTreatmentLevelData } from './treatment-level-data'

const originalScene = useScene.getState()

afterEach(() => {
  resetWallTreatmentLevels()
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(originalScene)
})

function wall(id: string, parentId = 'level_a'): WallNode {
  return {
    id,
    type: 'wall',
    parentId,
    start: [0, 0],
    end: [3, 0],
    thickness: 0.1,
    children: [],
  } as unknown as WallNode
}

function setWalls(walls: WallNode[], dirtyIds = walls.map((node) => node.id)) {
  const levelIds = [...new Set(walls.map((node) => node.parentId))]
  useScene.setState({
    nodes: Object.fromEntries([
      ...walls.map((node) => [node.id, node]),
      ...levelIds.map((id) => [
        id,
        {
          id,
          type: 'level',
          children: walls.filter((node) => node.parentId === id).map((node) => node.id),
        },
      ]),
    ]),
    dirtyNodes: new Set(dirtyIds),
  } as never)
}

function countWrites() {
  const writes: string[] = []
  const unsubscribe = useWallTreatmentLevelData.subscribe((state, previous) => {
    for (const [levelId, data] of state.byLevelId) {
      if (data !== previous.byLevelId.get(levelId)) writes.push(levelId)
    }
  })
  return { writes, unsubscribe }
}

describe('wall treatment frame updates', () => {
  test('writes once across repeated dirty frames with unchanged wall identities', () => {
    setWalls([wall('wall_a')])
    const { writes, unsubscribe } = countWrites()
    try {
      updateWallTreatmentLevels()
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a'])
    } finally {
      unsubscribe()
    }
  })

  test('writes only the overridden level once per live override and once on clearing', () => {
    setWalls([wall('wall_a'), wall('wall_b', 'level_b')])
    updateWallTreatmentLevels()
    useScene.setState({ dirtyNodes: new Set() })
    const { writes, unsubscribe } = countWrites()
    try {
      useLiveNodeOverrides.getState().set('wall_a', { end: [4, 1] })
      updateWallTreatmentLevels()
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a'])
      expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls[0]?.end).toEqual([
        4, 1,
      ])

      useLiveNodeOverrides.getState().set('wall_a', { end: [5, 1] })
      updateWallTreatmentLevels()
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a', 'level_a'])

      useLiveNodeOverrides.getState().clear('wall_a')
      updateWallTreatmentLevels()
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a', 'level_a', 'level_a'])
      expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls[0]?.end).toEqual([
        3, 0,
      ])
    } finally {
      unsubscribe()
    }
  })

  test('invalidates effective walls when the stored wall changes under a live override', () => {
    const node = wall('wall_a')
    useLiveNodeOverrides.getState().set(node.id, { end: [4, 1] })
    setWalls([node])
    updateWallTreatmentLevels()
    setWalls([{ ...node, thickness: 0.3 }])
    updateWallTreatmentLevels()
    const effective = useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls[0]
    expect(effective?.thickness).toBe(0.3)
    expect(effective?.end).toEqual([4, 1])
  })

  test('writes after wall addition and treatment proud changes', () => {
    const a = wall('wall_a')
    const b = wall('wall_b')
    setWalls([a])
    updateWallTreatmentLevels()
    const { writes, unsubscribe } = countWrites()
    try {
      setWalls([a, b])
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a'])
      const treated = {
        ...a,
        skirting: { enabled: true, proud: 0.02, height: 0.1, profile: 'flat', sides: 'both' },
      } as WallNode
      setWalls([treated, b])
      updateWallTreatmentLevels()
      const before = useWallTreatmentLevelData.getState().byLevelId.get('level_a')!
      setWalls([{ ...treated, skirting: { ...treated.skirting!, proud: 0.04 } }, b])
      updateWallTreatmentLevels()
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a', 'level_a', 'level_a'])
      const after = useWallTreatmentLevelData.getState().byLevelId.get('level_a')!
      expect([...after.miterDataByProud.keys()]).not.toEqual([...before.miterDataByProud.keys()])
    } finally {
      unsubscribe()
    }
  })

  test('updates old and new levels when a wall moves between them', () => {
    const a = wall('wall_a')
    const b = wall('wall_b', 'level_b')
    setWalls([a, b])
    updateWallTreatmentLevels()
    const { writes, unsubscribe } = countWrites()
    try {
      setWalls([a, { ...b, parentId: a.parentId }], [b.id])
      updateWallTreatmentLevels()
      expect(writes).toEqual(['level_a'])
      expect(useWallTreatmentLevelData.getState().byLevelId.has('level_b')).toBe(false)
      expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls).toHaveLength(2)
    } finally {
      unsubscribe()
    }
  })

  test('removes stale neighbors and handles an empty level with only the level dirty', () => {
    const a = wall('wall_a')
    const b = { ...wall('wall_b'), end: [0, 3] } as WallNode
    setWalls([a, b])
    updateWallTreatmentLevels()
    setWalls([a], [])
    updateWallTreatmentLevels()
    expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls).toEqual([a])
    const nodes = { ...useScene.getState().nodes }
    delete nodes[a.id]
    nodes[a.parentId as AnyNodeId] = { id: a.parentId, type: 'level', children: [] } as never
    useScene.setState({ nodes, dirtyNodes: new Set([a.parentId as AnyNodeId]) })
    updateWallTreatmentLevels()
    expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls).toEqual([])
  })

  test('clears removed levels even when no nodes are dirty and rebuilds reused ids', () => {
    const a = wall('wall_a')
    setWalls([a])
    updateWallTreatmentLevels()
    useScene.setState({ nodes: {}, dirtyNodes: new Set() })
    updateWallTreatmentLevels()
    expect(useWallTreatmentLevelData.getState().byLevelId.size).toBe(0)
    setWalls([a])
    updateWallTreatmentLevels()
    expect(useWallTreatmentLevelData.getState().byLevelId.get('level_a')?.walls).toEqual([a])
  })

  test('teardown clears published data and permits an identical scene to rebuild', () => {
    setWalls([wall('wall_a')])
    updateWallTreatmentLevels()
    const before = useWallTreatmentLevelData.getState().byLevelId.get('level_a')
    resetWallTreatmentLevels()
    expect(useWallTreatmentLevelData.getState().byLevelId.size).toBe(0)
    updateWallTreatmentLevels()
    const after = useWallTreatmentLevelData.getState().byLevelId.get('level_a')
    expect(after).toEqual(before)
    expect(after?.miterDataByProud.get(0)).not.toBe(before?.miterDataByProud.get(0))
  })
})
