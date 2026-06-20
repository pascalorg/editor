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
