import type { GeneratedGeometryPlacementSpec } from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import type { FactoryPlan } from './factory-planner'
import { evaluateFactoryQuality } from './factory-quality-report'
import type { FactoryRunResult } from './factory-runner'
import { composeProcessLine } from './process-line-composer'
import type { ProcessLinePlan, ProcessStationPlan } from './process-line-types'
import type { AiHarnessRun } from './types'

export type WorkflowRerunSpec = {
  sourceRunId: string
  stageId: string
  stationId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseWorkflowRerunSpec(params: unknown): WorkflowRerunSpec | null {
  const rerun = isRecord(params) ? params.workflowRerun : undefined
  if (!isRecord(rerun)) return null
  const sourceRunId = stringValue(rerun.sourceRunId)
  const stageId = stringValue(rerun.stageId)
  const stationId = stringValue(rerun.stationId)
  if (!(sourceRunId && stageId && stationId)) return null
  return { sourceRunId, stageId, stationId }
}

function factoryPlanFromRun(run: AiHarnessRun): FactoryPlan | null {
  const result = isRecord(run.result) ? run.result : null
  const plan = isRecord(result?.plan) ? result.plan : null
  if (!plan) return null
  return plan as unknown as FactoryPlan
}

function processLinePlanFromSource(
  run: AiHarnessRun,
): Extract<FactoryPlan, { kind: 'process_line' }> {
  const plan = factoryPlanFromRun(run)
  if (!plan || plan.kind !== 'process_line') {
    throw new Error(`Source run ${run.id} does not contain a process-line plan.`)
  }
  return plan
}

function stationFromPlan(plan: ProcessLinePlan, stationId: string): ProcessStationPlan {
  const station = plan.stations.find((item) => item.id === stationId)
  if (!station) throw new Error(`Station not found in source workflow: ${stationId}`)
  return station
}

function stationScopedProcessPlan(
  plan: ProcessLinePlan,
  station: ProcessStationPlan,
): ProcessLinePlan {
  return {
    ...plan,
    processId: `${plan.processId}:${station.id}:rerun`,
    processLabel: `${plan.processLabel} / ${station.label}`,
    stations: [station],
    connections: [],
  }
}

export function buildStationWorkflowRerunResult(input: {
  run: AiHarnessRun
  sourceRun: AiHarnessRun
  spec: WorkflowRerunSpec
  placement: GeneratedGeometryPlacementSpec
}): FactoryRunResult {
  if (input.spec.stageId !== 'equipment-compiler') {
    throw new Error(`Unsupported workflow rerun stage: ${input.spec.stageId}`)
  }

  const sourcePlan = processLinePlanFromSource(input.sourceRun)
  const station = stationFromPlan(sourcePlan.process, input.spec.stationId)
  const process = stationScopedProcessPlan(sourcePlan.process, station)
  const plan: Extract<FactoryPlan, { kind: 'process_line' }> = {
    ...sourcePlan,
    reason: `Re-run equipment compiler for station ${station.id}.`,
    process,
  }
  const composed = composeProcessLine({
    prompt: input.run.prompt,
    plan: process,
    placement: input.placement,
    params: input.run.params,
    sections: { shell: false, stations: true, connections: false },
  })
  const result: FactoryRunResult = {
    intent: { action: 'process_line_plan', prompt: input.run.prompt },
    applied: false,
    plan,
    plannerSource: 'fallback',
    patches: composed.patches,
    nodeIds: composed.nodeIds,
    created: composed.created,
    missingAssets: composed.missingAssets,
    focusBounds: composed.focusBounds,
    layoutDiagnostics: composed.layoutDiagnostics,
    layoutStrategy: composed.layoutStrategy,
    placement: input.placement,
    workflowRerun: {
      sourceRunId: input.spec.sourceRunId,
      stageId: input.spec.stageId,
      stationId: input.spec.stationId,
    },
    editSummary: [
      `Re-ran equipment compiler for ${station.label} (${station.id}) from ${input.sourceRun.id}.`,
    ],
  }
  return { ...result, qualityReport: evaluateFactoryQuality(result) }
}
