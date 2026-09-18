import { describe, expect, test } from 'bun:test'
import type { RunSurfaceTarget } from './distribution-run-contract'
import { findNearestPort3D, findNearestPortXZ, type ScenePort } from './ports'

const ports: ScenePort[] = [
  { nodeId: 'duct-segment_a', id: 'floor', position: [0, 0, 0], direction: [1, 0, 0] },
  { nodeId: 'duct-segment_b', id: 'wall', position: [0.4, 2, 0], direction: [1, 0, 0] },
]

describe('distribution port distance metrics', () => {
  test('wall drafting uses true 3D distance', () => {
    expect(findNearestPort3D([0.4, 1.8, 0], ports, 0.5)?.id).toBe('wall')
    expect(findNearestPort3D([0, 1.8, 0], ports, 0.1)).toBeNull()
  })

  test('floor drafting retains the legacy XZ metric', () => {
    expect(findNearestPortXZ([0, 1.8, 0], ports, 0.1)?.id).toBe('floor')
  })

  test('wall drafting rejects a nearby port on the wrong plane', () => {
    const wall: RunSurfaceTarget = {
      kind: 'wall',
      levelId: 'level_1',
      hostId: 'wall_1',
      side: 'front',
      frame: {
        origin: [0, 0, 0],
        normal: [0, 0, 1],
        tangent: [1, 0, 0],
        bitangent: [0, 1, 0],
      },
      bounds: { minU: 0, maxU: 10, minV: 0, maxV: 3 },
    }
    const offPlane: ScenePort = {
      nodeId: 'duct-segment_c',
      id: 'off-plane',
      position: [0, 1.8, 0.25],
      direction: [1, 0, 0],
    }
    expect(findNearestPort3D([0, 1.8, 0], [offPlane], 0.1, wall)).toBeNull()
    expect(findNearestPort3D([0.4, 2, 0], ports, 0.1, wall)?.id).toBe('wall')
  })
})
