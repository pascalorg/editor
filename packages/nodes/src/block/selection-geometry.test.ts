import { describe, expect, test } from 'bun:test'
import type { BlockTopology } from '@pascal-app/core'
import { Object3D, PerspectiveCamera } from 'three'
import { blockTopologyClientExtent } from './selection-geometry'

describe('block selection geometry', () => {
  test('measures the topology in client pixels as camera distance changes', () => {
    const topology: BlockTopology = {
      vertices: [
        { id: 'v0', position: [-1, -1, 0] },
        { id: 'v1', position: [1, -1, 0] },
        { id: 'v2', position: [1, 1, 0] },
        { id: 'v3', position: [-1, 1, 0] },
      ],
      edges: [],
      faces: [],
    }
    const target = new Object3D()
    const camera = new PerspectiveCamera(90, 1, 0.1, 100)
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    } as HTMLCanvasElement

    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    expect(blockTopologyClientExtent(topology, target, camera, canvas)).toBeCloseTo(100)

    camera.position.z = 5
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    expect(blockTopologyClientExtent(topology, target, camera, canvas)).toBeCloseTo(200)
  })
})
