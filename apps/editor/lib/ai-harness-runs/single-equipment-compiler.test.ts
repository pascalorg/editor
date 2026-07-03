import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { compileSingleEquipmentPrompt } from './single-equipment-compiler'

describe('single equipment compiler', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)
  })

  afterEach(() => {
    nodeRegistry._reset()
  })

  test('compiles a centrifugal pump prompt to a factory pump node', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u79bb\u5fc3\u6cf5',
      placement: { parentId: 'level_factory', position: [1, 0, 2], generatedBy: 'factory-agent' },
    })

    expect(result.kind).toBe('create-equipment-node')
    if (result.kind !== 'create-equipment-node') throw new Error('expected create result')
    expect(result.patch).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'factory:pump',
        position: [1, 0, 2],
        pumpType: 'centrifugal',
        metadata: {
          resolver: 'factory-node',
          factoryNodeKind: 'factory:pump',
          equipmentContract: { profileId: 'generic.centrifugal_pump' },
        },
      },
    })
  })

  test('compiles a storage tank prompt to a factory tank node', () => {
    const result = compileSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u50a8\u7f50',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.kind).toBe('create-equipment-node')
    if (result.kind !== 'create-equipment-node') throw new Error('expected create result')
    expect(result.patch.node).toMatchObject({
      type: 'factory:tank',
      orientation: 'vertical',
      metadata: {
        resolver: 'factory-node',
        factoryNodeKind: 'factory:tank',
        equipmentContract: { profileId: 'generic.vertical_tank' },
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
