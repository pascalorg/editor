import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  buildPrimitiveGeometryGenerationRunInput,
  extractPrimitiveGeometryGenerationPayload,
  generatePrimitiveGeometryDraft,
  isGeneratedGeometryArtifact,
} from './primitive-generation-service'

const artifact: GeneratedGeometryArtifact = {
  id: 'ai_geometry_test',
  title: 'Test conveyor',
  sourceTool: 'compose_assembly',
  sourceArgs: { family: 'belt_conveyor' },
  userPrompt: 'generate a conveyor',
  version: 1,
  createdAt: '2026-06-18T00:00:00.000Z',
  shapes: [
    {
      kind: 'box',
      name: 'belt',
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      length: 3,
      width: 0.8,
      height: 0.2,
    },
  ],
  transforms: [{ position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  assemblyName: 'Test conveyor',
  assemblyPosition: [0, 0.5, 0],
  createdNames: ['belt'],
  shapeDetails: '- belt',
}

const electrolyzerContract = {
  profileId: 'hydrogen_electrolysis.electrolyzer_skid.compact',
  equipmentFamily: 'skid.electrolyzer',
  scaleClass: 'conceptual_compact',
  envelope: { length: 4.8, width: 1.55, height: 2.1, origin: 'station_profile' as const },
  ports: [
    { id: 'water_in', medium: 'water' as const, side: 'left' as const, height: 0.9 },
    { id: 'hydrogen_out', medium: 'hydrogen' as const, side: 'right' as const, height: 1.45 },
  ],
  preferredTool: 'compose_parts' as const,
}

describe('primitive generation service', () => {
  test('marks geometry requests as deferred placement runs', () => {
    const runInput = buildPrimitiveGeometryGenerationRunInput({
      prompt: '  generate a conveyor  ',
      recentMessages: [{ role: 'user', content: 'create a line' }],
      latestArtifactCandidate: artifact,
      placementIntent: { lineRole: 'main-line', desiredFootprint: [3, 1] },
    })

    expect(runInput.mode).toBe('primitive')
    expect(runInput.prompt).toBe('generate a conveyor')
    expect(runInput.conversationId).toBe('factory-agent')
    expect(runInput.params).toMatchObject({
      source: 'factory-agent',
      placement: 'deferred',
      placementIntent: { lineRole: 'main-line', desiredFootprint: [3, 1] },
    })
    expect(runInput.context.recentMessages).toHaveLength(1)
    expect(runInput.context.latestArtifactCandidate).toBe(artifact)
  })

  test('passes factory equipment contracts through primitive run input', () => {
    const runInput = buildPrimitiveGeometryGenerationRunInput({
      prompt: 'generate electrolyzer',
      source: 'factory-agent',
      factoryEquipmentContract: electrolyzerContract,
    })

    expect(runInput.context.factoryEquipmentContract).toBe(electrolyzerContract)
    expect(runInput.params).toMatchObject({
      factoryEquipmentContract: electrolyzerContract,
      equipmentFamily: 'skid.electrolyzer',
      equipmentProfileId: 'hydrogen_electrolysis.electrolyzer_skid.compact',
      preferredTool: 'compose_parts',
    })
  })

  test('extracts generated artifacts from primitive harness payloads', () => {
    expect(isGeneratedGeometryArtifact(artifact)).toBe(true)

    const payload = extractPrimitiveGeometryGenerationPayload({
      analysis: 'analysis',
      results: ['Created draft with 1 shapes'],
      artifact,
      metrics: { primitiveRoute: { route: 'deterministic' } },
    })

    expect(payload?.artifact?.id).toBe('ai_geometry_test')
    expect(payload?.shapeCount).toBe(1)
    expect(payload?.sourceTool).toBe('compose_assembly')
    expect(payload?.results).toEqual(['Created draft with 1 shapes'])
  })

  test('uses cloud industry profiles for strong equipment prompts without explicit pack context', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt: '\u751f\u4ea7\u4e00\u4e2a\u56de\u8f6c\u7a91',
      conversationId: `test-rotary-kiln-${Date.now()}`,
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact).toMatchObject({
      sourceTool: 'compose_parts',
      sourceArgs: {
        deviceProfile: 'cement.rotary_kiln',
        profileSource: 'imported_pack',
        profileSourcePack: {
          id: 'industry.cement.basic',
          version: '0.1.0',
          industry: 'cement',
        },
      },
    })
    expect(result.artifact?.sourceArgs.profileSource).toBe('imported_pack')
  })

  test('keeps bucket elevator boot equipment grounded below the head drive', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        'cement bucket elevator and raw meal feed chute feeding the preheater tower Process: Cement clinker production line. Station role: raw_meal_feed. Equipment family: material_handling. Scale class: industry_profile. Fit inside envelope 1.2m x 0.9m x 6m. Expose connection ports: raw_meal_out:material:right. Create a conceptual editable industrial equipment module only; do not include real operating parameters.',
      conversationId: `test-bucket-elevator-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('cement.bucket_elevator')
    const byRole = new Map(result.artifact?.shapes.map((shape) => [shape.semanticRole, shape]))
    expect(byRole.get('inlet_boot_hopper')?.position[1]).toBeLessThan(1.2)
    expect(byRole.get('boot_section')?.position[1]).toBeLessThan(0.6)
    expect(byRole.get('head_drive_unit')?.position[1]).toBeGreaterThan(4.5)
  })

  test('keeps clinker silo hopper grounded under a vertical vessel shell', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        'cement.clinker_silo tall clinker storage silo with top feed inlet and bottom discharge hopper Process: Cement clinker production line. Station role: clinker_silo. Equipment family: process_vessel. Scale class: industry_profile. Fit inside envelope 4m x 4m x 8m. Expose connection ports: top_feed_inlet:material:left, bottom_discharge_outlet:material:right. Create a conceptual editable industrial equipment module only; do not include real operating parameters.',
      conversationId: `test-clinker-silo-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('cement.clinker_silo')
    const byRole = new Map(result.artifact?.shapes.map((shape) => [shape.semanticRole, shape]))
    expect(byRole.get('silo_shell')?.axis).toBe('y')
    expect(byRole.get('silo_shell')?.position[1]).toBeGreaterThan(3)
    expect(byRole.get('bottom_discharge_hopper')?.position[1]).toBeLessThan(1.3)
    expect(byRole.get('hopper_outlet')?.position[1]).toBeLessThan(0.6)
    expect(byRole.get('top_feed_inlet')?.position[1]).toBeGreaterThan(6)
    expect(byRole.get('bottom_discharge_outlet')?.position[1]).toBeLessThan(1)
  })

  test('keeps clinker grate cooler as an enclosed cooler instead of a belt conveyor', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        '生成一个篦冷机，cement.grate_cooler horizontal push-type grate clinker cooler with enclosed casing, grate plate bed, under-grate cooling air plenum, hot clinker inlet hopper, and discharge chute; it must not be a belt conveyor.',
      conversationId: `test-grate-cooler-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))
    expect(roles.has('cooler_outer_casing')).toBe(true)
    expect(roles.has('cooler_grate_bed')).toBe(true)
    expect(roles.has('grate_plate_rows')).toBe(true)
    expect(roles.has('hot_clinker_inlet_transition')).toBe(true)
    expect(sourceKinds.has('belt_surface')).toBe(false)
    expect(sourceKinds.has('conveyor_frame')).toBe(false)
  })

  test('uses vertical mill-specific raw mill parts instead of generic panels only', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        'cement.vertical_raw_mill vertical roller raw mill with cylindrical mill body, conical grinding table housing, top dynamic separator, raw feed chute, hot gas inlet duct, and base gearbox drive.',
      conversationId: `test-vertical-raw-mill-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('cement.vertical_raw_mill')
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))
    expect(roles.has('mill_body')).toBe(true)
    expect(roles.has('grinding_table_housing')).toBe(true)
    expect(roles.has('dynamic_separator')).toBe(true)
    expect(roles.has('raw_feed_chute')).toBe(true)
    expect(roles.has('hot_gas_inlet')).toBe(true)
    expect(sourceKinds.has('cylindrical_tank')).toBe(true)
  })

  test('keeps kiln hood as a hood with kiln opening and clinker chute', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        'cement.kiln_hood kiln head hood for rotary cement kiln with refractory hood shell, large circular kiln head inlet, burner opening, hot clinker drop chute to grate cooler, secondary air return duct, and service platform.',
      conversationId: `test-kiln-hood-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('cement.kiln_hood')
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))
    expect(roles.has('kiln_hood_shell')).toBe(true)
    expect(roles.has('kiln_head_in')).toBe(true)
    expect(roles.has('burner_opening')).toBe(true)
    expect(roles.has('hot_clinker_drop_chute')).toBe(true)
    expect(roles.has('secondary_air_return_duct')).toBe(true)
    expect(sourceKinds.has('flange_ring')).toBe(true)
    expect(sourceKinds.has('belt_surface')).toBe(false)
  })

  test('keeps kiln burner as a multi-channel lance on carriage rails', async () => {
    const result = await generatePrimitiveGeometryDraft({
      prompt:
        'cement.kiln_burner multi-channel rotary kiln main burner with long burner lance, primary air channel, coal fuel pipe, gas oil lance, nozzle tip, mounting flange, fuel and air inlets, and retractable carriage rails.',
      conversationId: `test-kiln-burner-${Date.now()}`,
      source: 'factory-agent',
    })

    expect(result.status).toBe('succeeded')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('cement.kiln_burner')
    const roles = new Set(result.artifact?.shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(result.artifact?.shapes.map((shape) => shape.sourcePartKind))
    expect(roles.has('burner_lance')).toBe(true)
    expect(roles.has('primary_air_channel')).toBe(true)
    expect(roles.has('coal_fuel_pipe')).toBe(true)
    expect(roles.has('burner_mounting_flange')).toBe(true)
    expect(roles.has('multi_channel_nozzle_tip')).toBe(true)
    expect(roles.has('burner_carriage')).toBe(true)
    expect(sourceKinds.has('pipe_run')).toBe(true)
    expect(sourceKinds.has('belt_surface')).toBe(false)
  })

  test('rejects malformed artifacts while preserving non-artifact payload fields', () => {
    const payload = extractPrimitiveGeometryGenerationPayload({
      analysis: 'analysis only',
      results: ['No geometry could be created.'],
      artifact: { id: 'missing-required-fields' },
    })

    expect(payload?.artifact).toBeUndefined()
    expect(payload?.analysis).toBe('analysis only')
    expect(payload?.results).toEqual(['No geometry could be created.'])
  })

  test('returns deterministic factory e2e smoke artifacts without creating primitive runs', async () => {
    const previous = process.env.FACTORY_E2E_SMOKE
    process.env.FACTORY_E2E_SMOKE = '1'

    try {
      const result = await generatePrimitiveGeometryDraft({
        prompt: 'industrial water electrolysis electrolyzer stack array module',
        conversationId: 'factory:e2e',
        source: 'factory-agent',
        placementIntent: { requestedRole: 'electrolyzer' },
        factoryEquipmentContract: electrolyzerContract,
      })

      expect(result.status).toBe('succeeded')
      expect(result.runId.startsWith('run_factory_e2e_')).toBe(true)
      expect(result.artifact).toMatchObject({
        title: 'Electrolyzer stack array',
        sourceTool: 'factory_e2e_smoke',
        assemblyName: 'Electrolyzer stack array',
      })
      expect(result.artifact?.shapes).toHaveLength(3 + electrolyzerContract.ports.length)
      expect(result.artifact?.sourceArgs.factoryEquipmentContract).toBe(electrolyzerContract)
      expect(result.artifact?.shapes.some((shape) => shape.semanticRole === 'hydrogen_out')).toBe(
        true,
      )
      expect(result.payload?.metrics).toMatchObject({ smoke: true, role: 'electrolyzer' })
    } finally {
      if (previous === undefined) delete process.env.FACTORY_E2E_SMOKE
      else process.env.FACTORY_E2E_SMOKE = previous
    }
  })
})
