import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, SemanticRecipeEditableParam } from '@pascal-app/core'
import { AssemblyNode, BoxNode, CylinderNode } from '@pascal-app/core/schema'
import { buildSemanticEquipmentEditableParamUpdates } from './semantic-equipment-editing'

const ASSEMBLY_ID = 'assembly_tank' as AnyNodeId

function tankNodes() {
  const assembly = AssemblyNode.parse({
    id: ASSEMBLY_ID,
    type: 'assembly',
    children: ['cylinder_liquid', 'box_shell'],
    metadata: {
      dynamicLevelGeometry: {
        kind: 'vertical',
        height: 4,
        position: [0, 0, 0],
      },
      sourceArgs: {
        recipeParams: {
          liquidLevel: 0.25,
        },
      },
      equipmentAssembly: {
        kind: 'semantic-assembly',
        params: {
          liquidLevel: 0.25,
        },
      },
    },
  })
  const liquid = CylinderNode.parse({
    id: 'cylinder_liquid',
    type: 'cylinder',
    parentId: ASSEMBLY_ID,
    height: 1,
    position: [0, 0.5, 0],
    metadata: { semanticRole: 'liquid_volume' },
    material: {
      properties: {
        color: '#38bdf8',
        opacity: 0.5,
        transparent: true,
      },
    },
  })
  const shell = BoxNode.parse({
    id: 'box_shell',
    type: 'box',
    parentId: ASSEMBLY_ID,
    metadata: { semanticRole: 'vessel_shell' },
    material: {
      properties: {
        color: '#cbd5e1',
        opacity: 1,
        transparent: false,
      },
    },
  })
  return {
    [ASSEMBLY_ID]: assembly,
    [liquid.id]: liquid,
    [shell.id]: shell,
  } as Record<string, AnyNode>
}

function updateFor(param: SemanticRecipeEditableParam, value: unknown) {
  return buildSemanticEquipmentEditableParamUpdates({
    nodes: tankNodes(),
    assemblyId: ASSEMBLY_ID,
    param,
    value,
  })
}

describe('semantic equipment editing', () => {
  test('updates dynamic liquid level and records the equipment param', () => {
    const updates = updateFor(
      {
        key: 'liquidLevel',
        kind: 'number',
        effects: [
          { kind: 'set-param' },
          {
            kind: 'set-part-dynamic-level',
            partRole: 'liquid_volume',
            geometryRef: 'dynamicLevelGeometry',
            minSize: 0.02,
          },
        ],
      },
      0.75,
    )

    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      id: 'cylinder_liquid',
      data: {
        height: 3,
        position: [0, 1.5, 0],
      },
    })
    expect(updates[1]).toMatchObject({
      id: ASSEMBLY_ID,
      data: {
        metadata: {
          sourceArgs: { recipeParams: { liquidLevel: 0.75 } },
          equipmentAssembly: { params: { liquidLevel: 0.75 } },
        },
      },
    })
  })

  test('updates semantic part opacity and transparent flag', () => {
    const updates = updateFor(
      {
        key: 'shellOpacity',
        kind: 'number',
        effects: [
          { kind: 'set-param' },
          {
            kind: 'set-part-material',
            partRole: 'vessel_shell',
            property: 'opacity',
            transparentWhenBelowOne: true,
          },
        ],
      },
      0.32,
    )

    expect(updates[0]).toMatchObject({
      id: 'box_shell',
      data: {
        material: {
          properties: {
            color: '#cbd5e1',
            opacity: 0.32,
            transparent: true,
          },
        },
      },
    })
    expect(updates[1]?.data.metadata).toMatchObject({
      sourceArgs: { recipeParams: { shellOpacity: 0.32 } },
      equipmentAssembly: { params: { shellOpacity: 0.32 } },
    })
  })

  test('updates semantic part color without touching other material properties', () => {
    const updates = updateFor(
      {
        key: 'liquidColor',
        kind: 'color',
        effects: [
          { kind: 'set-param' },
          { kind: 'set-part-material', partRole: 'liquid_volume', property: 'color' },
        ],
      },
      '#f97316',
    )

    expect(updates[0]).toMatchObject({
      id: 'cylinder_liquid',
      data: {
        material: {
          properties: {
            color: '#f97316',
            opacity: 0.5,
            transparent: true,
          },
        },
      },
    })
    expect(updates[1]?.data.metadata).toMatchObject({
      sourceArgs: { recipeParams: { liquidColor: '#f97316' } },
      equipmentAssembly: { params: { liquidColor: '#f97316' } },
    })
  })
})
