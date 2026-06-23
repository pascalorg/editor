import { describe, expect, test } from 'bun:test'
import { resolveProcessStationEquipment } from './process-equipment-resolver'
import type { ProcessLinePlan, ProcessStationPlan, StationPlacement } from './process-line-types'

const plan: ProcessLinePlan = {
  processId: 'demo_process',
  processLabel: 'Demo process',
  domain: 'generic',
  layoutStyle: 'linear',
  stations: [],
  connections: [],
}

const waterElectrolysisPlan: ProcessLinePlan = {
  ...plan,
  processId: 'water_electrolysis_hydrogen',
  processLabel: 'Water electrolysis hydrogen workshop',
  domain: 'energy',
}

const cementClinkerPlan: ProcessLinePlan = {
  ...plan,
  processId: 'cement_clinker_production_line',
  processLabel: 'Cement clinker production line',
  domain: 'chemical',
  sourcePack: {
    id: 'industry.cement.basic',
    version: '0.1.0',
    industry: 'cement',
  },
}

const cementPlantPlan: ProcessLinePlan = {
  ...plan,
  processId: 'cement_plant_full',
  processLabel: 'Full cement plant',
  domain: 'chemical',
  sourcePack: {
    id: 'industry.cement.basic',
    version: '0.1.0',
    industry: 'cement',
  },
}

const electrolyticAluminumPlan: ProcessLinePlan = {
  ...plan,
  processId: 'electrolytic_aluminum_smelter_full',
  processLabel: 'Electrolytic aluminum smelter',
  domain: 'metallurgy',
  stations: [
    {
      id: 'molten_aluminum_holding_furnace',
      label: 'Molten aluminum holding furnace',
      role: 'molten_aluminum_holding_furnace',
      equipmentHint:
        'electrolytic_aluminum.molten_aluminum_holding_furnace horizontal molten aluminum holding furnace',
    },
    {
      id: 'continuous_ingot_casting_line',
      label: 'Continuous ingot casting line',
      role: 'continuous_ingot_casting_line',
      equipmentHint:
        'electrolytic_aluminum.continuous_ingot_casting_line continuous aluminum ingot casting line',
    },
  ],
  connections: [
    {
      fromStationId: 'molten_aluminum_holding_furnace',
      toStationId: 'continuous_ingot_casting_line',
      medium: 'molten_metal',
      visualKind: 'hot_material_chute',
      fromPortId: 'tap_spout',
      toPortId: 'pouring_tundish',
    },
  ],
}

const refineryPlan: ProcessLinePlan = {
  ...plan,
  processId: 'refinery_basic_complex',
  processLabel: 'Basic oil refinery complex',
  domain: 'generic',
  sourcePack: {
    id: 'industry.refinery.basic',
    version: '0.1.0',
    industry: 'refinery',
  },
}

const placement: StationPlacement = {
  stationId: 'station',
  role: 'station',
  label: 'Station',
  position: [1, 0, 2],
  rotation: [0, 0, 0],
  footprint: { length: 1, width: 1 },
}

function resolve(station: ProcessStationPlan) {
  return resolveProcessStationEquipment({
    plan,
    station,
    stationPlacement: {
      ...placement,
      stationId: station.id,
      role: station.role,
      label: station.label,
    },
    placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    metadata: {
      generatedBy: 'factory-agent',
      processId: plan.processId,
      stationId: station.id,
      stationRole: station.role,
    },
  })
}

describe('process equipment resolver', () => {
  test('resolves electrical stations through qualified catalog item nodes before native boxes', () => {
    const result = resolve({
      id: 'dc_power_supply',
      label: 'DC power supply',
      role: 'dc_power_supply',
      equipmentHint: 'industrial rectifier power cabinet',
    })

    expect(result.resolver).toBe('catalog-item')
    expect(result.patches[0]?.node.type).toBe('item')
    if (result.patches[0]?.node.type !== 'item') throw new Error('expected catalog item')
    expect(result.patches[0].node.asset.src).toBe('/items/factory-electric-box/model.glb')
    expect(result.patches[0]?.node.metadata).toMatchObject({
      resolver: 'catalog-item',
      catalogItemId: 'factory-electric-box',
      processCatalogQualified: true,
    })
  })

  test('falls back to native editable boxes when no qualified catalog item matches', () => {
    const result = resolve({
      id: 'cooling_loop',
      label: 'Cooling water loop',
      role: 'cooling_loop',
      equipmentHint: 'industrial cooling water utility control skid',
    })

    expect(result.resolver).toBe('native-box')
    expect(result.patches[0]?.node.type).toBe('box')
    expect(result.patches[0]?.node.metadata?.resolver).toBe('native-box')
  })

  test('resolves tee pipe station wording through native pipe fittings', () => {
    const result = resolve({
      id: 'pipe_tee',
      label: '\u7ba1\u9053\u4e09\u901a',
      role: 'pipe_tee',
      equipmentHint: 'factory pipe tee fitting',
    })

    expect(result.resolver).toBe('native-pipe-fitting')
    expect(result.patches[0]?.node.type).toBe('pipe-fitting')
    expect(result.patches[0]?.node.metadata?.resolver).toBe('native-pipe-fitting')
  })

  test('resolves straight pipe station wording through native pipes', () => {
    const result = resolve({
      id: 'pipe_run',
      label: '\u7ba1\u9053',
      role: 'pipe_run',
      equipmentHint: 'factory straight pipe run',
    })

    expect(result.resolver).toBe('native-pipe')
    expect(result.patches[0]?.node.type).toBe('pipe')
    expect(result.patches[0]?.node.metadata?.resolver).toBe('native-pipe')
  })

  test('resolves tank-like process stations to native editable tank nodes', () => {
    const result = resolve({
      id: 'hydrogen_buffer',
      label: 'Hydrogen buffer tank',
      role: 'hydrogen_buffer',
      equipmentHint: 'horizontal hydrogen storage buffer vessel',
      footprintHint: 'large',
    })

    expect(result.resolver).toBe('native-tank')
    expect(result.patches[0]?.node.type).toBe('tank')
    expect(result.patches[0]?.node.metadata?.resolver).toBe('native-tank')
  })

  test('falls back to primitive generation when catalog and native nodes do not match', () => {
    const result = resolve({
      id: 'electrolyzer',
      label: 'Electrolyzer stack array',
      role: 'electrolyzer',
      equipmentHint: 'industrial electrolyzer stack array',
      footprintHint: 'long',
    })

    expect(result.resolved).toBe(false)
    expect(result.resolver).toBe('primitive')
    expect(result.primitiveRequest?.station.role).toBe('electrolyzer')
    expect(result.patches).toEqual([])
  })

  test('attaches water electrolysis primitive equipment contracts', () => {
    const station: ProcessStationPlan = {
      id: 'electrolyzer',
      label: 'Electrolyzer stack array',
      role: 'electrolyzer',
      equipmentHint: 'industrial water electrolysis electrolyzer stack array',
      footprintHint: 'long',
    }
    const result = resolveProcessStationEquipment({
      plan: waterElectrolysisPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 4.8, width: 1.55 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: waterElectrolysisPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('primitive')
    expect(result.primitiveRequest?.equipmentContract).toMatchObject({
      equipmentFamily: 'skid.electrolyzer',
      envelope: { length: 4.8, width: 1.55, height: 2.1 },
    })
    expect(result.primitiveRequest?.equipmentContract?.ports.map((port) => port.id)).toContain(
      'hydrogen_out',
    )
    expect(result.primitiveRequest?.prompt).toContain('Fit inside envelope 4.8m x 1.55m x 2.1m')
  })

  test('attaches cement clinker primitive equipment contracts from process stations', () => {
    const station: ProcessStationPlan = {
      id: 'rotary_kiln',
      label: 'Rotary kiln',
      role: 'rotary_kiln',
      equipmentHint: 'cement.rotary_kiln long inclined rotary kiln',
      footprintHint: 'long',
    }
    const result = resolveProcessStationEquipment({
      plan: cementClinkerPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 6.4, width: 0.8 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: cementClinkerPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('primitive')
    expect(result.primitiveRequest?.equipmentContract).toMatchObject({
      profileId: 'cement.rotary_kiln',
      equipmentFamily: 'thermal_equipment',
      preferredResolver: 'primitive',
      envelope: { length: 6.4, width: 0.8, height: 0.9 },
    })
    expect(result.primitiveRequest?.equipmentContract?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(['hot_meal_in', 'clinker_out', 'kiln_exhaust_out', 'power_in']),
    )
    expect(result.primitiveRequest?.equipmentContract?.requiredRoles).toEqual(
      expect.arrayContaining(['vessel_shell', 'kiln_support_base', 'kiln_drive_unit']),
    )
    expect(result.primitiveRequest?.prompt).toContain('Equipment family: thermal_equipment.')
  })

  test('keeps raw meal feed elevator on the bucket elevator contract', () => {
    const station: ProcessStationPlan = {
      id: 'raw_meal_feed',
      label: 'Raw meal feed elevator',
      role: 'raw_meal_feed',
      equipmentHint: 'cement bucket elevator and raw meal feed chute feeding the preheater tower',
      footprintHint: 'tall',
    }
    const rawMealFeedPlan: ProcessLinePlan = {
      ...cementClinkerPlan,
      connections: [
        {
          fromStationId: 'raw_meal_feed',
          toStationId: 'preheater_tower',
          medium: 'material',
          visualKind: 'material_conveyor',
          fromPortId: 'raw_meal_out',
          toPortId: 'raw_meal_in',
        },
      ],
    }
    const result = resolveProcessStationEquipment({
      plan: rawMealFeedPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 1.2, width: 0.9 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: rawMealFeedPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('profile-parts')
    expect(result.primitiveRequest).toBeNull()
    expect(result.patches.length).toBeGreaterThan(1)
    const rootContract = result.patches[0]?.node.metadata?.equipmentContract
    expect(rootContract).toMatchObject({
      profileId: 'cement.bucket_elevator',
      equipmentFamily: 'material_handling',
      preferredResolver: 'profile-parts',
      envelope: { length: 1.2, width: 0.9, height: 6 },
    })
    expect(rootContract?.ports.map((port) => port.id)).toEqual(['raw_meal_in', 'raw_meal_out'])
    const generatedRoles = result.patches
      .map((patch) => patch.node.metadata?.generatedShape?.selector?.semanticRole)
      .filter(Boolean)
    expect(generatedRoles).toEqual(
      expect.arrayContaining([
        'elevator_leg_casing',
        'boot_section',
        'head_casing',
        'inlet_boot_hopper',
        'discharge_spout',
        'head_drive_unit',
        'head_service_platform',
      ]),
    )
  })

  test('attaches full cement plant primitive contracts for newly added industry equipment', () => {
    const station: ProcessStationPlan = {
      id: 'kiln_tail_esp',
      label: 'Kiln tail ESP',
      role: 'kiln_tail_esp',
      equipmentHint: 'cement.esp_dust_collector kiln tail electrostatic precipitator',
      footprintHint: 'large',
    }
    const result = resolveProcessStationEquipment({
      plan: cementPlantPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 5.2, width: 2.2 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: cementPlantPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('primitive')
    expect(result.primitiveRequest?.equipmentContract).toMatchObject({
      profileId: 'cement.esp_dust_collector',
      equipmentFamily: 'generic_industrial',
      preferredResolver: 'primitive',
      envelope: { length: 5.2, width: 2.2, height: 3.2 },
    })
    expect(result.primitiveRequest?.equipmentContract?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(['dust_gas_in', 'clean_air_out']),
    )
    expect(result.primitiveRequest?.equipmentContract?.requiredRoles).toEqual(
      expect.arrayContaining(['esp_collector_chambers', 'dust_hopper_bank']),
    )
  })

  test('keeps kiln hood stations on the kiln hood primitive profile', () => {
    const station: ProcessStationPlan = {
      id: 'kiln_hood',
      label: 'Kiln hood',
      role: 'kiln_hood',
      equipmentHint:
        'cement.kiln_hood kiln hood enclosing kiln head discharge, burner opening, and cooler inlet transition',
      footprintHint: 'medium',
    }
    const result = resolveProcessStationEquipment({
      plan: cementPlantPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 3.2, width: 2.4 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: cementPlantPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('primitive')
    expect(result.primitiveRequest?.equipmentContract).toMatchObject({
      profileId: 'cement.kiln_hood',
      equipmentFamily: 'thermal_equipment',
      preferredResolver: 'primitive',
    })
    expect(result.primitiveRequest?.equipmentContract?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(['kiln_head_in', 'burner_opening', 'hot_clinker_out']),
    )
  })

  test('keeps full cement plant MCC control equipment on catalog items before native boxes', () => {
    const station: ProcessStationPlan = {
      id: 'mcc_control',
      label: 'MCC and control cabinet',
      role: 'mcc_control',
      equipmentHint: 'industrial MCC motor control center and process control cabinet row',
      footprintHint: 'large',
    }
    const result = resolveProcessStationEquipment({
      plan: cementPlantPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 4.2, width: 0.9 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: cementPlantPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('catalog-item')
    expect(result.primitiveRequest).toBeNull()
    expect(result.patches[0]?.node.type).toBe('item')
    expect(result.patches[0]?.node.metadata?.equipmentContract).toMatchObject({
      equipmentFamily: 'electrical.mcc_control',
    })
  })

  test('keeps refinery tank-farm profiles on native editable tank nodes', () => {
    const station: ProcessStationPlan = {
      id: 'crude_storage_tank',
      label: 'Crude storage tank farm',
      role: 'crude_storage_tank',
      equipmentHint:
        'refinery.crude_storage_tank storage tank for crude oil tank farm with inlet outlet nozzles',
      footprintHint: 'large',
    }
    const result = resolveProcessStationEquipment({
      plan: refineryPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 5.6, width: 5.6 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: refineryPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('native-tank')
    expect(result.patches[0]?.node.type).toBe('tank')
    expect(result.patches[0]?.node.metadata).toMatchObject({
      resolver: 'native-tank',
      equipmentContract: {
        profileId: 'refinery.crude_storage_tank',
        preferredResolver: 'native-tank',
      },
    })
    expect(result.patches[0]?.node.metadata?.catalogItemId).toBeUndefined()
  })

  test('infers process ports from resource-pack profile parts', () => {
    const station = electrolyticAluminumPlan.stations[0]!
    const result = resolveProcessStationEquipment({
      plan: electrolyticAluminumPlan,
      station,
      stationPlacement: {
        ...placement,
        stationId: station.id,
        role: station.role,
        label: station.label,
        footprint: { length: 5, width: 2.4 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      metadata: {
        generatedBy: 'factory-agent',
        processId: electrolyticAluminumPlan.processId,
        stationId: station.id,
        stationRole: station.role,
      },
    })

    expect(result.resolver).toBe('profile-parts')
    expect(result.patches[0]?.node.metadata?.equipmentContract).toMatchObject({
      profileId: 'electrolytic_aluminum.molten_aluminum_holding_furnace',
      preferredResolver: 'profile-parts',
    })
    expect(
      result.patches[0]?.node.metadata?.equipmentContract?.ports.map(
        (port: { id: string }) => port.id,
      ),
    ).toContain('tap_spout')
  })
})
