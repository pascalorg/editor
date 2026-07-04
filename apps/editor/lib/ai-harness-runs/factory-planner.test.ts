import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  buildFactoryPlannerPrompt,
  fallbackFactoryPlan,
  parseFactoryPlan,
  planFactoryRequest,
  shouldPreferFallbackFactoryPlan,
} from './factory-planner'
import {
  installIndustryPacksForTests,
  withIndustryPackDisabledForTests,
} from './test-industry-pack-setup'

describe('factory planner', () => {
  let restoreIndustryPacks: (() => Promise<void>) | undefined

  beforeAll(async () => {
    restoreIndustryPacks = await installIndustryPacksForTests([
      { id: 'industry.cement.basic', version: '0.1.0' },
      { id: 'industry.thermal-power.basic', version: '0.1.0' },
      { id: 'industry.refinery.basic', version: '0.1.0' },
      { id: 'industry.discrete-manufacturing.basic', version: '0.1.0' },
      { id: 'industry.process.basic', version: '0.1.0' },
      { id: 'industry.electrolytic-aluminum.basic', version: '0.1.0' },
    ])
  })

  afterAll(async () => {
    await restoreIndustryPacks?.()
  })

  test('routes house requests to layout instead of geometry', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u623f\u5b50')

    expect(plan).toMatchObject({
      kind: 'layout',
      layoutType: 'house',
    })
    if (plan.kind === 'layout') {
      expect(plan.suggestedOperations).toContain('create_room')
    }
  })

  test('extracts multi-story house height and roof intent from Chinese layout prompts', () => {
    const plan = fallbackFactoryPlan(
      '生成5米*10，高2米5的屋子，然后屋子上面还有一层，也是5米*10，高2米5。带屋顶。',
    )

    expect(plan).toMatchObject({
      kind: 'layout',
      layoutType: 'house',
      stories: 2,
      storyHeight: 2.5,
      hasRoof: true,
      roofType: 'gable',
    })
  })

  test('routes known catalog items to catalog_item', () => {
    const plan = fallbackFactoryPlan('factory straight pipe')

    expect(plan).toMatchObject({
      kind: 'catalog_item',
      catalogItemId: 'factory-straight-pipe',
    })
  })

  test('routes custom equipment to geometry', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u53f0\u8f93\u9001\u673a')

    expect(plan.kind).toBe('geometry')
  })

  test('routes construction-site crane subjects to geometry, not building layout', () => {
    const tower = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5efa\u7b51\u5de5\u5730\u5854\u540a',
    )
    const gantry = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5efa\u7b51\u5de5\u5730\u9f99\u95e8\u540a',
    )

    expect(tower).toMatchObject({ kind: 'geometry' })
    expect(gantry).toMatchObject({ kind: 'geometry' })
  })

  test('routes water electrolysis workshop to a process line', () => {
    const plan = fallbackFactoryPlan('create a hydrogen electrolysis workshop')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'water_electrolysis_hydrogen',
        layoutStyle: 'linear',
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.role)).toEqual(
        expect.arrayContaining([
          'water_treatment',
          'electrolyzer',
          'dc_power_supply',
          'hydrogen_separator',
          'oxygen_separator',
          'hydrogen_buffer',
          'cooling_loop',
          'control_and_safety',
        ]),
      )
    }
  })

  test('requires installing or enabling a cloud industry pack before using its template', async () => {
    const restoreCement = await withIndustryPackDisabledForTests({
      id: 'industry.cement.basic',
      version: '0.1.0',
    })
    try {
      const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')

      expect(plan).toMatchObject({
        kind: 'missing',
        missingName: expect.stringContaining('industry.cement.basic@0.1.0'),
      })
      if (plan.kind === 'missing') {
        expect(plan.reason).toContain('simulated cloud')
      }
    } finally {
      await restoreCement()
    }
  })

  test('routes cement clinker requests through the industry pack process template', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u719f\u6599\u4ea7\u7ebf')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_clinker_production_line',
        processLabel: 'Cement clinker production line',
        processDisplayLabel: '\u6c34\u6ce5\u719f\u6599\u4ea7\u7ebf',
        layoutStyle: 'linear',
        dimensions: { length: 34, width: 12 },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual([
        'raw_meal_feed',
        'preheater_tower',
        'rotary_kiln',
        'grate_cooler',
        'clinker_conveying',
        'clinker_silo',
        'bag_filter',
      ])
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'preheater_tower',
            toStationId: 'bag_filter',
            fromPortId: 'exhaust_gas_out',
            toPortId: 'dust_gas_in',
            visualKind: 'hot_gas_duct',
          }),
          expect.objectContaining({
            fromStationId: 'grate_cooler',
            toStationId: 'clinker_conveying',
            visualKind: 'material_conveyor',
          }),
        ]),
      )
    }
  })

  test('routes thermal power factory requests through the industry pack process template', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u706b\u7535\u5382')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'thermal_power_coal_fired_station',
        processLabel: 'Coal-fired thermal power station',
        processDisplayLabel: 'Coal-fired thermal power station',
        layoutStyle: 'parallel_bays',
        dimensions: { length: 72, width: 72 },
        sourcePack: {
          id: 'industry.thermal-power.basic',
          version: '0.1.0',
          industry: 'thermal-power',
        },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'natural_draft_cooling_tower',
          'boiler_island',
          'steam_turbine_generator',
          'generator_step_up_transformer',
          'switchyard',
        ]),
      )
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'steam_turbine_generator',
            toStationId: 'generator_step_up_transformer',
            visualKind: 'cable_tray',
          }),
          expect.objectContaining({
            fromStationId: 'generator_step_up_transformer',
            toStationId: 'switchyard',
            visualKind: 'cable_tray',
          }),
        ]),
      )
    }
  })

  test('routes standalone clinker process wording through one clinker process template', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u719f\u6599\u5de5\u5e8f')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_clinker_production_line',
        dimensions: { length: 34, width: 12 },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual([
        'raw_meal_feed',
        'preheater_tower',
        'rotary_kiln',
        'grate_cooler',
        'clinker_conveying',
        'clinker_silo',
        'bag_filter',
      ])
    }
  })

  test('routes full cement factory requests through the modular industry template', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_plant_full',
        processLabel: 'Full cement plant',
        processDisplayLabel: '\u6c34\u6ce5\u5de5\u5382',
        layoutStyle: 'parallel_bays',
        dimensions: { length: 80, width: 32 },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'limestone_crusher',
          'pre_homogenization',
          'raw_mill',
          'raw_meal_silo',
          'raw_meal_feed',
          'coal_mill',
          'preheater_tower',
          'rotary_kiln',
          'kiln_hood',
          'grate_cooler',
          'tertiary_air_duct',
          'kiln_tail_esp',
          'cement_mill',
          'cement_silo',
          'cement_packer',
          'sp_boiler',
          'aqc_boiler',
          'control_room',
        ]),
      )
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'preheater_tower',
            toStationId: 'kiln_tail_esp',
            fromPortId: 'exhaust_gas_out',
            toPortId: 'dust_gas_in',
            visualKind: 'hot_gas_duct',
          }),
          expect.objectContaining({
            fromStationId: 'clinker_crusher',
            toStationId: 'clinker_conveying',
            visualKind: 'material_conveyor',
          }),
          expect.objectContaining({
            fromStationId: 'control_room',
            toStationId: 'rotary_kiln',
            visualKind: 'cable_tray',
          }),
        ]),
      )
    }
  })

  test('routes clinker system wording through the modular architecture with AQC boiler', () => {
    const plan = fallbackFactoryPlan('cement clinker system')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_plant_full',
        architecture: {
          scopeId: 'clinker_system',
        },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining(['grate_cooler', 'sp_boiler', 'aqc_boiler', 'clinker_silo']),
      )
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'grate_cooler',
            toStationId: 'aqc_boiler',
            visualKind: 'hot_gas_duct',
          }),
        ]),
      )
    }
  })

  test('routes refinery requests through corrected refinery process topology', () => {
    const plan = fallbackFactoryPlan('oil refinery')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'refinery_basic_complex',
        layoutStyle: 'parallel_bays',
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'atmospheric_distillation_unit',
          'vacuum_distillation_unit',
          'delayed_coker_unit',
          'fluid_catalytic_cracking_unit',
          'gas_fractionation_unit',
          'hydrotreating_unit',
          'catalytic_reformer_unit',
          'flare_system',
        ]),
      )
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'vacuum_distillation_unit',
            toStationId: 'delayed_coker_unit',
          }),
          expect.objectContaining({
            fromStationId: 'fluid_catalytic_cracking_unit',
            toStationId: 'gas_fractionation_unit',
          }),
          expect.objectContaining({
            fromStationId: 'catalytic_reformer_unit',
            toStationId: 'hydrotreating_unit',
            medium: 'hydrogen',
          }),
          expect.objectContaining({
            fromStationId: 'pipe_rack',
            toStationId: 'flare_system',
          }),
        ]),
      )
      expect(plan.process.connections).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fromStationId: 'fluid_catalytic_cracking_unit',
            toStationId: 'flare_system',
          }),
        ]),
      )
    }
  })

  test('uses refinery architecture scopes for CDU-only and conversion-only requests', () => {
    const cduPlan = fallbackFactoryPlan('crude distillation only refinery plant')
    const conversionPlan = fallbackFactoryPlan(
      'refinery plant conversion area FCC hydrotreating reformer',
    )

    expect(cduPlan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'refinery_basic_complex',
        architecture: { scopeId: 'cdu_only' },
      },
    })
    if (cduPlan.kind === 'process_line') {
      expect(cduPlan.process.stations.map((station) => station.id)).toEqual([
        'crude_storage_tank',
        'desalter',
        'atmospheric_distillation_unit',
        'vacuum_distillation_unit',
        'intermediate_storage_tank',
        'product_storage_tank',
        'pipe_rack',
      ])
    }

    expect(conversionPlan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'refinery_basic_complex',
        architecture: { scopeId: 'conversion_only' },
      },
    })
    if (conversionPlan.kind === 'process_line') {
      expect(conversionPlan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'delayed_coker_unit',
          'fluid_catalytic_cracking_unit',
          'gas_fractionation_unit',
          'hydrotreating_unit',
          'catalytic_reformer_unit',
        ]),
      )
    }
  })

  test('routes discrete manufacturing workshop through the industry pack process template', () => {
    const plan = fallbackFactoryPlan('discrete manufacturing workshop')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'discrete_manufacturing_flexible_workshop',
        processLabel: 'Discrete manufacturing flexible workshop',
        processDisplayLabel: '\u79bb\u6563\u5236\u9020\u67d4\u6027\u8f66\u95f4',
        layoutStyle: 'parallel_bays',
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'cnc_machining_center',
          'robot_workcell',
          'assembly_workstation',
          'roller_conveyor',
          'vision_inspection_station',
          'packaging_station',
          'agv_tugger',
          'storage_rack',
          'line_control_cabinet',
          'fixture_table',
          'test_bench',
          'material_cart',
          'palletizing_workcell',
        ]),
      )
      expect(plan.process.sourcePack).toMatchObject({
        id: 'industry.discrete-manufacturing.basic',
        version: '0.1.0',
      })
    }
  })

  test('routes process industry plant through the process foundation pack', () => {
    const plan = fallbackFactoryPlan('生成一个流程行业基础工厂')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'process_industry_basic_plant',
        processLabel: 'Process industry basic plant',
        processDisplayLabel: '流程行业基础工厂',
        layoutStyle: 'parallel_bays',
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'raw_material_tank',
          'metering_pump_skid',
          'mixing_tank',
          'stirred_reactor',
          'heat_exchanger',
          'filter_vessel',
          'centrifuge',
          'pipe_corridor',
          'control_cabinet',
          'bulk_material_silo',
          'utility_blower',
          'air_compressor_skid',
          'valve_station',
        ]),
      )
      expect(plan.process.sourcePack).toMatchObject({
        id: 'industry.process.basic',
        version: '0.1.0',
      })
    }
  })

  test('keeps electrolytic aluminum factory generation on a single potline', () => {
    const plan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u7535\u89e3\u94dd\u5382\uff0c\u4e24\u4e2a\u7535\u89e3\u69fd\u5217',
    )

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: { processId: 'electrolytic_aluminum_smelter_full' },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'rectifier_transformer_station',
          'alumina_storage_silo',
          'alumina_conveying_line',
          'potline_module',
          'pot_tending_crane',
          'dry_scrubber_baghouse',
        ]),
      )
      expect(plan.process.stations.map((station) => station.id)).not.toEqual(
        expect.arrayContaining([
          'potline_module_2',
          'pot_tending_crane_2',
          'dc_busbar_distribution',
          'alumina_feed_distribution',
          'potline_fume_collection_header',
        ]),
      )
      expect(plan.process.architecture).toMatchObject({
        id: 'electrolytic_aluminum.smelter.modular_potline',
      })
    }
  })

  test('keeps cement factory generation on the default single production line', () => {
    const plan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5382\uff0c\u4e24\u4e2a\u719f\u6599\u5de5\u5e8f\uff0c\u56db\u4e2a\u6c34\u6ce5\u5de5\u5e8f',
    )

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: { processId: 'cement_plant_full' },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'preheater_tower',
          'rotary_kiln',
          'kiln_burner',
          'grate_cooler',
          'cement_mill',
          'cement_silo',
        ]),
      )
      expect(plan.process.stations.map((station) => station.id)).not.toEqual(
        expect.arrayContaining([
          'preheater_tower_2',
          'rotary_kiln_2',
          'kiln_burner_2',
          'cement_mill_2',
          'cement_mill_3',
          'cement_mill_4',
          'raw_meal_distribution',
          'clinker_distribution',
        ]),
      )
      expect(plan.process.connections).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toStationId: 'preheater_tower_2' }),
          expect.objectContaining({ toStationId: 'cement_mill_4' }),
        ]),
      )
      expect(plan.process.architecture).toMatchObject({
        id: 'cement.plant.modular_outdoor',
      })
      expect(plan.process.dimensions).toEqual({ length: 80, width: 32 })
    }
  })

  test('uses factory architecture tree to narrow cement plant requests to one station', () => {
    const plan = fallbackFactoryPlan('generate a cement plant preheater tower')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_plant_full',
        layoutStyle: 'cell',
        architecture: {
          id: 'cement.plant.modular_outdoor',
          moduleIds: ['clinker_production'],
          zoneDisplay: 'subtle',
        },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(['preheater_tower'])
      expect(plan.process.connections).toEqual([])
      expect(plan.process.dimensions?.length).toBeGreaterThanOrEqual(10)
    }
  })

  test('routes chemical factory reactor equipment to geometry instead of factory layout', () => {
    const plan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    )

    expect(plan).toMatchObject({
      kind: 'geometry',
      equipmentName:
        '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    })
  })

  test('prefers geometry fallback when LLM mistakes equipment context for factory layout', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u5316\u5de5\u5382\u7684\u53cd\u5e94\u91dc\u88c5\u7f6e',
    )
    const llmPlan = {
      kind: 'layout' as const,
      reason: 'chemical factory background',
      layoutType: 'factory' as const,
      suggestedOperations: ['create_room'],
    }

    expect(fallbackPlan.kind).toBe('geometry')
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('keeps full production lines on the layout route even if LLM asks for geometry', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf',
    )
    const llmPlan = {
      kind: 'geometry' as const,
      reason: 'generate a custom machine',
      equipmentName: '\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf',
    }

    expect(fallbackPlan).toMatchObject({
      kind: 'layout',
      layoutType: 'production_line',
    })
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('prefers production-line fallback when LLM only sees a generic factory layout', () => {
    const fallbackPlan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u4ea7\u7ebf\uff0c\u653e\u5728\u5382\u623f\u4e2d\u95f4',
    )
    const llmPlan = {
      kind: 'layout' as const,
      reason: 'factory shell',
      layoutType: 'factory' as const,
      suggestedOperations: ['create_room'],
    }

    expect(fallbackPlan).toMatchObject({
      kind: 'layout',
      layoutType: 'production_line',
    })
    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(true)
  })

  test('parses fenced JSON planner output', () => {
    const plan = parseFactoryPlan(
      '```json\n{"kind":"layout","reason":"room work","layoutType":"room","suggestedOperations":["create_room"]}\n```',
      '\u521b\u5efa\u623f\u95f4',
    )

    expect(plan).toEqual({
      kind: 'layout',
      reason: 'room work',
      layoutType: 'room',
      suggestedOperations: ['create_room'],
    })
  })

  test('uses explicit industry template stations when LLM only names a known process', () => {
    const plan = parseFactoryPlan(
      JSON.stringify({
        kind: 'process_line',
        reason: 'known cement plant process',
        process: {
          processId: 'cement_plant_full',
          processLabel: '\u6c34\u6ce5\u751f\u4ea7\u7ebf',
        },
      }),
      '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382',
    )

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_plant_full',
        layoutStyle: 'parallel_bays',
        dimensions: { length: 80, width: 32 },
      },
    })
    if (plan?.kind === 'process_line') {
      expect(plan.process.stations).toHaveLength(28)
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'limestone_crusher',
          'raw_meal_feed',
          'kiln_hood',
          'cement_packer',
          'control_room',
        ]),
      )
      expect(plan.process.stations.map((station) => station.id)).not.toContain('S1')
    }
  })

  test('keeps explicit expanded topology over the default process template', () => {
    const fallbackPlan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')
    if (fallbackPlan.kind !== 'process_line') throw new Error('expected process line fallback')
    const llmPlan = {
      kind: 'process_line' as const,
      reason: 'customized cement factory',
      process: {
        ...fallbackPlan.process,
        stations: [
          ...fallbackPlan.process.stations,
          {
            ...fallbackPlan.process.stations.find((station) => station.id === 'cement_mill')!,
            id: 'cement_mill_2',
            label: 'Cement mill 2',
          },
        ],
        connections: [
          ...fallbackPlan.process.connections,
          {
            fromStationId: 'clinker_silo',
            toStationId: 'cement_mill_2',
            medium: 'material' as const,
            visualKind: 'material_conveyor' as const,
          },
        ],
      },
    }

    expect(shouldPreferFallbackFactoryPlan(llmPlan, fallbackPlan)).toBe(false)
  })

  test('prefers the complete industry template over a shorter LLM process summary', () => {
    const fallbackPlan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')
    const llmPlan = parseFactoryPlan(
      JSON.stringify({
        kind: 'process_line',
        reason: 'summarized cement factory',
        process: {
          processLabel: '\u6c34\u6ce5\u751f\u4ea7\u6d41\u7a0b',
          domain: 'chemical',
          layoutStyle: 'linear',
          stations: [
            {
              id: 'crushing',
              label: '\u77f3\u7070\u77f3\u7834\u788e',
              role: '\u7834\u788e\u5de5\u6bb5',
            },
            {
              id: 'preheater',
              label: '\u9884\u70ed\u5668',
              role: '\u9884\u70ed\u5de5\u6bb5',
            },
            { id: 'kiln', label: '\u56de\u8f6c\u7a91', role: '\u7145\u70e7\u5de5\u6bb5' },
          ],
        },
      }),
      '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382',
    )

    expect(fallbackPlan).toMatchObject({
      kind: 'process_line',
      process: { processId: 'cement_plant_full' },
    })
    expect(llmPlan).toMatchObject({ kind: 'process_line' })
    expect(shouldPreferFallbackFactoryPlan(llmPlan!, fallbackPlan)).toBe(true)
  })

  test('planner prompt includes strict output schema', () => {
    const prompt = buildFactoryPlannerPrompt('\u751f\u6210\u4e00\u4e2a\u8f66\u95f4')

    expect(prompt).toContain(
      '"kind": "layout" | "process_line" | "catalog_item" | "geometry" | "missing"',
    )
    expect(prompt).toContain('User request: \u751f\u6210\u4e00\u4e2a\u8f66\u95f4')
  })

  test('e2e smoke mode uses fallback planning without external AI', async () => {
    const previous = process.env.FACTORY_E2E_SMOKE
    process.env.FACTORY_E2E_SMOKE = '1'

    try {
      const planned = await planFactoryRequest({
        prompt: 'create a hydrogen electrolysis workshop',
      })

      expect(planned.source).toBe('fallback')
      expect(planned.plan).toMatchObject({
        kind: 'process_line',
        process: { processId: 'water_electrolysis_hydrogen' },
      })
    } finally {
      if (previous === undefined) delete process.env.FACTORY_E2E_SMOKE
      else process.env.FACTORY_E2E_SMOKE = previous
    }
  })

  test('run-level e2e smoke mode uses fallback planning without external AI', async () => {
    const planned = await planFactoryRequest({
      prompt: '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382',
      params: { e2eSmoke: true },
    })

    expect(planned.source).toBe('fallback')
    expect(planned.plan).toMatchObject({
      kind: 'process_line',
      process: { processId: 'cement_plant_full' },
    })
    if (planned.plan.kind === 'process_line') {
      expect(planned.plan.process.stations).toHaveLength(28)
    }
  })
})
