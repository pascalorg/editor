import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import { exportSceneToIfc } from './ifc-exporter'

describe('exportSceneToIfc', () => {
  test('exports walls and building hierarchy', () => {
    const nodes = {
      'level_1': {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['wall_1', 'item_1'],
        level: 0,
      },
      'building_1': {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      'wall_1': {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        name: 'North Wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      'item_1': {
        object: 'node',
        id: 'item_1',
        type: 'item',
        name: 'Sofa',
        parentId: 'level_1',
        visible: true,
        children: [],
        position: [2, 0, 2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        asset: {
          id: 'sofa-1',
          category: 'seating',
          name: 'Sofa',
          thumbnail: '',
          src: '/items/sofa.glb',
          dimensions: [2, 0.8, 0.9],
        },
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc).toContain('IFCPROJECT')
    expect(ifc).toContain('IFCBUILDINGSTOREY')
    expect(ifc).toContain('IFCWALLSTANDARDCASE')
    expect(ifc).toContain('IFCFURNISHINGELEMENT')
    expect(ifc).toContain('Sofa')
    expect(ifc).toContain('North Wall')
  })

  test('exports slab floors with correct thickness', () => {
    const nodes = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['slab_1'],
        level: 0,
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      slab_1: {
        object: 'node',
        id: 'slab_1',
        type: 'slab',
        name: 'Living Room Floor',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        elevation: 0.08,
        autoFromWalls: false,
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc).toContain('IFCSLAB')
    expect(ifc).toContain('Living Room Floor')
    expect(ifc).toContain('.FLOOR.')
    expect(ifc).toContain('0.08')
    expect(ifc).toContain('IFCPOLYLINE')
    expect(ifc).not.toMatch(/IFCARBITRARYCLOSEDPROFILEDEF\([^)]*,\([^#]/)
  })

  test('does not export zone polygons as floor slabs', () => {
    const nodes = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['zone_1'],
        level: 0,
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      zone_1: {
        object: 'node',
        id: 'zone_1',
        type: 'zone',
        name: 'Bedroom',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [0, 0],
          [3, 0],
          [3, 2],
          [0, 2],
        ],
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc).not.toContain('IFCSLAB')
    expect(ifc).toContain('IFCSPACE')
    expect(ifc).toContain('Bedroom')
  })

  test('derives floor slabs from zone polygons when walls do not enclose rooms', () => {
    const nodes = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['wall_1', 'wall_2', 'zone_1'],
        level: 0,
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      wall_1: {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      wall_2: {
        object: 'node',
        id: 'wall_2',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [4, 0],
        end: [4, 3],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      zone_1: {
        object: 'node',
        id: 'zone_1',
        type: 'zone',
        name: 'Living Room',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc).toContain('IFCSLAB')
    expect(ifc).toContain('Living Room')
    expect(ifc).toContain('IFCSPACE')
  })

  test('fills uncovered zones when some slab floors already exist', () => {
    const nodes = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['wall_1', 'slab_1', 'zone_1', 'zone_2'],
        level: 0,
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      wall_1: {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [0, 0],
        end: [8, 0],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      slab_1: {
        object: 'node',
        id: 'slab_1',
        type: 'slab',
        name: 'Kitchen Floor',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        elevation: 0.05,
        autoFromWalls: false,
      },
      zone_1: {
        object: 'node',
        id: 'zone_1',
        type: 'zone',
        name: 'Kitchen',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
      },
      zone_2: {
        object: 'node',
        id: 'zone_2',
        type: 'zone',
        name: 'Living Room',
        parentId: 'level_1',
        visible: true,
        children: [],
        polygon: [
          [4, 0],
          [8, 0],
          [8, 3],
          [4, 3],
        ],
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc.match(/IFCSLAB/g)?.length).toBe(2)
    expect(ifc).toContain('Kitchen Floor')
    expect(ifc).toContain('Living Room')
  })

  test('derives floor slabs from enclosed walls when no slab nodes exist', () => {
    const nodes = {
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        name: 'Ground Floor',
        parentId: 'building_1',
        visible: true,
        children: ['wall_1', 'wall_2', 'wall_3', 'wall_4'],
        level: 0,
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        name: 'House',
        parentId: null,
        visible: true,
        children: ['level_1'],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      wall_1: {
        object: 'node',
        id: 'wall_1',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      wall_2: {
        object: 'node',
        id: 'wall_2',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [4, 0],
        end: [4, 3],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      wall_3: {
        object: 'node',
        id: 'wall_3',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [4, 3],
        end: [0, 3],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
      wall_4: {
        object: 'node',
        id: 'wall_4',
        type: 'wall',
        parentId: 'level_1',
        visible: true,
        children: [],
        start: [0, 3],
        end: [0, 0],
        thickness: 0.2,
        height: 2.8,
        frontSide: 'unknown',
        backSide: 'unknown',
      },
    } as unknown as Record<AnyNodeId, AnyNode>

    const ifc = exportSceneToIfc(nodes)

    expect(ifc).toContain('IFCSLAB')
    expect(ifc).toContain('.FLOOR.')
    expect(ifc).toContain('Room 1 Slab')
  })
})
