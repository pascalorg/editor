import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BlockNode,
  createBoxBlockTopology,
  floorPlacedCollides,
  LevelNode,
  nodeRegistry,
  registerNode,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
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

describe('block floor collision', () => {
  let restore: () => void
  beforeEach(() => {
    restore = nodeRegistry._snapshot()
    registerNode(blockDefinition)
  })
  afterEach(() => {
    restore()
    useScene.setState({ nodes: {} } as never)
  })

  /** A 2 × 2 m box at plan (x, 0) spanning heights bottom..top. */
  function box(id: string, x: number, bottom: number, top: number) {
    const topology = createBoxBlockTopology(2, top - bottom, 2)
    for (const vertex of topology.vertices) vertex.position[1] += bottom
    return BlockNode.parse({ id, parentId: 'level_a', position: [x, 0, 0], topology })
  }

  test('only a block resting on the floor blocks floor placements', () => {
    const blocks = {
      block_counter: box('block_counter', 0, 0, 0.9),
      block_soffit: box('block_soffit', 5, 2.4, 3),
      block_pad: box('block_pad', 10, -0.6, 0),
    }
    const level = LevelNode.parse({ id: 'level_a', children: Object.keys(blocks) })
    useScene.setState({ nodes: { level_a: level, ...blocks } as Record<string, AnyNode> } as never)
    const placeAt = (x: number) =>
      spatialGridManager.canPlaceOnFloor('level_a', [x, 0, 0], [0.5, 1, 0.5], [0, 0, 0])

    expect(placeAt(0)).toEqual({ valid: false, conflictIds: ['block_counter'] })
    // Under a soffit or over a buried foundation pad, the floor is free.
    expect(placeAt(5)).toEqual({ valid: true, conflictIds: [] })
    expect(placeAt(10)).toEqual({ valid: true, conflictIds: [] })

    // Moving a raised block is not refused over floor items either.
    const floorPlaced = blockDefinition.capabilities.floorPlaced
    expect(floorPlacedCollides(floorPlaced, blocks.block_counter)).toBe(true)
    expect(floorPlacedCollides(floorPlaced, blocks.block_soffit)).toBe(false)
    expect(floorPlacedCollides(floorPlaced, blocks.block_pad)).toBe(false)
  })
})
