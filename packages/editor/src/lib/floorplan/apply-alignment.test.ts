import { afterEach, describe, expect, test } from 'bun:test'
import useAlignmentGuides from '../../store/use-alignment-guides'
import { applyFloorplanAlignment } from './apply-alignment'

describe('applyFloorplanAlignment', () => {
  afterEach(() => {
    useAlignmentGuides.getState().clear()
  })

  test('can publish passive guides without applying snap', () => {
    useAlignmentGuides.getState().clear()

    const result = applyFloorplanAlignment(
      [0.04, 2],
      [{ nodeId: 'draft', kind: 'corner', x: 0.04, z: 2 }],
      [{ nodeId: 'wall_a', kind: 'corner', x: 0, z: 0 }],
      { applySnap: false },
    )

    expect(result.point).toEqual([0.04, 2])
    expect(result.snapped).toBe(false)
    expect(result.guides).toHaveLength(1)
    expect(useAlignmentGuides.getState().guides).toHaveLength(1)
  })
})
