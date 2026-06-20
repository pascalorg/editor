import { describe, expect, test } from 'bun:test'
import {
  buildFactoryPlannerPrompt,
  fallbackFactoryPlan,
  parseFactoryPlan,
  planFactoryRequest,
  shouldPreferFallbackFactoryPlan,
} from './factory-planner'

describe('factory planner', () => {
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

  test('routes water electrolysis workshop to a process line', () => {
    const plan = fallbackFactoryPlan('创建一条化工厂水裂解车间')

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

  test('routes full cement factory requests through the modular industry template', () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: {
        processId: 'cement_plant_full',
        processLabel: 'Full cement plant',
        processDisplayLabel: '\u6c34\u6ce5\u5de5\u5382',
        layoutStyle: 'parallel_bays',
        dimensions: { length: 66, width: 28 },
      },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'limestone_crusher',
          'pre_homogenization',
          'raw_mill',
          'raw_meal_silo',
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
          'whr_boiler',
          'mcc_control',
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
            fromStationId: 'mcc_control',
            toStationId: 'rotary_kiln',
            visualKind: 'cable_tray',
          }),
        ]),
      )
    }
  })

  test('expands cement factory process quantities from explicit user wording', () => {
    const plan = fallbackFactoryPlan(
      '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5382\uff0c\u6709\u4e24\u4e2a\u719f\u6599\u5de5\u5e8f\uff0c\u8f93\u51fa\u7684\u719f\u6599\u5230\u56db\u4e2a\u78e8\u673a',
    )

    expect(plan).toMatchObject({
      kind: 'process_line',
      process: { processId: 'cement_plant_full' },
    })
    if (plan.kind === 'process_line') {
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining([
          'preheater_tower_2',
          'rotary_kiln_2',
          'cement_mill_2',
          'cement_mill_3',
          'cement_mill_4',
        ]),
      )
      expect(plan.process.connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromStationId: 'clinker_silo', toStationId: 'cement_mill_4' }),
          expect.objectContaining({ fromStationId: 'rotary_kiln_2', toStationId: 'kiln_hood_2' }),
        ]),
      )
      expect(plan.process.stations).toHaveLength(28)
      expect(plan.process.dimensions?.length).toBeGreaterThan(66)
      expect(plan.process.dimensions?.width).toBeGreaterThan(28)
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
        dimensions: { length: 66, width: 28 },
      },
    })
    if (plan?.kind === 'process_line') {
      expect(plan.process.stations).toHaveLength(21)
      expect(plan.process.stations.map((station) => station.id)).toEqual(
        expect.arrayContaining(['limestone_crusher', 'kiln_hood', 'cement_packer', 'mcc_control']),
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
      expect(planned.plan.process.stations).toHaveLength(21)
    }
  })
})
