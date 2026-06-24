import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import { fallbackFactoryPlan } from './factory-planner'
import { evaluateFactoryPrimitiveArtifactContract } from './factory-primitive-quality'
import {
  buildFactoryGeometryPrompt,
  buildFactoryPlacementSpec,
  buildFactoryRunResultFromGeometryDraft,
  buildFactoryRunResultFromPlan,
  buildFactoryRunResultFromProcessLine,
  buildFactoryRunResultFromSelectionEdit,
  failedFactoryRunStatus,
} from './factory-runner'
import type { PrimitiveGeometryGenerationRequest } from './primitive-generation-service'
import { composeProcessLine } from './process-line-composer'

const artifact: GeneratedGeometryArtifact = {
  id: 'ai_geometry_factory_test',
  title: 'Factory conveyor',
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
  transforms: [{ position: [0, 0.5, 0], rotation: [0, 0, 0] }],
  assemblyName: null,
  assemblyPosition: [0, 0.5, 0],
  createdNames: ['belt'],
  shapeDetails: '- belt',
}

const compactContract = {
  profileId: 'test.compact',
  equipmentFamily: 'skid.test',
  scaleClass: 'test',
  envelope: { length: 2, width: 1, height: 1, origin: 'station_profile' as const, tolerance: 0.05 },
  ports: [{ id: 'water_in', medium: 'water' as const, side: 'left' as const, height: 0.5 }],
}

function electrolyzerArtifactWithShiftedWaterPort(prompt: string): GeneratedGeometryArtifact {
  return {
    ...artifact,
    id: 'ai_geometry_electrolyzer',
    title: 'Electrolyzer stack array',
    sourceTool: 'compose_parts',
    sourceArgs: { family: 'skid.electrolyzer' },
    userPrompt: prompt,
    shapes: [
      {
        kind: 'box',
        name: 'Electrolyzer skid',
        position: [0, 0.12, 0],
        rotation: [0, 0, 0],
        length: 4.6,
        width: 1.45,
        height: 0.24,
      },
      {
        kind: 'box',
        name: 'Electrolyzer housing',
        position: [0, 0.92, 0],
        rotation: [0, 0, 0],
        length: 3.8,
        width: 1.1,
        height: 1.35,
        ports: [{ id: 'water_in', kind: 'inlet', position: [-1.7, 0.82, 0.44] }],
      },
    ],
    transforms: [
      { position: [0, 0.12, 0], rotation: [0, 0, 0] },
      { position: [0, 0.92, 0], rotation: [0, 0, 0] },
    ],
    assemblyName: 'Electrolyzer stack array',
    assemblyPosition: [0, 0, 0],
    createdNames: ['Electrolyzer skid', 'Electrolyzer housing'],
    shapeDetails: '- electrolyzer with shifted primitiveContract water_in port',
  }
}

function oversizedContractArtifact(
  request: PrimitiveGeometryGenerationRequest,
): GeneratedGeometryArtifact {
  const envelope = request.factoryEquipmentContract?.envelope ?? {
    length: 2,
    width: 1,
    height: 1,
    origin: 'station_profile' as const,
  }
  const role =
    request.factoryEquipmentContract?.profileId ?? request.placementIntent?.lineRole ?? 'equipment'
  return {
    ...artifact,
    id: `ai_geometry_${role.replace(/[^a-z0-9_-]+/gi, '_')}`,
    title: role,
    sourceTool: 'compose_parts',
    sourceArgs: { deviceProfile: request.factoryEquipmentContract?.profileId },
    userPrompt: request.prompt,
    shapes: [
      {
        kind: 'box',
        name: `${role} generated housing`,
        position: [0, envelope.height / 2, 0],
        rotation: [0, 0, 0],
        length: envelope.length * 1.25,
        width: envelope.width * 1.25,
        height: envelope.height * 0.8,
      },
    ],
    transforms: [{ position: [0, envelope.height / 2, 0], rotation: [0, 0, 0] }],
    assemblyName: role,
    assemblyPosition: [0, 0, 0],
    createdNames: [`${role} generated housing`],
    shapeDetails: `- ${role} generated housing`,
  }
}

describe('factory runner helpers', () => {
  test('builds an equipment-focused geometry prompt', () => {
    expect(
      buildFactoryGeometryPrompt('生成一台输送机', {
        equipmentName: 'belt conveyor',
        lineRole: 'main assembly line',
        desiredDimensions: { length: 3, width: 0.8 },
      }),
    ).toContain('Equipment: belt conveyor')
  })

  test('builds placement metadata from params before context', () => {
    const placement = buildFactoryPlacementSpec({
      context: { parentId: 'level_context', lineId: 'line_context', position: [1, 0, 1] },
      params: {
        parentId: 'level_params',
        lineId: 'line_params',
        lineRole: 'main-line',
        equipmentRole: 'conveyor',
        position: [4, 0, 5],
      },
    })

    expect(placement).toEqual({
      parentId: 'level_params',
      position: [4, 0, 5],
      rotation: undefined,
      generatedBy: 'factory-agent',
      metadata: {
        lineId: 'line_params',
        lineRole: 'main-line',
        equipmentRole: 'conveyor',
      },
    })
  })

  test('carries scene bounds from context into placement metadata', () => {
    const placement = buildFactoryPlacementSpec({
      context: {
        scene: {
          bounds: {
            min: [-10, -6],
            max: [10, 6],
            center: [0, 0],
            size: [20, 12],
          },
        },
      },
    })

    expect(placement.metadata).toMatchObject({
      sceneBounds: {
        min: [-10, -6],
        max: [10, 6],
        center: [0, 0],
        size: [20, 12],
      },
    })
  })

  test('carries building id from context into layout placement metadata', () => {
    const placement = buildFactoryPlacementSpec({
      context: { parentId: 'level_context', buildingId: 'building_context' },
    })

    expect(placement).toMatchObject({
      parentId: 'level_context',
      metadata: { buildingId: 'building_context' },
    })
  })

  test('returns artifact patches without applying them', () => {
    const result = buildFactoryRunResultFromGeometryDraft({
      prompt: '生成一台输送机',
      geometry: {
        runId: 'run_geometry',
        conversationId: 'factory:geometry',
        status: 'succeeded',
        artifact,
      },
      placement: {
        parentId: 'level_factory',
        position: [4, 0.5, 5],
        generatedBy: 'factory-agent',
        metadata: { lineId: 'line_a' },
      },
    })

    expect(result.applied).toBe(false)
    expect(result.artifact?.id).toBe('ai_geometry_factory_test')
    expect(result.patches).toHaveLength(1)
    expect(result.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'box',
        position: [4, 0.5, 5],
        metadata: {
          generatedBy: 'factory-agent',
          artifactId: 'ai_geometry_factory_test',
          lineId: 'line_a',
        },
      },
    })
    expect(result.missingAssets).toEqual([])
  })

  test('returns layout plans as editable scene patches without applying them', () => {
    const result = buildFactoryRunResultFromPlan({
      prompt: 'create a 3m x 3m house',
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      plan: {
        kind: 'layout',
        reason: 'house is layout',
        layoutType: 'house',
        suggestedOperations: ['create_room', 'add_door', 'add_window'],
      },
    })

    expect(result).toMatchObject({
      intent: { action: 'layout_plan' },
      applied: false,
      plannerSource: 'fallback',
      missingAssets: [],
    })
    expect(result?.patches.length).toBeGreaterThan(0)
    expect(result?.patches[0]).toMatchObject({ op: 'create', parentId: 'level_factory' })
    expect(
      result?.patches.some((patch) => patch.op === 'create' && patch.node.type === 'wall'),
    ).toBe(true)
    expect(
      result?.patches.some((patch) => patch.op === 'create' && patch.node.type === 'door'),
    ).toBe(true)
  })

  test('returns catalog item patches without applying them', () => {
    const result = buildFactoryRunResultFromPlan({
      prompt: 'factory straight pipe',
      plannerSource: 'fallback',
      placement: {
        parentId: 'level_factory',
        position: [2, 0, 3],
        generatedBy: 'factory-agent',
        metadata: { lineId: 'line_pipe' },
      },
      plan: {
        kind: 'catalog_item',
        reason: 'catalog match',
        catalogItemId: 'factory-straight-pipe',
        equipmentName: 'Factory Straight Pipe',
      },
    })

    expect(result).toMatchObject({
      intent: { action: 'place_catalog_item' },
      applied: false,
      patches: [
        {
          op: 'create',
          parentId: 'level_factory',
          node: {
            type: 'item',
            position: [2, 0, 3],
            asset: { id: 'factory-straight-pipe' },
            metadata: {
              generatedBy: 'factory-agent',
              catalogItemId: 'factory-straight-pipe',
              lineId: 'line_pipe',
            },
          },
        },
      ],
      missingAssets: [],
    })
  })

  test('fails run status when factory quality gate fails', () => {
    const result = buildFactoryRunResultFromPlan({
      prompt: 'create a 3m x 3m house',
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      plan: {
        kind: 'layout',
        reason: 'house is layout',
        layoutType: 'house',
        suggestedOperations: ['create_room'],
      },
    })
    if (!result) throw new Error('expected layout result')

    const status = failedFactoryRunStatus(
      {
        ...result,
        qualityReport: {
          score: 45,
          passed: false,
          summary: 'Factory quality failed (45/100).',
          issueCount: { error: 1, warning: 0, info: 0 },
          checks: {
            patchCount: result.patches.length,
            createdNodeCount: result.created.length,
            primitiveQualityCount: 0,
            catalogItemCount: 0,
            localAssetCount: 0,
            missingAssetCount: 0,
            duplicateNodeIdCount: 0,
            routeCollisionCount: 0,
          },
          issues: [
            {
              severity: 'error',
              code: 'layout_does_not_fit',
              message: 'Generated process layout does not fit.',
            },
          ],
        },
      },
      false,
      'fallback failure',
    )

    expect(status).toEqual({
      failed: true,
      error: 'Generated process layout does not fit.',
    })
  })

  test('fills process-line primitive gaps with generated equipment patches', async () => {
    const plan = fallbackFactoryPlan('创建一条化工厂水裂解车间')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = await buildFactoryRunResultFromProcessLine({
      prompt: '创建一条化工厂水裂解车间',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => ({
        runId: 'run_electrolyzer',
        conversationId: 'factory:geometry',
        status: 'succeeded',
        artifact: {
          ...artifact,
          id: 'ai_geometry_electrolyzer',
          title: 'Electrolyzer stack array',
          userPrompt: request.prompt,
        },
      }),
    })

    expect(result.intent.action).toBe('process_line_plan')
    expect(result.layoutDiagnostics).toEqual({
      fits: true,
      boundary: { length: 24, width: 9 },
      diagnostics: [],
    })
    expect(result.layoutStrategy).toMatchObject({ style: 'parallel_bays', repaired: true })
    expect(
      result.patches.some((patch) => patch.op === 'create' && patch.node.type === 'tank'),
    ).toBe(true)
    expect(
      result.patches.some((patch) => patch.op === 'create' && patch.node.type === 'pipe'),
    ).toBe(true)
    expect(
      result.patches.some((patch) => patch.op === 'create' && patch.node.type === 'pipe-fitting'),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.node.metadata?.artifactId === 'ai_geometry_electrolyzer' &&
          patch.node.metadata?.stationRole === 'electrolyzer',
      ),
    ).toBe(true)
    expect(result.missingAssets).toEqual([])
  })

  test('retries process-line primitive generation when the first attempt has no artifact', async () => {
    const plan = fallbackFactoryPlan('create a hydrogen electrolysis workshop')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const requests: PrimitiveGeometryGenerationRequest[] = []
    const result = await buildFactoryRunResultFromProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => {
        requests.push(request)
        if (requests.length === 1) {
          return {
            runId: 'run_electrolyzer_failed',
            conversationId: 'factory:geometry',
            status: 'failed',
            error: 'transient primitive failure',
          }
        }
        return {
          runId: 'run_electrolyzer_retry',
          conversationId: 'factory:geometry',
          status: 'succeeded',
          artifact: {
            ...artifact,
            id: 'ai_geometry_electrolyzer_retry',
            title: 'Electrolyzer stack array',
            userPrompt: request.prompt,
          },
        }
      },
    })

    expect(requests.map((request) => request.params?.primitiveAttempt)).toEqual([1, 2])
    expect(requests.map((request) => request.context?.primitiveAttempt)).toEqual([1, 2])
    expect(result.geometryRunId).toBe('run_electrolyzer_retry')
    expect(result.missingAssets).toEqual([])
    expect(
      result.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.node.metadata?.artifactId === 'ai_geometry_electrolyzer_retry',
      ),
    ).toBe(true)
  })

  test('passes process template source pack to primitive station generation', async () => {
    const plan = fallbackFactoryPlan('generate a cement clinker production line')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')
    expect(plan.process.sourcePack).toMatchObject({
      id: 'industry.cement.basic',
      version: '0.1.0',
      industry: 'cement',
    })

    const requests: PrimitiveGeometryGenerationRequest[] = []
    await buildFactoryRunResultFromProcessLine({
      prompt: 'generate a cement clinker production line',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => {
        requests.push(request)
        return {
          runId: 'run_missing',
          conversationId: 'factory:geometry',
          status: 'failed',
          error: 'not generated in this unit test',
        }
      },
    })

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.context?.industrySourcePack)).toBe(true)
    expect(requests[0]?.context?.industrySourcePack).toMatchObject({
      id: 'industry.cement.basic',
      version: '0.1.0',
      industry: 'cement',
    })
  })

  test('aligns cement primitive artifacts to contracts before quality gating', async () => {
    const plan = fallbackFactoryPlan('generate a cement clinker production line')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const requests: PrimitiveGeometryGenerationRequest[] = []
    const result = await buildFactoryRunResultFromProcessLine({
      prompt: 'generate a cement clinker production line',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => {
        requests.push(request)
        return {
          runId: `run_${requests.length}`,
          conversationId: 'factory:geometry',
          status: 'succeeded',
          artifact: oversizedContractArtifact(request),
        }
      },
    })

    const primitiveRoots = result.patches.filter(
      (patch) => patch.op === 'create' && patch.node.metadata?.factoryPrimitiveContractAlignment,
    )
    expect(result.missingAssets).toEqual([])
    expect(primitiveRoots.length).toBe(requests.length)
    expect(
      primitiveRoots.every(
        (patch) =>
          patch.op === 'create' &&
          patch.node.metadata?.factoryPrimitiveQuality &&
          (patch.node.metadata.factoryPrimitiveQuality as { passed?: boolean }).passed === true,
      ),
    ).toBe(true)
  })

  test('relabels factory primitive artifacts with station display labels before placement', async () => {
    const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = await buildFactoryRunResultFromProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => ({
        runId: `run_${request.params?.stationId ?? 'station'}`,
        conversationId: 'factory:geometry',
        status: 'succeeded',
        artifact: oversizedContractArtifact(request),
      }),
    })

    const kilnHoodRoot = result.patches.find(
      (patch) =>
        patch.op === 'create' &&
        patch.node.metadata?.stationId === 'kiln_hood' &&
        patch.node.metadata?.factoryPrimitiveContractAlignment,
    )
    expect(kilnHoodRoot?.node.name).toBe('\u7a91\u5934\u7f69')
    expect(kilnHoodRoot?.node.metadata).toMatchObject({
      equipmentContract: { profileId: 'cement.kiln_hood' },
    })
    expect(
      result.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.parentId === kilnHoodRoot?.node.id &&
          typeof patch.node.name === 'string' &&
          patch.node.name.startsWith('\u7a91\u5934\u7f69 '),
      ),
    ).toBe(true)
    expect(result.focusBounds).toMatchObject({ reason: 'factory-key-process' })
  })

  test('reroutes process connections to primitive artifact port markers after generation', async () => {
    const plan = fallbackFactoryPlan('创建一条化工厂水裂解车间')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = await buildFactoryRunResultFromProcessLine({
      prompt: '创建一条化工厂水裂解车间',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => ({
        runId: 'run_electrolyzer',
        conversationId: 'factory:geometry',
        status: 'succeeded',
        artifact: electrolyzerArtifactWithShiftedWaterPort(request.prompt),
      }),
    })
    const baseline = composeProcessLine({
      prompt: '创建一条化工厂水裂解车间',
      plan: plan.process,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      sections: { connections: false },
    })
    const electrolyzerPlacement = baseline.stationPlacements.find(
      (placement) => placement.stationId === 'electrolyzer',
    )
    if (!electrolyzerPlacement) throw new Error('missing electrolyzer placement')

    const waterPipeSegments = result.patches.filter(
      (patch) =>
        patch.op === 'create' &&
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'water_treatment' &&
        patch.node.metadata?.toStationId === 'electrolyzer',
    )
    const finalSegment = waterPipeSegments.find(
      (patch) =>
        patch.op === 'create' &&
        patch.node.type === 'pipe' &&
        patch.node.metadata?.routeSegmentIndex ===
          Number(patch.node.metadata.routeSegmentCount) - 1,
    )
    if (!finalSegment || finalSegment.node.type !== 'pipe') {
      throw new Error('expected final water pipe segment')
    }
    expect(finalSegment.node.metadata).toMatchObject({
      toPortId: 'water_in',
      toPortSource: 'artifact',
    })
    expect(finalSegment.node.end[0]).toBeLessThan(electrolyzerPlacement.position[0])
    expect(finalSegment.node.end[1]).toBeGreaterThan(electrolyzerPlacement.position[2])
  })

  test('returns missingAssets when geometry did not produce an artifact', () => {
    const result = buildFactoryRunResultFromGeometryDraft({
      prompt: '生成一台未知设备',
      geometry: {
        runId: 'run_geometry',
        conversationId: 'factory:geometry',
        status: 'failed',
        error: 'No geometry could be created.',
      },
      placement: { generatedBy: 'factory-agent' },
    })

    expect(result.applied).toBe(false)
    expect(result.patches).toEqual([])
    expect(result.missingAssets).toEqual([
      {
        name: '生成一台未知设备',
        reason: 'No geometry could be created.',
        required: true,
      },
    ])
  })

  test('returns selected object color edit update patches', () => {
    const result = buildFactoryRunResultFromSelectionEdit({
      prompt: 'make the selected object green',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            { id: 'assembly_1', type: 'assembly', children: ['box_1'] },
            { id: 'box_1', type: 'box', name: 'housing' },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      intent: { action: 'edit_selection' },
      applied: false,
      nodeIds: ['box_1'],
      editSummary: ['housing: color none -> #22c55e'],
      missingAssets: [],
      patches: [
        {
          op: 'update',
          id: 'box_1',
          data: {
            material: {
              properties: { color: '#22c55e' },
            },
            materialPreset: null,
          },
        },
      ],
    })
  })

  test('returns selected tank orientation edit update patches', () => {
    const result = buildFactoryRunResultFromSelectionEdit({
      prompt: '\u628a\u8fd9\u4e2a\u50a8\u7f50\u6539\u6210\u5367\u5f0f',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: ['assembly_1'],
          nodes: [
            { id: 'assembly_1', type: 'assembly', children: ['tank_1'] },
            { id: 'tank_1', type: 'tank', name: 'buffer tank', kind: 'vertical' },
          ],
        },
      },
    })

    expect(result).toMatchObject({
      intent: { action: 'edit_selection' },
      applied: false,
      nodeIds: ['tank_1'],
      missingAssets: [],
      patches: [{ op: 'update', id: 'tank_1', data: { kind: 'horizontal' } }],
    })
  })

  test('reports factory primitive envelope violations before placement', () => {
    const quality = evaluateFactoryPrimitiveArtifactContract({
      artifact: {
        ...artifact,
        shapes: [
          {
            kind: 'box',
            name: 'oversized skid',
            position: [0, 0.5, 0],
            rotation: [0, 0, 0],
            length: 4,
            width: 1,
            height: 1,
          },
        ],
        transforms: [{ position: [0, 0.5, 0], rotation: [0, 0, 0] }],
      },
      contract: compactContract,
    })

    expect(quality.passed).toBe(false)
    expect(quality.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'factory_primitive_envelope_exceeded',
    )
  })
})
