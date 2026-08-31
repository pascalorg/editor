import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useAlignmentGuides from '../../store/use-alignment-guides'
import { applyFloorplanAlignment } from './apply-alignment'

describe('applyFloorplanAlignment', () => {
  beforeEach(() => {
    // These tests assume no active building (alignment runs on world axes).
    // The scene/viewer stores are process-wide singletons, so an earlier test
    // FILE can leak a selected building fixture into them — under bun's
    // platform-dependent file order that turned into an order-dependent
    // failure (getActiveBuildingPose reading a fixture building without a
    // rotation array). Pin the empty-scene context explicitly.
    useScene.setState({ nodes: {} } as never)
    useViewer.setState({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    } as never)
  })

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
