import { describe, expect, test } from 'bun:test'
import { compileSingleEquipmentPrompt } from './single-equipment-compiler'

describe('single equipment compiler', () => {
  test('compiles a centrifugal pump prompt to a semantic assembly', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u79bb\u5fc3\u6cf5',
      placement: { parentId: 'level_factory', position: [1, 0, 2], generatedBy: 'factory-agent' },
    })

    expect(result.kind).toBe('create-semantic-assembly')
    if (result.kind !== 'create-semantic-assembly') throw new Error('expected semantic assembly')
    expect(result.patchPlan.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'assembly',
        metadata: {
          sourceTool: 'semantic_recipe',
          resolver: 'semantic-assembly',
          recipeId: 'factory:centrifugal-pump',
          equipmentAssembly: {
            kind: 'semantic-assembly',
            profileId: 'generic.centrifugal_pump',
            recipeId: 'factory:centrifugal-pump',
            editableParams: expect.arrayContaining([
              expect.objectContaining({ key: 'casingColor' }),
              expect.objectContaining({ key: 'motorColor' }),
              expect.objectContaining({ key: 'motorPower' }),
            ]),
          },
          equipmentContract: {
            profileId: 'generic.centrifugal_pump',
            recipeId: 'factory:centrifugal-pump',
          },
        },
      },
    })
    expect(
      result.patchPlan.patches.some(
        (patch) => patch.op === 'create' && patch.node.type === 'factory:pump',
      ),
    ).toBe(false)
    expect(result.patchPlan.patches.map((patch) => patch.node.metadata?.semanticRole)).toEqual(
      expect.arrayContaining(['support_base', 'drive_motor', 'volute_casing']),
    )
  })

  test('compiles a storage tank prompt to a recipe semantic assembly with liquid volume', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u539f\u6cb9\u50a8\u7f50\uff0c\u6db2\u4f4d82%\uff0c\u58f3\u4f53\u534a\u900f\u660e',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.kind).toBe('create-semantic-assembly')
    if (result.kind !== 'create-semantic-assembly') throw new Error('expected semantic assembly')
    expect(result.patchPlan.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'assembly',
        metadata: {
          sourceTool: 'semantic_recipe',
          resolver: 'semantic-assembly',
          recipeId: 'factory:storage-tank',
          sourceArgs: {
            recipeParams: {
              liquidLevel: 0.82,
              shellOpacity: 0.34,
            },
          },
          equipmentAssembly: {
            kind: 'semantic-assembly',
            profileId: 'generic.vertical_tank',
            recipeId: 'factory:storage-tank',
            params: {
              liquidLevel: 0.82,
              shellOpacity: 0.34,
            },
            editableParams: expect.arrayContaining([
              expect.objectContaining({ key: 'liquidLevel' }),
              expect.objectContaining({ key: 'shellOpacity' }),
              expect.objectContaining({ key: 'liquidOpacity' }),
              expect.objectContaining({ key: 'liquidColor' }),
            ]),
          },
          equipmentContract: {
            profileId: 'generic.vertical_tank',
            recipeId: 'factory:storage-tank',
          },
        },
      },
    })
    expect(result.patchPlan.patches.map((patch) => patch.node.metadata?.semanticRole)).toEqual(
      expect.arrayContaining([
        'vessel_shell',
        'liquid_volume',
        'inlet_port',
        'outlet_port',
        'access_ladder',
      ]),
    )
    const liquidPatch = result.patchPlan.patches.find(
      (patch) => patch.node.metadata?.semanticRole === 'liquid_volume',
    )
    expect(liquidPatch?.node).toMatchObject({
      type: 'cylinder',
      material: {
        properties: {
          transparent: true,
        },
      },
    })
  })

  test('falls back to generic primitive draft for unknown equipment', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u5947\u602a\u7684\u79d1\u5e7b\u88c5\u7f6e',
      placement: { generatedBy: 'factory-agent' },
    })

    expect(result).toEqual({
      kind: 'generic-equipment-draft',
      reason: 'No bounded factory equipment intent matched.',
    })
  })

  test('updates selected factory equipment parameters instead of creating a replacement', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u628a\u8fd9\u4e2a\u79bb\u5fc3\u6cf5\u6539\u6210 3 \u7c73\u957f\u7684\u7ea2\u8272\u8ba1\u91cf\u6cf5',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: ['pump_1'],
          nodes: [{ id: 'pump_1', type: 'factory:pump', name: 'Pump 1' }],
        },
      },
    })

    expect(result).toEqual({
      kind: 'update-equipment-node',
      nodeId: 'pump_1',
      nodeKind: 'factory:pump',
      patch: {
        op: 'update',
        id: 'pump_1',
        data: {
          length: 3,
          casingColor: '#ef4444',
          pumpType: 'metering',
        },
      },
    })
  })
})
