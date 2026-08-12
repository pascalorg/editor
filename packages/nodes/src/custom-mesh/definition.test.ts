import { describe, expect, test } from 'bun:test'
import { CustomMeshNode } from '@pascal-app/core'
import { customMeshDefinition } from './definition'

describe('custom mesh placement bounds', () => {
  test('uses the dedicated editable-cube icon in the build palette', () => {
    expect(customMeshDefinition.presentation?.icon).toEqual({
      kind: 'url',
      src: '/icons/cube.webp',
    })
  })

  test('exposes whole-mesh position controls in the inspector', () => {
    expect(customMeshDefinition.parametrics?.groups).toEqual([
      {
        label: 'Position',
        fields: [{ key: 'position', kind: 'vec3' }],
      },
    ])
  })

  test('exposes the entire mesh as one paintable material target', () => {
    const node = CustomMeshNode.parse({ name: 'Paintable mesh' })
    const paint = customMeshDefinition.capabilities.paint

    expect(customMeshDefinition.capabilities.slots?.(node)).toEqual([
      { slotId: 'body', label: 'Whole mesh' },
    ])
    expect(
      paint?.resolveRole({
        node,
        materialIndex: null,
      }),
    ).toBe('body')
    expect(
      paint?.buildPatch({
        node,
        role: 'body',
        material: undefined,
        materialPreset: 'library:metal-steel',
      }),
    ).toEqual({ slots: { body: 'library:metal-steel' } })
  })

  test('declares its edited top as a stackable surface', () => {
    const base = CustomMeshNode.parse({ name: 'Raised mesh', position: [0, 2, 0] })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        vertices: base.topology.vertices.map((vertex) => ({
          ...vertex,
          position: [vertex.position[0], vertex.position[1] + 1, vertex.position[2]] as [
            number,
            number,
            number,
          ],
        })),
      },
    }
    const height = customMeshDefinition.capabilities.surfaces?.top?.height

    expect(typeof height).toBe('function')
    expect(typeof height === 'function' ? height(node) : height).toBeCloseTo(3.4)
  })

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
