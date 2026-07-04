import { describe, expect, test } from 'bun:test'
import type { AiHarnessRun } from './types'
import { buildAiWorkflowGraph, summarizeAiWorkflowGraph } from './workflow-summary'

function baseRun(patch: Partial<AiHarnessRun>): AiHarnessRun {
  return {
    id: 'run_workflow_test',
    conversationId: 'conversation_workflow_test',
    mode: 'factory',
    status: 'succeeded',
    prompt: 'generate a refinery',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:01.000Z',
    ...patch,
  }
}

describe('AI workflow graph summary', () => {
  test('builds inspectable factory workflow stages from a completed process result', () => {
    const run = baseRun({
      intentRoute: {
        kind: 'create-factory',
        confidence: 0.91,
        reason: 'Prompt references a refinery.',
        requiredPack: {
          id: 'industry.refinery.basic',
          version: '0.2.0',
          installed: true,
        },
      },
      result: {
        intent: { action: 'process_line_plan', prompt: 'generate a refinery' },
        applied: false,
        plan: {
          kind: 'process_line',
          process: {
            processId: 'refinery_basic',
            processLabel: 'Refinery',
            stations: [
              { id: 'distillation', label: 'Atmospheric tower' },
              { id: 'tank_farm', label: 'Tank farm' },
            ],
            connections: [{ fromStationId: 'distillation', toStationId: 'tank_farm' }],
          },
        },
        patches: [
          {
            op: 'create',
            node: {
              id: 'assembly_tank_farm',
              type: 'assembly',
              metadata: { equipmentAssembly: { kind: 'semantic-assembly' } },
            },
          },
          { op: 'create', node: { id: 'pipe_transfer', type: 'pipe', metadata: {} } },
        ],
        missingAssets: [],
        qualityReport: {
          passed: true,
          summary: 'Factory quality checks passed.',
          issues: [],
        },
      },
    })

    const graph = buildAiWorkflowGraph({
      run,
      events: [
        { id: 1, runId: run.id, type: 'result', data: run.result, createdAt: run.updatedAt },
      ],
    })

    expect(graph.title).toBe('Refinery')
    expect(graph.stages.map((stage) => stage.id)).toEqual([
      'intent-router',
      'pack-resolver',
      'plan-resolver',
      'equipment-compiler',
      'route-composer',
      'quality-report',
    ])
    expect(graph.stages.find((stage) => stage.id === 'pack-resolver')).toMatchObject({
      status: 'succeeded',
      summary: 'industry.refinery.basic@0.2.0 installed',
    })
    expect(graph.stages.find((stage) => stage.id === 'equipment-compiler')).toMatchObject({
      status: 'succeeded',
      metrics: [
        { label: 'semantic equipment', value: '1' },
        { label: 'missing/fallback', value: '0' },
      ],
    })
    expect(graph.stages.find((stage) => stage.id === 'route-composer')).toMatchObject({
      status: 'succeeded',
      metrics: [
        { label: 'route nodes', value: '1' },
        { label: 'planned links', value: '1' },
      ],
    })
    expect(graph.edges).toContainEqual({ from: 'route-composer', to: 'quality-report' })
    expect(graph.templateCandidate).toMatchObject({ available: true, label: 'Refinery' })
    expect(graph.rerunTargets).toContainEqual({
      stageId: 'equipment-compiler',
      label: 'Re-run Atmospheric tower equipment',
      supported: true,
      reason: 'Creates a station-scoped factory run from the saved process plan.',
      stationId: 'distillation',
    })
  })

  test('marks the industry pack resolver blocked when the required pack is not installed', () => {
    const run = baseRun({
      status: 'failed',
      error: 'Missing required industry pack',
      intentRoute: {
        kind: 'create-factory',
        confidence: 0.88,
        reason: 'Prompt references a refinery.',
        requiredPack: {
          id: 'industry.refinery.basic',
          installed: false,
          reason: 'Not installed locally.',
        },
      },
    })

    const graph = buildAiWorkflowGraph({ run })

    expect(graph.stages.find((stage) => stage.id === 'pack-resolver')).toMatchObject({
      status: 'blocked',
      summary: 'industry.refinery.basic missing',
      details: ['Not installed locally.'],
    })
  })

  test('summarizes non-factory runs with a compact generic workflow', () => {
    const run = baseRun({
      mode: 'primitive',
      status: 'running',
      prompt: 'generate a pump',
      result: undefined,
    })

    const graph = buildAiWorkflowGraph({
      run,
      events: [
        {
          id: 1,
          runId: run.id,
          type: 'progress',
          message: 'drafting',
          createdAt: run.updatedAt,
        },
      ],
    })
    const summary = summarizeAiWorkflowGraph(graph)

    expect(graph.stages.map((stage) => stage.id)).toEqual(['intent-router', 'generation', 'result'])
    expect(graph.stages.find((stage) => stage.id === 'generation')).toMatchObject({
      status: 'succeeded',
      summary: '1 progress events',
    })
    expect(summary).toMatchObject({
      mode: 'primitive',
      stageCount: 3,
      templateAvailable: false,
    })
  })

  test('labels station-scoped workflow reruns', () => {
    const run = baseRun({
      params: {
        workflowRerun: {
          sourceRunId: 'run_source',
          stageId: 'equipment-compiler',
          stationId: 'feed_pump',
        },
      },
      result: {
        plan: {
          kind: 'process_line',
          process: {
            processLabel: 'Pump transfer / Feed pump',
            stations: [{ id: 'feed_pump' }],
            connections: [],
          },
        },
        patches: [],
        missingAssets: [],
      },
    })

    expect(buildAiWorkflowGraph({ run }).title).toBe('Station rerun: feed_pump')
  })
})
