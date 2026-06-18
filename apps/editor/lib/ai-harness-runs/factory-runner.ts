import { findCatalogItem } from '@pascal-app/core/lib/asset-catalog'
import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'
import { ItemNode } from '@pascal-app/core/schema'
import {
  buildGeneratedGeometryCreatePatches,
  type GeneratedGeometryCreatePatch,
  type GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import { buildFactoryGeometryRequestPrompt } from './factory-agent-prompt'
import { composeFactoryLayout } from './factory-layout-composer'
import { type FactoryPlan, planFactoryRequest } from './factory-planner'
import type { PrimitiveGeometryGenerationResult } from './primitive-generation-service'
import { appendRunEvent, isTerminalStatus, loadRun, updateRun } from './run-store'

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

export type FactoryMissingAsset = {
  name: string
  reason: string
  required: boolean
}

export type FactoryRunResult = {
  intent: {
    action: 'layout_plan' | 'place_catalog_item' | 'generate_equipment_draft' | 'missing'
    prompt: string
  }
  applied: false
  plan?: FactoryPlan
  plannerSource?: 'llm' | 'fallback'
  artifact?: PrimitiveGeometryGenerationResult['artifact']
  patches: GeneratedGeometryCreatePatch[]
  nodeIds: string[]
  created: string[]
  missingAssets: FactoryMissingAsset[]
  geometryRunId?: string
  geometryStatus?: PrimitiveGeometryGenerationResult['status']
  placement: GeneratedGeometryPlacementSpec
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function vec3Value(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  const nums = value.map((item) => (typeof item === 'number' ? item : Number.NaN))
  return nums.every(Number.isFinite) ? (nums as Vec3) : undefined
}

function recordFromRunContext(context: unknown) {
  return isRecord(context) ? context : {}
}

export function buildFactoryGeometryPrompt(prompt: string, params?: Record<string, unknown>) {
  const equipmentName = stringValue(params?.equipmentName)
  const lineRole = stringValue(params?.lineRole)
  const desiredDimensions = isRecord(params?.desiredDimensions)
    ? params.desiredDimensions
    : undefined
  return buildFactoryGeometryRequestPrompt({
    userRequest: prompt,
    equipmentName,
    lineRole,
    desiredDimensions,
  })
}

export function buildFactoryPlacementSpec(input: {
  context?: unknown
  params?: Record<string, unknown>
}): GeneratedGeometryPlacementSpec {
  const context = recordFromRunContext(input.context)
  const params = input.params ?? {}
  const parentId = stringValue(params.parentId) ?? stringValue(context.parentId)
  const lineId = stringValue(params.lineId) ?? stringValue(context.lineId)
  const lineRole = stringValue(params.lineRole) ?? stringValue(context.lineRole)
  const equipmentRole = stringValue(params.equipmentRole) ?? stringValue(context.equipmentRole)
  return {
    ...(parentId ? { parentId } : {}),
    position: vec3Value(params.position) ?? vec3Value(context.position),
    rotation: vec3Value(params.rotation) ?? vec3Value(context.rotation),
    generatedBy: 'factory-agent',
    metadata: {
      ...(lineId ? { lineId } : {}),
      ...(lineRole ? { lineRole } : {}),
      ...(equipmentRole ? { equipmentRole } : {}),
    },
  }
}

export function buildFactoryRunResultFromGeometryDraft(input: {
  prompt: string
  geometry: PrimitiveGeometryGenerationResult
  placement: GeneratedGeometryPlacementSpec
  plan?: FactoryPlan
  plannerSource?: 'llm' | 'fallback'
}): FactoryRunResult {
  const artifact = input.geometry.artifact
  if (!artifact) {
    return {
      intent: { action: 'generate_equipment_draft', prompt: input.prompt },
      applied: false,
      plan: input.plan,
      plannerSource: input.plannerSource,
      patches: [],
      nodeIds: [],
      created: [],
      missingAssets: [
        {
          name: input.prompt,
          reason: input.geometry.error ?? 'geometry generation did not produce an artifact',
          required: true,
        },
      ],
      geometryRunId: input.geometry.runId,
      geometryStatus: input.geometry.status,
      placement: input.placement,
    }
  }

  const patchPlan = buildGeneratedGeometryCreatePatches(artifact, input.placement)
  return {
    intent: { action: 'generate_equipment_draft', prompt: input.prompt },
    applied: false,
    plan: input.plan,
    plannerSource: input.plannerSource,
    artifact,
    patches: patchPlan.patches,
    nodeIds: patchPlan.nodeIds,
    created: patchPlan.created,
    missingAssets: [],
    geometryRunId: input.geometry.runId,
    geometryStatus: input.geometry.status,
    placement: input.placement,
  }
}

export function buildFactoryRunResultFromPlan(input: {
  prompt: string
  plan: FactoryPlan
  plannerSource?: 'llm' | 'fallback'
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): FactoryRunResult | null {
  const { prompt, plan, plannerSource, placement } = input
  if (plan.kind === 'layout') {
    const layoutPatchPlan = composeFactoryLayout({
      prompt,
      plan,
      placement,
      params: input.params,
    })
    return {
      intent: { action: 'layout_plan', prompt },
      applied: false,
      plan,
      plannerSource,
      patches: layoutPatchPlan.patches,
      nodeIds: layoutPatchPlan.nodeIds,
      created: layoutPatchPlan.created,
      missingAssets: layoutPatchPlan.missingAssets,
      placement,
    }
  }

  if (plan.kind === 'catalog_item') {
    const asset = findCatalogItem(plan.catalogItemId)
    if (!asset) {
      return {
        intent: { action: 'missing', prompt },
        applied: false,
        plan,
        plannerSource,
        patches: [],
        nodeIds: [],
        created: [],
        missingAssets: [
          {
            name: plan.catalogItemId,
            reason: 'Planner selected a catalog item id that is no longer available.',
            required: true,
          },
        ],
        placement,
      }
    }
    const node = ItemNode.parse({
      name: asset.name,
      position: placement.position ?? [0, 0, 0],
      rotation: placement.rotation ?? [0, 0, 0],
      asset,
      metadata: {
        generatedBy: placement.generatedBy ?? 'factory-agent',
        catalogItemId: asset.id,
        ...placement.metadata,
      },
    })
    const parentId = placement.parentId == null ? undefined : (placement.parentId as never)
    const patches: GeneratedGeometryCreatePatch[] = [
      { op: 'create', node, ...(parentId ? { parentId } : {}) },
    ]
    return {
      intent: { action: 'place_catalog_item', prompt },
      applied: false,
      plan,
      plannerSource,
      patches,
      nodeIds: [node.id],
      created: [asset.name],
      missingAssets: [],
      placement,
    }
  }

  if (plan.kind === 'missing') {
    return {
      intent: { action: 'missing', prompt },
      applied: false,
      plan,
      plannerSource,
      patches: [],
      nodeIds: [],
      created: [],
      missingAssets: [{ name: plan.missingName, reason: plan.reason, required: true }],
      placement,
    }
  }

  return null
}

async function markRunCancelled(runId: string, message = 'cancelled') {
  const run = await loadRun(runId)
  if (!run || isTerminalStatus(run.status)) return
  await updateRun(runId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    error: message,
  })
  await appendRunEvent(runId, {
    type: 'status',
    message,
    data: { status: 'cancelled' },
  })
}

async function shouldStopRun(runId: string, signal: AbortSignal) {
  if (signal.aborted) return true
  const run = await loadRun(runId)
  return !run || run.status === 'cancelled'
}

export function ensureFactoryRunRunning(runId: string) {
  if (runningRuns.has(runId)) return
  runningRuns.add(runId)
  void runFactoryRun(runId).finally(() => {
    runningRuns.delete(runId)
  })
}

export async function cancelFactoryRun(runId: string) {
  activeControllers.get(runId)?.abort()
  await markRunCancelled(runId, 'Factory generation cancelled')
}

async function runFactoryRun(runId: string) {
  const run = await loadRun(runId)
  if (!run || run.mode !== 'factory' || isTerminalStatus(run.status)) return
  const controller = new AbortController()
  activeControllers.set(runId, controller)

  const startedRun = await updateRun(runId, {
    status: 'running',
    startedAt: run.startedAt ?? new Date().toISOString(),
  })
  if (isTerminalStatus(startedRun.status)) {
    activeControllers.delete(runId)
    return
  }
  await appendRunEvent(runId, { type: 'status', message: 'running', data: { status: 'running' } })

  try {
    const placement = buildFactoryPlacementSpec({ context: run.context, params: run.params })
    const planned = await planFactoryRequest({ prompt: run.prompt, signal: controller.signal })

    await appendRunEvent(runId, {
      type: 'progress',
      message: `Factory planner selected ${planned.plan.kind}.`,
      data: {
        stage: 'factory-plan',
        plan: planned.plan,
        plannerSource: planned.source,
        placement,
      },
    })

    if (await shouldStopRun(runId, controller.signal)) return
    const planResult = buildFactoryRunResultFromPlan({
      prompt: run.prompt,
      plan: planned.plan,
      plannerSource: planned.source,
      placement,
      params: run.params,
    })
    if (planResult) {
      await appendRunEvent(runId, {
        type: 'message',
        message:
          planned.plan.kind === 'layout'
            ? 'Factory layout plan selected; patches are not applied yet.'
            : planned.plan.kind === 'catalog_item'
              ? 'Catalog item patch plan generated; patches are ready but not applied.'
              : 'Factory request could not be resolved.',
        data: {
          stage: 'patch-plan',
          plan: planned.plan,
          patchCount: planResult.patches.length,
          nodeIds: planResult.nodeIds,
          missingAssets: planResult.missingAssets,
        },
      })
      await appendRunEvent(runId, { type: 'result', data: planResult })
      await updateRun(runId, {
        status: planned.plan.kind === 'missing' ? 'failed' : 'succeeded',
        completedAt: new Date().toISOString(),
        ...(planned.plan.kind === 'missing'
          ? { error: planResult.missingAssets[0]?.reason ?? 'missing asset' }
          : {}),
        result: planResult,
      })
      await appendRunEvent(runId, {
        type: 'status',
        message: planned.plan.kind === 'missing' ? 'failed' : 'succeeded',
        data: { status: planned.plan.kind === 'missing' ? 'failed' : 'succeeded' },
      })
      return
    }

    if (planned.plan.kind !== 'geometry') {
      throw new Error(`Factory planner route "${planned.plan.kind}" was not handled`)
    }
    const geometryPlan = planned.plan
    const geometryPrompt = buildFactoryGeometryPrompt(geometryPlan.equipmentName, {
      ...run.params,
      equipmentName: geometryPlan.equipmentName,
      lineRole: geometryPlan.lineRole,
      desiredDimensions: geometryPlan.desiredDimensions,
    })
    const { generatePrimitiveGeometryDraft } = await import('./primitive-generation-service')
    const geometry = await generatePrimitiveGeometryDraft({
      prompt: geometryPrompt,
      conversationId: `${run.conversationId}:factory-geometry`,
      context: recordFromRunContext(run.context),
      params: { sourceFactoryRunId: run.id },
      source: 'factory-agent',
      placementIntent: {
        lineRole: stringValue(run.params?.lineRole) ?? stringValue(recordFromRunContext(run.context).lineRole),
      },
    })

    if (await shouldStopRun(runId, controller.signal)) return
    const result = buildFactoryRunResultFromGeometryDraft({
      prompt: run.prompt,
      geometry,
      placement,
      plan: geometryPlan,
      plannerSource: planned.source,
    })

    await appendRunEvent(runId, {
      type: 'message',
      message: result.artifact
        ? 'Factory equipment draft generated; patches are ready but not applied.'
        : 'Factory equipment draft missing; geometry generation produced no artifact.',
      data: {
        stage: 'patch-plan',
        geometryRunId: result.geometryRunId,
        patchCount: result.patches.length,
        nodeIds: result.nodeIds,
        missingAssets: result.missingAssets,
      },
    })
    await appendRunEvent(runId, { type: 'result', data: result })
    await updateRun(runId, {
      status: result.artifact ? 'succeeded' : 'failed',
      completedAt: new Date().toISOString(),
      ...(result.artifact ? {} : { error: result.missingAssets[0]?.reason ?? 'missing asset' }),
      result,
    })
    await appendRunEvent(runId, {
      type: 'status',
      message: result.artifact ? 'succeeded' : 'failed',
      data: { status: result.artifact ? 'succeeded' : 'failed' },
    })
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await markRunCancelled(runId, 'Factory generation cancelled')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    await appendRunEvent(runId, { type: 'error', message })
    await updateRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    })
    await appendRunEvent(runId, { type: 'status', message: 'failed', data: { status: 'failed' } })
  } finally {
    activeControllers.delete(runId)
  }
}
