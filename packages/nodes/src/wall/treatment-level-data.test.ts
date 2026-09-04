import { afterEach, describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import {
  buildWallTreatmentLevelData,
  clearWallTreatmentMiterCache,
  createWallTreatmentSelector,
  useWallTreatmentLevelData,
} from './treatment-level-data'

afterEach(() => {
  clearWallTreatmentMiterCache()
  useWallTreatmentLevelData.setState({ byLevelId: new Map() })
})

function wall(id: string, start: [number, number], end: [number, number]): WallNode {
  return { id, type: 'wall', parentId: 'level_a', start, end, thickness: 0.1 } as WallNode
}

function publish(walls: WallNode[], proudOffsets = [0.02]) {
  const data = buildWallTreatmentLevelData('level_a', walls, proudOffsets)
  useWallTreatmentLevelData.getState().setLevelData('level_a', data)
  return useWallTreatmentLevelData.getState()
}

describe('wall treatment miter cache', () => {
  test('reuses normalized proud entries on identical ordered wall references', () => {
    const walls = [wall('wall_a', [0, 0], [3, 0])]
    const before = buildWallTreatmentLevelData('level_a', walls, [0.02])
    const after = buildWallTreatmentLevelData('level_a', [...walls], [0.02000001, 0.03, 0.02])
    expect([...after.miterDataByProud.keys()]).toEqual([0, 0.02, 0.03])
    expect(after.miterDataByProud.get(0)).toBe(before.miterDataByProud.get(0))
    expect(after.miterDataByProud.get(0.02)).toBe(before.miterDataByProud.get(0.02))
    const pruned = buildWallTreatmentLevelData('level_a', walls, [])
    expect([...pruned.miterDataByProud.keys()]).toEqual([0])
  })

  test('invalidates on replacement, order, membership, level id, and cache cleanup', () => {
    const a = wall('wall_a', [0, 0], [3, 0])
    const b = wall('wall_b', [0, 0], [0, 3])
    let previous = buildWallTreatmentLevelData('level_a', [a, b], [0.02])
    for (const walls of [[{ ...a }, b], [b, a], [a]]) {
      const next = buildWallTreatmentLevelData('level_a', walls, [0.02])
      expect(next.miterDataByProud.get(0)).not.toBe(previous.miterDataByProud.get(0))
      expect(next.miterDataByProud.get(0.02)).not.toBe(previous.miterDataByProud.get(0.02))
      previous = next
    }
    const other = buildWallTreatmentLevelData('level_b', [a], [0.02])
    expect(other.miterDataByProud.get(0)).not.toBe(previous.miterDataByProud.get(0))
    clearWallTreatmentMiterCache('level_a')
    const reset = buildWallTreatmentLevelData('level_a', [a], [0.02])
    expect(reset.miterDataByProud.get(0)).not.toBe(previous.miterDataByProud.get(0))
    expect(buildWallTreatmentLevelData('level_b', [a], [0.02]).miterDataByProud.get(0)).toBe(
      other.miterDataByProud.get(0),
    )
  })
})

describe('wall treatment selector', () => {
  test('changes only the moved wall and its affected junction neighbor', () => {
    const a = wall('wall_a', [0, 0], [3, 0])
    const b = wall('wall_b', [0, 0], [0, 3])
    const c = wall('wall_c', [10, 0], [13, 0])
    const selectors = [a, b, c].map((node) => createWallTreatmentSelector(node, [0.02]))
    const before = publish([a, b, c])
    const slices = selectors.map((select) => select(before))
    const after = publish([{ ...a, end: [3, 1] }, b, c])
    expect(selectors[0]!(after)).not.toBe(slices[0])
    expect(selectors[1]!(after)).not.toBe(slices[1])
    expect(selectors[2]!(after)).toBe(slices[2])
    expect(selectors[2]!(after)).toBe(selectors[2]!(after))
  })

  test('updates a T-junction endpoint when the passing wall changes thickness', () => {
    const through = wall('wall_a', [-3, 0], [3, 0])
    const branch = wall('wall_b', [0, 0], [0, 3])
    const select = createWallTreatmentSelector(branch, [0.02])
    const before = select(publish([through, branch]))
    const after = select(publish([{ ...through, thickness: 0.3 }, branch]))
    expect(after).not.toBe(before)
  })

  test('ignores unrelated proud offsets and neighbor metadata but tracks lost junctions', () => {
    const a = wall('wall_a', [0, 0], [3, 0])
    const b = wall('wall_b', [0, 0], [0, 3])
    const select = createWallTreatmentSelector(a, [0.02])
    const before = select(publish([a, b]))
    expect(select(publish([a, b], [0.02, 0.05]))).toBe(before)
    expect(select(publish([a, { ...b, name: 'Renamed wall' }]))).toBe(before)
    expect(select(publish([a]))).not.toBe(before)
  })

  test('clears a slice when its level disappears and restores it on reload', () => {
    const a = wall('wall_a', [0, 0], [3, 0])
    const select = createWallTreatmentSelector(a, [0.02])
    const before = select(publish([a]))
    useWallTreatmentLevelData.getState().removeLevelData('level_a')
    expect(select(useWallTreatmentLevelData.getState())).toBeUndefined()
    expect(select(publish([a]))).toEqual(before)
  })
})
