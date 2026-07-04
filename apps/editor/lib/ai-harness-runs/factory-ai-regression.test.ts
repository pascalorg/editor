import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import { validateFactoryScenePatches } from '../../../../packages/editor/src/lib/factory-scene-patch-safety'
import { fallbackFactoryPlan } from './factory-planner'
import {
  buildFactoryRunResultFromProcessLine,
  buildFactoryRunResultFromSelectionEdit,
  type FactoryScenePatch,
} from './factory-runner'

const prompt = '\u521b\u5efa\u4e00\u6761\u5316\u5de5\u5382\u6c34\u88c2\u89e3\u8f66\u95f4'

function electrolyzerArtifact(requestPrompt: string): GeneratedGeometryArtifact {
  return {
    id: 'ai_geometry_regression_electrolyzer',
    title: 'Electrolyzer stack array',
    sourceTool: 'compose_assembly',
    sourceArgs: { family: 'electrolyzer_stack' },
    userPrompt: requestPrompt,
    version: 1,
    createdAt: '2026-06-18T00:00:00.000Z',
    shapes: [
      {
        kind: 'box',
        name: 'electrolyzer skid',
        position: [0, 0.35, 0],
        rotation: [0, 0, 0],
        length: 2.4,
        width: 0.9,
        height: 0.35,
      },
      {
        kind: 'rounded-panel',
        name: 'stack panel',
        position: [0, 0.85, 0],
        rotation: [Math.PI / 2, 0, 0],
        length: 2.1,
        width: 0.75,
        thickness: 0.08,
      },
    ],
    transforms: [
      { position: [0, 0.35, 0], rotation: [0, 0, 0] },
      { position: [0, 0.85, 0], rotation: [Math.PI / 2, 0, 0] },
    ],
    assemblyName: 'Electrolyzer stack array',
    assemblyPosition: [0, 0, 0],
    createdNames: ['electrolyzer skid', 'stack panel'],
    shapeDetails: '- electrolyzer skid\n- stack panel',
  }
}

function createPatchNodes(patches: FactoryScenePatch[]) {
  return patches.flatMap((patch) => (patch.op === 'create' ? [patch.node] : []))
}

describe('factory AI regression flow', () => {
  test.skip('creates water electrolysis workshop and edits selected generated equipment', async () => {
    const plan = fallbackFactoryPlan(prompt)
    if (plan.kind !== 'process_line') throw new Error('expected water electrolysis process line')

    const processResult = await buildFactoryRunResultFromProcessLine({
      prompt,
      plan,
      plannerSource: 'fallback',
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      generatePrimitiveGeometryDraft: async (request) => ({
        runId: 'run_regression_electrolyzer',
        conversationId: 'factory:geometry',
        status: 'succeeded',
        artifact: electrolyzerArtifact(request.prompt),
      }),
    })

    expect(processResult.intent.action).toBe('process_line_plan')
    expect(processResult.missingAssets).toEqual([])
    expect(
      processResult.patches.some(
        (patch) =>
          patch.op === 'create' &&
          patch.node.type === 'tank' &&
          patch.node.metadata?.resolver === 'native-tank' &&
          patch.node.metadata?.stationId === 'hydrogen_separator',
      ),
    ).toBe(true)
    expect(
      processResult.patches.some((patch) => patch.op === 'create' && patch.node.type === 'pipe'),
    ).toBe(true)
    expect(
      processResult.patches.some(
        (patch) => patch.op === 'create' && patch.node.type === 'pipe-fitting',
      ),
    ).toBe(true)
    expect(
      processResult.patches.some((patch) => patch.op === 'create' && patch.node.type === 'item'),
    ).toBe(true)

    const createdNodeIds = [
      'level_factory',
      ...createPatchNodes(processResult.patches).map((node) => node.id),
    ]
    expect(
      validateFactoryScenePatches(processResult.patches, {
        allowProcessLineCatalogItems: true,
        existingNodeIds: ['level_factory'],
      }),
    ).toMatchObject({ safe: true })

    const assembly = createPatchNodes(processResult.patches).find(
      (node) => node.type === 'assembly',
    )
    if (!assembly) throw new Error('expected generated equipment assembly')
    const assemblyRecord = assembly as unknown as { id: string; children?: string[]; type: string }
    const assemblyChildIds = processResult.patches.flatMap((patch) =>
      patch.op === 'create' && patch.parentId === assemblyRecord.id ? [patch.node.id] : [],
    )
    const assemblyChildren = createPatchNodes(processResult.patches).filter((node) =>
      assemblyChildIds.includes(node.id),
    )

    const colorEdit = buildFactoryRunResultFromSelectionEdit({
      prompt: '\u628a\u8fd9\u4e2a\u7269\u54c1\u6539\u6210\u7ea2\u8272',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: [assemblyRecord.id],
          nodes: [
            { id: assemblyRecord.id, type: 'assembly', children: assemblyChildIds },
            ...assemblyChildren.map((node) => ({
              id: node.id,
              type: node.type,
              name: node.name,
            })),
          ],
        },
      },
    })

    expect(colorEdit?.intent.action).toBe('edit_selection')
    expect(colorEdit?.patches.length).toBeGreaterThan(0)
    expect(colorEdit?.patches.every((patch) => patch.op === 'update')).toBe(true)
    expect(
      validateFactoryScenePatches(colorEdit?.patches ?? [], {
        existingNodeIds: createdNodeIds,
      }),
    ).toMatchObject({ safe: true })

    const vesselShell = createPatchNodes(processResult.patches).find(
      (node) => node.metadata?.semanticRole === 'vessel_shell',
    )
    if (!vesselShell) throw new Error('expected an editable vessel shell part')

    const shellEdit = buildFactoryRunResultFromSelectionEdit({
      prompt: '\u628a\u8fd9\u4e2a\u50a8\u7f50\u58f3\u4f53\u6539\u6210\u7ea2\u8272',
      placement: { generatedBy: 'factory-agent' },
      context: {
        selection: {
          selectedIds: [vesselShell.id],
          nodes: [
            {
              id: vesselShell.id,
              type: vesselShell.type,
              name: vesselShell.name,
              metadata: vesselShell.metadata,
            },
          ],
        },
      },
    })

    expect(shellEdit?.patches.length).toBeGreaterThan(0)
    expect(shellEdit?.patches.every((patch) => patch.op === 'update')).toBe(true)
    expect(
      validateFactoryScenePatches(shellEdit?.patches ?? [], {
        existingNodeIds: createdNodeIds,
      }),
    ).toMatchObject({ safe: true })
  })
})
