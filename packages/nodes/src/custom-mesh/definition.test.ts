import { describe, expect, test } from 'bun:test'
import { CustomMeshNode } from '@pascal-app/core'
import { customMeshDefinition } from './definition'

describe('custom mesh placement bounds', () => {
  test('keeps asymmetric edited topology centered during a rotated drag', () => {
    const base = CustomMeshNode.parse({
      name: 'Asymmetric mesh',
      position: [10, 2, 20],
      rotation: Math.PI / 2,
    })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        vertices: base.topology.vertices.map((vertex) => ({
          ...vertex,
          position: [
            vertex.position[0] < 0 ? vertex.position[0] - 4 : vertex.position[0],
            vertex.position[1] > 0 ? vertex.position[1] + 1 : vertex.position[1],
            vertex.position[2] > 0 ? vertex.position[2] + 2 : vertex.position[2],
          ] as [number, number, number],
        })),
      },
    }

    expect(customMeshDefinition.capabilities.dragBounds?.(node, {})).toEqual({
      size: [6, 3.4, 4],
      center: [-2, 1.7, 1],
    })
    expect(customMeshDefinition.capabilities.floorPlaced?.footprint?.(node)).toEqual({
      dimensions: [6, 3.4, 4],
      position: [11, 2, 22],
      rotation: [0, Math.PI / 2, 0],
    })
  })
})
