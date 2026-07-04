import type { AiHarnessRun, AiHarnessRunEvent, AiHarnessRunStatus } from './types'

export type AiWorkflowStageStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'blocked'

export type AiWorkflowStageKind =
  | 'intent-router'
  | 'pack-resolver'
  | 'plan-resolver'
  | 'equipment-compiler'
  | 'route-composer'
  | 'quality-report'
  | 'generation'
  | 'result'

export type AiWorkflowStage = {
  id: string
  kind: AiWorkflowStageKind
  label: string
  status: AiWorkflowStageStatus
  summary: string
  details?: string[]
  metrics?: { label: string; value: string }[]
  rerunnable?: boolean
}

export type AiWorkflowEdge = {
  from: string
  to: string
}

export type AiWorkflowGraph = {
  runId: string
  mode: AiHarnessRun['mode']
  status: AiHarnessRunStatus
  title: string
  summary: string
  stages: AiWorkflowStage[]
  edges: AiWorkflowEdge[]
  rerunTargets: { stageId: string; label: string; supported: boolean; reason: string }[]
  templateCandidate?: {
    available: boolean
    label: string
    reason: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function resultOf(run: AiHarnessRun) {
  return recordValue(run.result)
}

function statusFromRun(run: AiHarnessRun): AiWorkflowStageStatus {
  if (run.status === 'succeeded') return 'succeeded'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'cancelled') return 'blocked'
  if (run.status === 'running') return 'running'
  return 'pending'
}

function stageStatus(run: AiHarnessRun, hasOutput: boolean, failed = false): AiWorkflowStageStatus {
  if (failed) return 'failed'
  if (hasOutput) return 'succeeded'
  return statusFromRun(run)
}

function stageEdges(stages: readonly AiWorkflowStage[]) {
  return stages.slice(1).map((stage, index) => ({
    from: stages[index]!.id,
    to: stage.id,
  }))
}

function factoryPlan(run: AiHarnessRun) {
  const result = resultOf(run)
  return recordValue(result?.plan)
}

function factoryProcess(run: AiHarnessRun) {
  return recordValue(factoryPlan(run)?.process)
}

function factoryQuality(run: AiHarnessRun) {
  return recordValue(resultOf(run)?.qualityReport)
}

function factoryPatches(run: AiHarnessRun) {
  return arrayValue(resultOf(run)?.patches).filter(isRecord)
}

function missingAssets(run: AiHarnessRun) {
  return arrayValue(resultOf(run)?.missingAssets).filter(isRecord)
}

function countCreatedPatches(
  run: AiHarnessRun,
  predicate: (node: Record<string, unknown>) => boolean,
) {
  return factoryPatches(run).filter((patch) => {
    if (patch.op !== 'create') return false
    const node = recordValue(patch.node)
    return Boolean(node && predicate(node))
  }).length
}

function countSemanticEquipment(run: AiHarnessRun) {
  return countCreatedPatches(run, (node) => {
    const metadata = recordValue(node.metadata)
    return Boolean(
      metadata?.equipmentAssembly ||
        metadata?.factoryEquipmentContract ||
        metadata?.equipmentContract ||
        metadata?.semanticType === 'equipment',
    )
  })
}

function countPipes(run: AiHarnessRun) {
  return countCreatedPatches(run, (node) => {
    const type = stringValue(node.type)
    return type === 'pipe' || type === 'pipe-fitting' || type === 'cable-tray'
  })
}

function latestEvent(events: readonly AiHarnessRunEvent[], type: AiHarnessRunEvent['type']) {
  return events.filter((event) => event.type === type).at(-1)
}

function buildFactoryWorkflowGraph(
  run: AiHarnessRun,
  events: readonly AiHarnessRunEvent[],
): AiWorkflowGraph {
  const result = resultOf(run)
  const plan = factoryPlan(run)
  const process = factoryProcess(run)
  const quality = factoryQuality(run)
  const stations = arrayValue(process?.stations)
  const connections = arrayValue(process?.connections)
  const semanticEquipmentCount = countSemanticEquipment(run)
  const pipeCount = countPipes(run)
  const missing = missingAssets(run)
  const qualityPassed = quality?.passed === true
  const qualityFailed = quality?.passed === false
  const requiredPack = run.intentRoute?.requiredPack
  const resultEvent = latestEvent(events, 'result')

  const stages: AiWorkflowStage[] = [
    {
      id: 'intent-router',
      kind: 'intent-router',
      label: 'Intent router',
      status: run.intentRoute ? 'succeeded' : stageStatus(run, Boolean(result)),
      summary: run.intentRoute
        ? `${run.intentRoute.kind} (${Math.round(run.intentRoute.confidence * 100)}%)`
        : `Factory run: ${run.status}`,
      details: [run.intentRoute?.reason].filter((value): value is string => Boolean(value)),
    },
    {
      id: 'pack-resolver',
      kind: 'pack-resolver',
      label: 'Industry pack resolver',
      status: requiredPack
        ? requiredPack.installed
          ? 'succeeded'
          : 'blocked'
        : result
          ? 'skipped'
          : statusFromRun(run),
      summary: requiredPack
        ? `${requiredPack.id}${requiredPack.version ? `@${requiredPack.version}` : ''} ${
            requiredPack.installed ? 'installed' : 'missing'
          }`
        : 'No required industry pack recorded',
      details: [requiredPack?.reason].filter((value): value is string => Boolean(value)),
    },
    {
      id: 'plan-resolver',
      kind: 'plan-resolver',
      label: 'Template and process resolver',
      status: stageStatus(run, Boolean(plan)),
      summary:
        stringValue(process?.processLabel) ??
        stringValue(plan?.kind) ??
        stringValue(result?.intent && recordValue(result.intent)?.action) ??
        'Waiting for plan',
      metrics: [
        { label: 'stations', value: String(stations.length) },
        { label: 'connections', value: String(connections.length) },
      ],
      rerunnable: Boolean(plan),
    },
    {
      id: 'equipment-compiler',
      kind: 'equipment-compiler',
      label: 'Equipment compiler',
      status: stageStatus(run, semanticEquipmentCount > 0 || missing.length > 0),
      summary:
        semanticEquipmentCount > 0
          ? `${semanticEquipmentCount} semantic equipment assemblies`
          : missing.length > 0
            ? `${missing.length} station fallback warning${missing.length === 1 ? '' : 's'}`
            : 'Waiting for equipment compilation',
      metrics: [
        { label: 'semantic equipment', value: String(semanticEquipmentCount) },
        { label: 'missing/fallback', value: String(missing.length) },
      ],
      details: missing
        .slice(0, 5)
        .map(
          (asset) => `${stringValue(asset.name) ?? 'asset'}: ${stringValue(asset.reason) ?? ''}`,
        ),
      rerunnable: semanticEquipmentCount > 0 || missing.length > 0,
    },
    {
      id: 'route-composer',
      kind: 'route-composer',
      label: 'Route composer',
      status: stageStatus(run, pipeCount > 0 || connections.length > 0),
      summary:
        pipeCount > 0
          ? `${pipeCount} route primitives`
          : connections.length > 0
            ? `${connections.length} planned connections`
            : 'Waiting for routes',
      metrics: [
        { label: 'route nodes', value: String(pipeCount) },
        { label: 'planned links', value: String(connections.length) },
      ],
      rerunnable: connections.length > 0,
    },
    {
      id: 'quality-report',
      kind: 'quality-report',
      label: 'Quality report',
      status: qualityFailed ? 'failed' : stageStatus(run, Boolean(quality), false),
      summary:
        stringValue(quality?.summary) ??
        (resultEvent ? 'Result emitted; quality report unavailable' : 'Waiting for quality report'),
      metrics: [
        { label: 'passed', value: qualityPassed ? 'yes' : qualityFailed ? 'no' : 'unknown' },
        {
          label: 'issues',
          value: String(arrayValue(quality?.issues).length),
        },
      ],
    },
  ]

  return {
    runId: run.id,
    mode: run.mode,
    status: run.status,
    title: stringValue(process?.processLabel) ?? 'Factory workflow',
    summary:
      stringValue(quality?.summary) ??
      (run.error ? `Failed: ${run.error}` : `${run.status} factory generation workflow`),
    stages,
    edges: stageEdges(stages),
    rerunTargets: [
      {
        stageId: 'plan-resolver',
        label: 'Re-run process plan',
        supported: false,
        reason: 'Phase 6 first slice exposes the graph before enabling partial re-run.',
      },
      {
        stageId: 'equipment-compiler',
        label: 'Re-run selected station equipment',
        supported: false,
        reason: 'Requires station-scoped run request support.',
      },
    ],
    templateCandidate: {
      available: Boolean(plan),
      label: stringValue(process?.processLabel) ?? 'Generation workflow',
      reason: plan
        ? 'A process plan is present and can be promoted to a template in a later Phase 6 slice.'
        : 'No generation plan is available yet.',
    },
  }
}

function buildGenericWorkflowGraph(
  run: AiHarnessRun,
  events: readonly AiHarnessRunEvent[],
): AiWorkflowGraph {
  const result = resultOf(run)
  const progressCount = events.filter((event) => event.type === 'progress').length
  const stages: AiWorkflowStage[] = [
    {
      id: 'intent-router',
      kind: 'intent-router',
      label: 'Intent router',
      status: run.intentRoute ? 'succeeded' : statusFromRun(run),
      summary: run.intentRoute
        ? `${run.intentRoute.kind} (${Math.round(run.intentRoute.confidence * 100)}%)`
        : `${run.mode} run`,
      details: [run.intentRoute?.reason].filter((value): value is string => Boolean(value)),
    },
    {
      id: 'generation',
      kind: 'generation',
      label: 'Generation',
      status: stageStatus(run, progressCount > 0 || Boolean(result)),
      summary: progressCount > 0 ? `${progressCount} progress events` : `Status: ${run.status}`,
    },
    {
      id: 'result',
      kind: 'result',
      label: 'Result',
      status: stageStatus(run, Boolean(result), run.status === 'failed'),
      summary: result ? 'Result is available' : (run.error ?? 'Waiting for result'),
    },
  ]

  return {
    runId: run.id,
    mode: run.mode,
    status: run.status,
    title: `${run.mode} workflow`,
    summary: run.error ?? `${run.status} ${run.mode} workflow`,
    stages,
    edges: stageEdges(stages),
    rerunTargets: [],
    templateCandidate: {
      available: false,
      label: `${run.mode} workflow`,
      reason: 'Only factory process workflows can be saved as templates in Phase 6.',
    },
  }
}

export function buildAiWorkflowGraph(input: {
  run: AiHarnessRun
  events?: readonly AiHarnessRunEvent[]
}): AiWorkflowGraph {
  return input.run.mode === 'factory'
    ? buildFactoryWorkflowGraph(input.run, input.events ?? [])
    : buildGenericWorkflowGraph(input.run, input.events ?? [])
}

export function summarizeAiWorkflowGraph(graph: AiWorkflowGraph) {
  const failed = graph.stages.filter((stage) => stage.status === 'failed').length
  const blocked = graph.stages.filter((stage) => stage.status === 'blocked').length
  const succeeded = graph.stages.filter((stage) => stage.status === 'succeeded').length
  return {
    runId: graph.runId,
    mode: graph.mode,
    status: graph.status,
    title: graph.title,
    summary: graph.summary,
    stageCount: graph.stages.length,
    succeededStageCount: succeeded,
    failedStageCount: failed,
    blockedStageCount: blocked,
    templateAvailable: graph.templateCandidate?.available === true,
  }
}
