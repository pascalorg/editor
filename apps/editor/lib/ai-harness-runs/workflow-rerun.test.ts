import { beforeAll, describe, expect, test } from 'bun:test'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import type { AiHarnessRun } from './types'
import { buildStationWorkflowRerunResult, parseWorkflowRerunSpec } from './workflow-rerun'

async function ensureFactoryEquipmentPluginLoaded() {
  if (nodeRegistry.has('factory:pump') && nodeRegistry.has('factory:tank')) return
  await loadPlugin(factoryEquipmentPlugin)
}

function run(patch: Partial<AiHarnessRun>): AiHarnessRun {
  return {
    id: 'run_source',
    conversationId: 'conversation_source',
    mode: 'factory',
    status: 'succeeded',
    prompt: 'create a pump transfer line',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:01.000Z',
    ...patch,
  }
}

const sourceRun = run({
  result: {
    intent: { action: 'process_line_plan', prompt: 'create a pump transfer line' },
    applied: false,
    plan: {
      kind: 'process_line',
      reason: 'pump transfer',
      process: {
        processId: 'pump_transfer',
        processLabel: 'Pump transfer',
        domain: 'chemical',
        layoutStyle: 'linear',
        dimensions: { length: 12, width: 5 },
        stations: [
          {
            id: 'feed_pump',
            label: 'Feed pump',
            role: 'pump',
            equipmentHint: 'centrifugal pump',
          },
          {
            id: 'booster_pump',
            label: 'Booster pump',
            role: 'pump',
            equipmentHint: 'centrifugal pump',
          },
        ],
        connections: [
          {
            fromStationId: 'feed_pump',
            toStationId: 'booster_pump',
            medium: 'water',
            visualKind: 'pipe',
            fromPortId: 'outlet',
            toPortId: 'inlet',
          },
        ],
      },
    },
    patches: [],
    nodeIds: [],
    created: [],
    missingAssets: [],
    placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
  },
})

describe('workflow rerun', () => {
  beforeAll(async () => {
    await ensureFactoryEquipmentPluginLoaded()
  })

  test('parses station rerun params', () => {
    expect(
      parseWorkflowRerunSpec({
        workflowRerun: {
          sourceRunId: 'run_source',
          stageId: 'equipment-compiler',
          stationId: 'feed_pump',
        },
      }),
    ).toEqual({
      sourceRunId: 'run_source',
      stageId: 'equipment-compiler',
      stationId: 'feed_pump',
    })
  })

  test('rebuilds only the selected station equipment from the source process plan', () => {
    const rerun = run({
      id: 'run_rerun',
      status: 'running',
      prompt: 'Re-run equipment-compiler for station feed_pump',
      params: {
        workflowRerun: {
          sourceRunId: 'run_source',
          stageId: 'equipment-compiler',
          stationId: 'feed_pump',
        },
      },
    })
    const result = buildStationWorkflowRerunResult({
      run: rerun,
      sourceRun,
      spec: {
        sourceRunId: 'run_source',
        stageId: 'equipment-compiler',
        stationId: 'feed_pump',
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.plan?.kind).toBe('process_line')
    if (result.plan?.kind !== 'process_line') throw new Error('expected process line rerun')
    expect(result.plan.process.stations.map((station) => station.id)).toEqual(['feed_pump'])
    expect(result.plan.process.connections).toEqual([])
    expect(result.patches.length).toBeGreaterThan(0)
    expect(result.patches.every((patch) => patch.node.metadata?.stationId === 'feed_pump')).toBe(
      true,
    )
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'assembly' &&
          patch.node.metadata?.equipmentAssembly &&
          patch.node.metadata?.stationId === 'feed_pump',
      ),
    ).toBe(true)
    expect(result.qualityReport?.checks.expectedStationCount).toBe(1)
  })
})
