import { describe, expect, test } from 'bun:test'
import { BlockNode } from '@pascal-app/core'
import { blockDefinition } from './definition'

describe('block placement bounds', () => {
  test('starts with the shared default wall-role material', () => {
    expect(blockDefinition.defaults().slots).toEqual({})
    expect(blockDefinition.defaults().slotNames).toEqual({ body: 'Body' })
  })

  test('uses the dedicated editable-cube icon in the build palette', () => {
    expect(blockDefinition.presentation?.icon).toEqual({
      kind: 'url',
      src: '/icons/cube.webp',
    })
  })

  test('exposes whole-mesh position controls in the inspector', () => {
    expect(blockDefinition.parametrics?.groups).toEqual([
      {
        label: 'Position',
        fields: [{ key: 'position', kind: 'vec3' }],
      },
    ])
    expect(blockDefinition.parametrics?.customPanel).toBeFunction()
  })

  test('exposes named slots and paints the assigned slot binding', () => {
    const base = BlockNode.parse({
      name: 'Paintable mesh',
      slots: { accent: 'library:preset-softwhite' },
      slotNames: { body: 'Body', accent: 'Trim' },
    })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: base.topology.faces.map((face, index) => ({
          ...face,
          materialSlot: index === 0 ? 'accent' : 'body',
        })),
      },
    }
    const paint = blockDefinition.capabilities.paint

    expect(blockDefinition.capabilities.slots?.(node)).toEqual([
      { slotId: 'body', label: 'Body' },
      { slotId: 'accent', label: 'Trim' },
    ])
    expect(paint?.commit).toBeFunction()
    expect(
      paint?.buildPatch({
        node,
        role: 'accent',
        material: undefined,
        materialPreset: 'library:metal-steel',
      }),
    ).toEqual({
      slots: {
        accent: 'library:metal-steel',
      },
    })
  })

  test('declares its edited top as a stackable surface', () => {
    const base = BlockNode.parse({ name: 'Raised mesh', position: [0, 2, 0] })
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
    const height = blockDefinition.capabilities.surfaces?.top?.height

    expect(typeof height).toBe('function')
    expect(typeof height === 'function' ? height(node) : height).toBeCloseTo(3.4)
  })

  test('keeps asymmetric edited topology centered during a rotated drag', () => {
    const base = BlockNode.parse({
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

    expect(blockDefinition.capabilities.dragBounds?.(node, {})).toEqual({
      size: [6, 3.4, 4],
      center: [-2, 1.7, 1],
    })
    expect(blockDefinition.capabilities.floorPlaced?.footprint?.(node)).toEqual({
      dimensions: [6, 3.4, 4],
      position: [11, 2, 22],
      rotation: [0, Math.PI / 2, 0],
    })
  })
})
