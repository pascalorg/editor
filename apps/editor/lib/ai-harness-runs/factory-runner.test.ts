import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
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
  buildFactoryRunResultFromSingleEquipmentPrompt,
  failedFactoryRunStatus,
} from './factory-runner'
import {
  generatePrimitiveGeometryDraft,
  type PrimitiveGeometryGenerationRequest,
} from './primitive-generation-service'
import { composeProcessLine } from './process-line-composer'
import { installIndustryPacksForTests } from './test-industry-pack-setup'

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

async function ensureFactoryEquipmentPluginLoaded() {
  if (nodeRegistry.has('factory:pump') && nodeRegistry.has('factory:tank')) return
  await loadPlugin(factoryEquipmentPlugin)
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
  let restoreIndustryPacks: (() => Promise<void>) | undefined

  beforeAll(async () => {
    restoreIndustryPacks = await installIndustryPacksForTests([
      { id: 'industry.cement.basic', version: '0.1.0' },
      { id: 'industry.thermal-power.basic', version: '0.1.0' },
      { id: 'industry.refinery.basic', version: '0.1.0' },
    ])
  })

  afterAll(async () => {
    await restoreIndustryPacks?.()
  })

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

  test('carries site bounds from context into placement metadata', () => {
    const placement = buildFactoryPlacementSpec({
      context: {
        scene: {
          site: {
            id: 'site_default',
            isDefault: true,
            bounds: {
              min: [-15, -15],
              max: [15, 15],
              center: [0, 0],
              size: [30, 30],
            },
          },
        },
      },
    })

    expect(placement.metadata).toMatchObject({
      siteId: 'site_default',
      siteIsDefault: true,
      siteBounds: {
        min: [-15, -15],
        max: [15, 15],
        center: [0, 0],
        size: [30, 30],
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
    expect(result.patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'create',
          parentId: 'level_factory',
          node: expect.objectContaining({
            type: 'assembly',
            position: [4, 0.5, 5],
            metadata: expect.objectContaining({
              generatedBy: 'factory-agent',
              artifactId: 'ai_geometry_factory_test',
              lineId: 'line_a',
            }),
          }),
        }),
        expect.objectContaining({
          op: 'create',
          node: expect.objectContaining({
            type: 'box',
            metadata: expect.objectContaining({
              generatedBy: 'ai-geometry',
              artifactId: 'ai_geometry_factory_test',
            }),
          }),
        }),
      ]),
    )
    expect(result.missingAssets).toEqual([])
  })

  test('compiles a pump prompt to a semantic assembly before primitive draft fallback', async () => {
    await ensureFactoryEquipmentPluginLoaded()

    const result = buildFactoryRunResultFromSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u79bb\u5fc3\u6cf5',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result).toMatchObject({
      intent: { action: 'generate_equipment_draft' },
      applied: false,
      missingAssets: [],
      qualityReport: {
        passed: true,
        checks: { factoryNodeCount: 0, equipmentContractCount: 1 },
      },
    })
    expect(result?.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: {
        type: 'assembly',
        metadata: {
          resolver: 'semantic-assembly',
          equipmentAssembly: {
            kind: 'semantic-assembly',
            profileId: 'generic.centrifugal_pump',
          },
          equipmentContract: { profileId: 'generic.centrifugal_pump' },
        },
      },
    })
    expect(
      result?.patches.some((patch) => patch.op === 'create' && patch.node.type === 'factory:pump'),
    ).toBe(false)
    expect(result?.patches.map((patch) => patch.node.metadata?.semanticRole)).toEqual(
      expect.arrayContaining(['support_base', 'drive_motor', 'volute_casing']),
    )
  })

  test('compiles a tank prompt to a semantic assembly before primitive draft fallback', async () => {
    await ensureFactoryEquipmentPluginLoaded()

    const result = buildFactoryRunResultFromSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u50a8\u7f50',
      placement: { generatedBy: 'factory-agent' },
    })

    expect(result?.patches[0]).toMatchObject({
      op: 'create',
      node: {
        type: 'assembly',
        metadata: {
          resolver: 'semantic-assembly',
          equipmentAssembly: {
            kind: 'semantic-assembly',
            profileId: 'generic.vertical_tank',
          },
          equipmentContract: { profileId: 'generic.vertical_tank' },
        },
      },
    })
    expect(
      result?.patches.some((patch) => patch.op === 'create' && patch.node.type === 'factory:tank'),
    ).toBe(false)
    expect(result?.patches.map((patch) => patch.node.metadata?.semanticRole)).toEqual(
      expect.arrayContaining(['vessel_shell', 'inlet_port', 'outlet_port', 'access_ladder']),
    )
  })

  test('keeps unknown single equipment on the primitive draft fallback path', async () => {
    await ensureFactoryEquipmentPluginLoaded()

    const result = buildFactoryRunResultFromSingleEquipmentPrompt({
      prompt: '\u751f\u6210\u4e00\u4e2a\u5947\u602a\u7684\u79d1\u5e7b\u88c5\u7f6e',
      placement: { generatedBy: 'factory-agent' },
    })

    expect(result).toBeNull()
  })

  test('edits selected factory equipment by updating node parameters', async () => {
    await ensureFactoryEquipmentPluginLoaded()

    const result = buildFactoryRunResultFromSelectionEdit({
      prompt:
        '\u628a\u8fd9\u4e2a\u79bb\u5fc3\u6cf5\u6539\u6210 3 \u7c73\u957f\u7684\u7ea2\u8272\u8ba1\u91cf\u6cf5',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: ['pump_1'],
          nodes: [{ id: 'pump_1', type: 'factory:pump', name: 'Pump 1' }],
        },
      },
    })

    expect(result).toMatchObject({
      intent: { action: 'edit_selection' },
      patches: [
        {
          op: 'update',
          id: 'pump_1',
          data: {
            length: 3,
            casingColor: '#ef4444',
            pumpType: 'metering',
          },
        },
      ],
    })
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

  test('expands the default site when a generated factory shell exceeds it', () => {
    const result = buildFactoryRunResultFromPlan({
      prompt: 'generate a refinery',
      plannerSource: 'fallback',
      placement: {
        parentId: 'level_factory',
        generatedBy: 'factory-agent',
        metadata: {
          siteId: 'site_default',
          siteIsDefault: true,
          siteBounds: {
            min: [-15, -15],
            max: [15, 15],
            center: [0, 0],
            size: [30, 30],
          },
        },
      },
      params: { length: 60, width: 42, omitPerimeterWalls: true },
      plan: {
        kind: 'layout',
        reason: 'factory workshop',
        layoutType: 'factory',
        suggestedOperations: ['create_room'],
      },
    })

    const sitePatch = result?.patches.find(
      (patch) => patch.op === 'update' && patch.id === 'site_default',
    )
    expect(sitePatch).toMatchObject({
      op: 'update',
      id: 'site_default',
      data: {
        polygon: {
          type: 'polygon',
          points: [
            [-34, -25],
            [34, -25],
            [34, 25],
            [-34, 25],
          ],
        },
      },
    })
  })

  test('does not expand a user-defined site automatically', () => {
    const result = buildFactoryRunResultFromPlan({
      prompt: 'generate a refinery',
      plannerSource: 'fallback',
      placement: {
        parentId: 'level_factory',
        generatedBy: 'factory-agent',
        metadata: {
          siteId: 'site_custom',
          siteIsDefault: false,
          siteBounds: {
            min: [-15, -15],
            max: [15, 15],
            center: [0, 0],
            size: [30, 30],
          },
        },
      },
      params: { length: 60, width: 42, omitPerimeterWalls: true },
      plan: {
        kind: 'layout',
        reason: 'factory workshop',
        layoutType: 'factory',
        suggestedOperations: ['create_room'],
      },
    })

    expect(
      result?.patches.some((patch) => patch.op === 'update' && patch.id === 'site_custom'),
    ).toBe(false)
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
            equipmentContractCount: 0,
            factoryNodeCount: 0,
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
      result.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.node.type === 'assembly' &&
          patch.node.metadata?.equipmentAssembly &&
          patch.node.metadata?.stationId === 'hydrogen_separator',
      ),
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

  test('compiles process-line pump stations into semantic assemblies and connects profile ports', async () => {
    await ensureFactoryEquipmentPluginLoaded()

    const plan = {
      kind: 'process_line' as const,
      reason: 'pump transfer line',
      process: {
        processId: 'chemical_pump_transfer',
        processLabel: 'Chemical pump transfer line',
        domain: 'chemical' as const,
        layoutStyle: 'linear' as const,
        dimensions: { length: 12, width: 5 },
        stations: [
          {
            id: 'feed_pump',
            label: 'Feed centrifugal pump',
            role: 'pump',
            equipmentHint: 'centrifugal pump skid',
          },
          {
            id: 'booster_pump',
            label: 'Booster centrifugal pump',
            role: 'pump',
            equipmentHint: 'centrifugal pump',
          },
        ],
        connections: [
          {
            fromStationId: 'feed_pump',
            toStationId: 'booster_pump',
            medium: 'water' as const,
            visualKind: 'pipe' as const,
            fromPortId: 'outlet',
            toPortId: 'inlet',
          },
        ],
      },
    }

    const result = await buildFactoryRunResultFromProcessLine({
      prompt: 'create a chemical centrifugal pump transfer line',
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async () => {
        throw new Error('semantic assembly resolver should not request primitive geometry')
      },
    })

    const pumpAssemblies = result.patches.filter(
      (patch) =>
        patch.op === 'create' &&
        patch.node.type === 'assembly' &&
        ['feed_pump', 'booster_pump'].includes(String(patch.node.metadata?.stationId)),
    )
    expect(pumpAssemblies).toHaveLength(2)
    expect(
      result.patches.some((patch) => patch.op === 'create' && patch.node.type === 'factory:pump'),
    ).toBe(false)

    const feedPump = pumpAssemblies.find(
      (patch) => patch.op === 'create' && patch.node.metadata?.stationId === 'feed_pump',
    )
    expect(feedPump?.node.metadata).toMatchObject({
      resolver: 'semantic-assembly',
      factoryRouteObstacle: {
        source: 'profile-parts',
        stationId: 'feed_pump',
        box: {
          minX: expect.any(Number),
          maxX: expect.any(Number),
          minZ: expect.any(Number),
          maxZ: expect.any(Number),
        },
      },
      equipmentAssembly: {
        kind: 'semantic-assembly',
        profileId: 'generic.centrifugal_pump',
        editablePartRoles: expect.arrayContaining(['support_base', 'drive_motor', 'volute_casing']),
      },
      equipmentContract: {
        profileId: 'generic.centrifugal_pump',
        envelope: { length: 2.6, width: 1.1, height: 1.4 },
      },
    })
    const feedPumpChildren = result.patches.filter(
      (patch) => feedPump?.op === 'create' && patch.parentId === feedPump.node.id,
    )
    expect(feedPumpChildren.length).toBeGreaterThan(0)
    expect(feedPumpChildren.map((patch) => patch.node.metadata?.semanticRole)).toEqual(
      expect.arrayContaining([
        'support_base',
        'drive_motor',
        'volute_casing',
        'inlet_port',
        'outlet_port',
      ]),
    )

    const pipe = result.patches.find((patch) => patch.op === 'create' && patch.node.type === 'pipe')
    expect(pipe?.node.metadata).toMatchObject({
      fromStationId: 'feed_pump',
      toStationId: 'booster_pump',
      fromPortId: 'outlet',
      fromPortSource: 'profile',
      toPortId: 'inlet',
      toPortSource: 'profile',
    })
    expect(result.qualityReport).toMatchObject({
      passed: true,
      checks: {
        factoryNodeCount: 0,
        equipmentContractCount: 2,
        primitiveQualityCount: 0,
        routeCollisionCount: 0,
      },
    })
    expect(result.missingAssets).toEqual([])
  })

  test('passes the quality gate for thermal power stations so patches can be applied', async () => {
    const prompt = '\u751f\u6210\u4e00\u4e2a\u706b\u7535\u5382'
    const plan = fallbackFactoryPlan(prompt)
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = await buildFactoryRunResultFromProcessLine({
      prompt,
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      params: { e2eSmoke: true },
      generatePrimitiveGeometryDraft,
    })

    expect(result.missingAssets).toEqual([])
    expect(result.layoutDiagnostics).toMatchObject({
      fits: true,
      boundary: { length: 72, width: 72 },
      diagnostics: [],
    })
    expect(result.layoutStrategy).toMatchObject({
      reason: 'Used factory architecture station position hints.',
    })
    expect(result.qualityReport).toMatchObject({
      passed: true,
      checks: {
        missingAssetCount: 0,
        routeCollisionCount: 0,
      },
    })
    expect(result.patches.length).toBeGreaterThan(0)
    expect(
      failedFactoryRunStatus(result, false, 'Factory process line failed quality checks.'),
    ).toEqual({ failed: false, error: undefined })
  }, 10000)

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

  test('keeps source-pack stations on semantic assemblies before primitive fallback', async () => {
    const plan = fallbackFactoryPlan('generate a cement clinker production line')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')
    expect(plan.process.sourcePack).toMatchObject({
      id: 'industry.cement.basic',
      version: '0.1.0',
      industry: 'cement',
    })

    const requests: PrimitiveGeometryGenerationRequest[] = []
    const result = await buildFactoryRunResultFromProcessLine({
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

    const semanticRoots = result.patches.filter(
      (patch) => patch.op === 'create' && patch.node.metadata?.resolver === 'semantic-assembly',
    )
    expect(requests).toEqual([])
    expect(result.missingAssets).toEqual([])
    expect(semanticRoots.length).toBeGreaterThan(0)
    expect(
      semanticRoots.every(
        (patch) =>
          patch.op === 'create' &&
          patch.node.metadata?.equipmentContract &&
          patch.node.metadata?.equipmentAssembly,
      ),
    ).toBe(true)
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

  test('labels source-pack semantic assembly parts with station display labels before placement', async () => {
    const plan = fallbackFactoryPlan('generate a cement clinker production line')
    if (plan.kind !== 'process_line') throw new Error('expected process line plan')

    const result = await buildFactoryRunResultFromProcessLine({
      prompt: 'generate a cement clinker production line',
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

    const rawMealFeedRoot = result.patches.find(
      (patch) =>
        patch.op === 'create' &&
        patch.node.metadata?.stationId === 'raw_meal_feed' &&
        patch.node.metadata?.resolver === 'semantic-assembly',
    )
    expect(rawMealFeedRoot?.node.name).toBe('\u751f\u6599\u5582\u6599')
    expect(rawMealFeedRoot?.node.metadata).toMatchObject({
      stationDisplayLabel: '\u751f\u6599\u5582\u6599',
      equipmentContract: { profileId: 'cement.bucket_elevator' },
      equipmentAssembly: {
        kind: 'semantic-assembly',
        profileId: 'cement.bucket_elevator',
        editablePartRoles: expect.arrayContaining(['elevator_leg_casing']),
      },
    })
    expect(
      result.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.parentId === rawMealFeedRoot?.node.id &&
          typeof patch.node.name === 'string' &&
          patch.node.name.startsWith('\u751f\u6599\u5582\u6599 '),
      ),
    ).toBe(true)
    expect(result.focusBounds).toMatchObject({ reason: 'factory-key-process' })
  }, 10000)

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
