import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  compileManualEquipmentPreset,
  compileProcessStationEquipment,
  compileSingleEquipmentPrompt,
} from './equipment-spec-compiler'
import {
  normalizeIndustryPackV2Manifest,
  type IndustryPackV2ValidationProfile,
} from './industry-pack-v2'

const pumpProfile: IndustryPackV2ValidationProfile = {
  id: 'chemical.centrifugal_pump',
  name: 'Centrifugal pump',
  aliases: ['离心泵', 'process transfer pump'],
  defaultDimensions: { length: 2.6, width: 1.1, height: 1.4 },
  processPorts: [
    { id: 'inlet', medium: 'water', diameter: 0.18 },
    { id: 'outlet', medium: 'water', diameter: 0.12 },
  ],
  equipmentDefaults: {
    pumpType: 'centrifugal',
    flowRate: 120,
    motorPower: 15,
    skidMounted: true,
  },
}

const manifest = normalizeIndustryPackV2Manifest({
  id: 'industry.chemical.basic',
  name: 'Chemical Basic',
  industry: 'chemical',
  version: '1.0.0',
  schemaVersion: '2.0',
  dependsOnPlugins: ['pascal:factory-equipment'],
  profiles: ['profiles/pumps.json'],
  equipmentBindings: [
    {
      profileId: 'chemical.centrifugal_pump',
      nodeKind: 'factory:pump',
      paramMap: {
        'equipmentDefaults.pumpType': 'pumpType',
        'equipmentDefaults.flowRate': 'flowRate',
        'equipmentDefaults.motorPower': 'motorPower',
        'equipmentDefaults.skidMounted': 'skidMounted',
        'defaultDimensions.length': 'length',
        'defaultDimensions.width': 'width',
        'defaultDimensions.height': 'height',
        'processPorts.inlet.diameter': 'inletDiameter',
        'processPorts.outlet.diameter': 'outletDiameter',
      },
      portMap: {
        inlet: 'inlet',
        outlet: 'outlet',
      },
    },
  ],
})

describe('equipment spec compiler', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)
  })

  afterEach(() => {
    nodeRegistry._reset()
  })

  test('compiles a Chinese centrifugal pump prompt into factory:pump instead of assembly', () => {
    const result = compileSingleEquipmentPrompt({
      manifest,
      profiles: [pumpProfile],
      prompt: '生成一台离心泵，流量 120 m3/h，电机功率 15 kW',
      parentId: 'level_factory',
      position: [4, 0, 2],
    })

    expect(result.kind).toBe('equipment-node')
    if (result.kind !== 'equipment-node') throw new Error('expected equipment node')
    expect(result.spec.nodeKind).toBe('factory:pump')
    expect(result.patch).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'factory:pump',
        pumpType: 'centrifugal',
        length: 2.6,
        width: 1.1,
        height: 1.4,
        flowRate: 120,
        motorPower: 15,
        inletDiameter: 0.18,
        outletDiameter: 0.12,
        skidMounted: true,
        position: [4, 0, 2],
      },
    })
    expect(result.patch.node.type).not.toBe('assembly')
  })

  test('compiles a process station centrifugal pump into factory:pump', () => {
    const result = compileProcessStationEquipment({
      manifest,
      profiles: [pumpProfile],
      station: {
        id: 'transfer_pump',
        label: 'Process station centrifugal pump',
        equipmentHint: 'centrifugal pump',
      },
    })

    expect(result.kind).toBe('equipment-node')
    if (result.kind !== 'equipment-node') throw new Error('expected equipment node')
    expect(result.spec).toMatchObject({
      nodeKind: 'factory:pump',
      profileId: 'chemical.centrifugal_pump',
      params: {
        pumpType: 'centrifugal',
        length: 2.6,
        inletDiameter: 0.18,
        outletDiameter: 0.12,
        motorPower: 15,
      },
    })
  })

  test('compiles a manual preset through the same equipment path', () => {
    const result = compileManualEquipmentPreset({
      manifest,
      profiles: [pumpProfile],
      preset: {
        id: 'skid-mounted-metering-pump',
        profileId: 'chemical.centrifugal_pump',
        params: { flowRate: 80, motorPower: 11 },
      },
    })

    expect(result.kind).toBe('equipment-node')
    if (result.kind !== 'equipment-node') throw new Error('expected equipment node')
    expect(result.patch.node).toMatchObject({
      type: 'factory:pump',
      flowRate: 80,
      motorPower: 11,
      inletDiameter: 0.18,
      outletDiameter: 0.12,
    })
  })

  test('routes unknown equipment to generic-equipment-draft', () => {
    const result = compileSingleEquipmentPrompt({
      manifest,
      profiles: [pumpProfile],
      prompt: '生成一台 quantum foam separator',
    })

    expect(result).toEqual({
      kind: 'generic-equipment-draft',
      draft: {
        kind: 'generic-equipment-draft',
        source: 'prompt',
        prompt: '生成一台 quantum foam separator',
        reason: 'No registered equipment binding matched the requested device.',
      },
    })
  })
})
