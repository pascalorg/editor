import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  buildFactoryGeometryPrompt,
  buildFactoryPlacementSpec,
  buildFactoryRunResultFromPlan,
  buildFactoryRunResultFromGeometryDraft,
} from './factory-runner'

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
    expect(result?.patches.some((patch) => patch.node.type === 'wall')).toBe(true)
    expect(result?.patches.some((patch) => patch.node.type === 'door')).toBe(true)
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
})
