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
import { evaluateFactoryQuality, type FactoryQualityReport } from './factory-quality-report'
import { composeSelectionEdit, type FactorySceneEditPatch } from './factory-selection-edit'
import type { PrimitiveGeometryGenerationResult } from './primitive-generation-service'
import { composeProcessLine } from './process-line-composer'
import { stationDisplayLabel } from './process-line-localization'
import type {
  ProcessLayoutDiagnostics,
  ProcessLayoutStrategy,
  ProcessLineFocusBounds,
} from './process-line-types'
import { appendRunEvent, isTerminalStatus, loadRun, updateRun } from './run-store'

const runningRuns = new Set<string>()
const activeControllers = new Map<string, AbortController>()

export type FactoryMissingAsset = {
  name: string
  reason: string
  required: boolean
}

export type FactoryScenePatch = GeneratedGeometryCreatePatch | FactorySceneEditPatch

export type FactoryRunResult = {
  intent: {
    action:
      | 'layout_plan'
      | 'process_line_plan'
      | 'edit_selection'
      | 'place_catalog_item'
      | 'generate_equipment_draft'
      | 'missing'
    prompt: string
  }
  applied: false
  plan?: FactoryPlan
  plannerSource?: 'llm' | 'fallback'
  artifact?: PrimitiveGeometryGenerationResult['artifact']
  patches: FactoryScenePatch[]
  nodeIds: string[]
  created: string[]
  missingAssets: FactoryMissingAsset[]
  qualityReport?: FactoryQualityReport
  focusBounds?: ProcessLineFocusBounds
  layoutDiagnostics?: ProcessLayoutDiagnostics
  layoutStrategy?: ProcessLayoutStrategy
  geometryRunId?: string
  geometryStatus?: PrimitiveGeometryGenerationResult['status']
  placement: GeneratedGeometryPlacementSpec
  editSummary?: string[]
}

function withFactoryQuality(result: FactoryRunResult): FactoryRunResult {
  return { ...result, qualityReport: evaluateFactoryQuality(result) }
}

export function failedFactoryRunStatus(
  result: FactoryRunResult,
  fallbackFailed: boolean,
  fallbackError: string,
) {
  if (result.qualityReport?.passed === false) {
    return {
      failed: true,
      error:
        result.qualityReport.issues.find((issue) => issue.severity === 'error')?.message ??
        result.qualityReport.summary,
    }
  }
  if (fallbackFailed) {
    return { failed: true, error: fallbackError }
  }
  return { failed: false, error: undefined }
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

function finiteVec2(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]]
  }
  return undefined
}

function sceneBoundsFromContext(context: Record<string, unknown>) {
  const scene = isRecord(context.scene) ? context.scene : undefined
  const candidates = [context.sceneBounds, scene?.bounds]
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const min = finiteVec2(candidate.min)
    const max = finiteVec2(candidate.max)
    if (!min || !max) continue
    return {
      min,
      max,
      ...(finiteVec2(candidate.center) ? { center: finiteVec2(candidate.center)! } : {}),
      ...(finiteVec2(candidate.size) ? { size: finiteVec2(candidate.size)! } : {}),
    }
  }
  return undefined
}

function sitePlacementFromContext(context: Record<string, unknown>) {
  const scene = isRecord(context.scene) ? context.scene : undefined
  const candidates = [context.site, scene?.site]
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const bounds = sceneBoundsFromContext({ sceneBounds: candidate.bounds })
    if (!bounds) continue
    const siteId = stringValue(candidate.id)
    return {
      ...(siteId ? { siteId } : {}),
      siteBounds: bounds,
      siteIsDefault: candidate.isDefault === true,
    }
  }
  return undefined
}

function polygonBounds(points: unknown) {
  if (!Array.isArray(points)) return undefined
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let hasPoint = false
  for (const point of points) {
    const parsed = finiteVec2(point)
    if (!parsed) continue
    minX = Math.min(minX, parsed[0])
    maxX = Math.max(maxX, parsed[0])
    minZ = Math.min(minZ, parsed[1])
    maxZ = Math.max(maxZ, parsed[1])
    hasPoint = true
  }
  if (!hasPoint) return undefined
  return { minX, minZ, maxX, maxZ }
}

function containsBounds(
  outer: { min: [number, number]; max: [number, number] },
  inner: { minX: number; minZ: number; maxX: number; maxZ: number },
) {
  return (
    outer.min[0] <= inner.minX &&
    outer.min[1] <= inner.minZ &&
    outer.max[0] >= inner.maxX &&
    outer.max[1] >= inner.maxZ
  )
}

function defaultSiteExpansionPatch(
  patches: FactoryScenePatch[],
  placement: GeneratedGeometryPlacementSpec,
): FactorySceneEditPatch | undefined {
  const metadata = placement.metadata ?? {}
  if (metadata.siteIsDefault !== true || typeof metadata.siteId !== 'string') return undefined
  const layoutZone = patches.find(
    (patch) =>
      patch.op === 'create' &&
      patch.node.type === 'zone' &&
      isRecord(patch.node.metadata) &&
      patch.node.metadata.role === 'layout-zone' &&
      'polygon' in patch.node,
  )
  const bounds =
    layoutZone?.op === 'create' && 'polygon' in layoutZone.node
      ? polygonBounds(layoutZone.node.polygon)
      : undefined
  if (!bounds) return undefined
  const margin = 4
  const expanded = {
    minX: bounds.minX - margin,
    minZ: bounds.minZ - margin,
    maxX: bounds.maxX + margin,
    maxZ: bounds.maxZ + margin,
  }
  const siteBounds = isRecord(metadata.siteBounds)
    ? sceneBoundsFromContext({ sceneBounds: metadata.siteBounds })
    : undefined
  if (siteBounds && containsBounds(siteBounds, expanded)) return undefined
  return {
    op: 'update',
    id: metadata.siteId,
    data: {
      polygon: {
        type: 'polygon',
        points: [
          [expanded.minX, expanded.minZ],
          [expanded.maxX, expanded.minZ],
          [expanded.maxX, expanded.maxZ],
          [expanded.minX, expanded.maxZ],
        ],
      },
    },
  }
}

function withDefaultSiteExpansion(result: FactoryRunResult): FactoryRunResult {
  const patch = defaultSiteExpansionPatch(result.patches, result.placement)
  if (!patch) return result
  return {
    ...result,
    patches: [...result.patches, patch],
    nodeIds: [...result.nodeIds, patch.op === 'create' ? patch.node.id : patch.id],
    created: [...result.created, 'Site boundary expanded'],
  }
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
  const buildingId = stringValue(params.buildingId) ?? stringValue(context.buildingId)
  const lineId = stringValue(params.lineId) ?? stringValue(context.lineId)
  const lineRole = stringValue(params.lineRole) ?? stringValue(context.lineRole)
  const equipmentRole = stringValue(params.equipmentRole) ?? stringValue(context.equipmentRole)
  const sceneBounds = sceneBoundsFromContext(context)
  const sitePlacement = sitePlacementFromContext(context)
  return {
    ...(parentId ? { parentId } : {}),
    position: vec3Value(params.position) ?? vec3Value(context.position),
    rotation: vec3Value(params.rotation) ?? vec3Value(context.rotation),
    generatedBy: 'factory-agent',
    metadata: {
      ...(lineId ? { lineId } : {}),
      ...(lineRole ? { lineRole } : {}),
      ...(equipmentRole ? { equipmentRole } : {}),
      ...(buildingId ? { buildingId } : {}),
      ...(sceneBounds ? { sceneBounds } : {}),
      ...(sitePlacement ?? {}),
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
    const missingAssets = [
      {
        name: input.prompt,
        reason: input.geometry.error ?? 'geometry generation did not produce an artifact',
        required: true,
      },
    ]
    return withFactoryQuality({
      intent: { action: 'generate_equipment_draft', prompt: input.prompt },
      applied: false,
      plan: input.plan,
      plannerSource: input.plannerSource,
      patches: [],
      nodeIds: [],
      created: [],
      missingAssets,
      geometryRunId: input.geometry.runId,
      geometryStatus: input.geometry.status,
      placement: input.placement,
    })
  }

  const patchPlan = buildGeneratedGeometryCreatePatches(artifact, input.placement)
  const result: FactoryRunResult = {
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
  return withFactoryQuality(result)
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
    return withFactoryQuality(
      withDefaultSiteExpansion({
        intent: { action: 'layout_plan', prompt },
        applied: false,
        plan,
        plannerSource,
        patches: layoutPatchPlan.patches,
        nodeIds: layoutPatchPlan.nodeIds,
        created: layoutPatchPlan.created,
        missingAssets: layoutPatchPlan.missingAssets,
        placement,
      }),
    )
  }

  if (plan.kind === 'process_line') {
    const processPlan = composeProcessLine({
      prompt,
      plan: plan.process,
      placement,
      params: input.params,
    })
    return withFactoryQuality(
      withDefaultSiteExpansion({
        intent: { action: 'process_line_plan', prompt },
        applied: false,
        plan,
        plannerSource,
        patches: processPlan.patches,
        nodeIds: processPlan.nodeIds,
        created: processPlan.created,
        missingAssets: processPlan.missingAssets,
        focusBounds: processPlan.focusBounds,
        placement,
      }),
    )
  }

  if (plan.kind === 'catalog_item') {
    const asset = findCatalogItem(plan.catalogItemId)
    if (!asset) {
      return withFactoryQuality({
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
      })
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
    return withFactoryQuality({
      intent: { action: 'place_catalog_item', prompt },
      applied: false,
      plan,
      plannerSource,
      patches,
      nodeIds: [node.id],
      created: [asset.name],
      missingAssets: [],
      placement,
    })
  }

  if (plan.kind === 'missing') {
    return withFactoryQuality({
      intent: { action: 'missing', prompt },
      applied: false,
      plan,
      plannerSource,
      patches: [],
      nodeIds: [],
      created: [],
      missingAssets: [{ name: plan.missingName, reason: plan.reason, required: true }],
      placement,
    })
  }

  return null
}

export function buildFactoryRunResultFromSelectionEdit(input: {
  prompt: string
  context?: unknown
  placement: GeneratedGeometryPlacementSpec
}): FactoryRunResult | null {
  const edit = composeSelectionEdit({
    prompt: input.prompt,
    context: input.context,
  })
  if (!edit) return null

  return withFactoryQuality({
    intent: { action: 'edit_selection', prompt: input.prompt },
    applied: false,
    patches: edit.patches,
    nodeIds: edit.nodeIds,
    created: edit.changed,
    editSummary: edit.summary,
    missingAssets: edit.missingReason
      ? [
          {
            name: 'selected object',
            reason: edit.missingReason,
            required: true,
          },
        ]
      : [],
    placement: input.placement,
  })
}

export async function buildFactoryRunResultFromProcessLine(input: {
  prompt: string
  plan: Extract<FactoryPlan, { kind: 'process_line' }>
  plannerSource?: 'llm' | 'fallback'
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): Promise<FactoryRunResult> {
  const processPlan = composeProcessLine({
    prompt: input.prompt,
    plan: input.plan.process,
    placement: input.placement,
    params: input.params,
  })

  const missingAssets = processPlan.primitiveRequests.map((request) => ({
    name: stationDisplayLabel(request.station),
    reason:
      'No registered equipment node, catalog item, or native resolver matched this station; a station zone placeholder remains.',
    required: false,
  }))

  return withFactoryQuality(
    withDefaultSiteExpansion({
      intent: { action: 'process_line_plan', prompt: input.prompt },
      applied: false,
      plan: input.plan,
      plannerSource: input.plannerSource,
      patches: processPlan.patches,
      nodeIds: processPlan.nodeIds,
      created: processPlan.created,
      missingAssets,
      focusBounds: processPlan.focusBounds,
      layoutDiagnostics: processPlan.layoutDiagnostics,
      layoutStrategy: processPlan.layoutStrategy,
      placement: input.placement,
    }),
  )
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
    const selectionEditResult = buildFactoryRunResultFromSelectionEdit({
      prompt: run.prompt,
      context: run.context,
      placement,
    })
    if (selectionEditResult) {
      const runStatus = failedFactoryRunStatus(
        selectionEditResult,
        selectionEditResult.missingAssets.some((asset) => asset.required),
        selectionEditResult.missingAssets[0]?.reason ?? 'selection edit failed',
      )
      await appendRunEvent(runId, {
        type: 'message',
        message: runStatus.failed
          ? 'Selection edit could not be resolved.'
          : 'Selection edit patch plan generated; patches are ready.',
        data: {
          stage: 'selection-edit',
          patchCount: selectionEditResult.patches.length,
          nodeIds: selectionEditResult.nodeIds,
          missingAssets: selectionEditResult.missingAssets,
          qualityReport: selectionEditResult.qualityReport,
        },
      })
      await appendRunEvent(runId, { type: 'result', data: selectionEditResult })
      await updateRun(runId, {
        status: runStatus.failed ? 'failed' : 'succeeded',
        completedAt: new Date().toISOString(),
        ...(runStatus.failed ? { error: runStatus.error } : {}),
        result: selectionEditResult,
      })
      await appendRunEvent(runId, {
        type: 'status',
        message: runStatus.failed ? 'failed' : 'succeeded',
        data: { status: runStatus.failed ? 'failed' : 'succeeded', error: runStatus.error },
      })
      return
    }

    const planned = await planFactoryRequest({
      prompt: run.prompt,
      params: run.params,
      signal: controller.signal,
    })

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
    if (planned.plan.kind === 'process_line') {
      const processLineResult = await buildFactoryRunResultFromProcessLine({
        prompt: run.prompt,
        plan: planned.plan,
        plannerSource: planned.source,
        placement,
        params: run.params,
      })
      await appendRunEvent(runId, {
        type: 'message',
        message: 'Factory process line generated; patches are ready.',
        data: {
          stage: 'patch-plan',
          plan: planned.plan,
          patchCount: processLineResult.patches.length,
          nodeIds: processLineResult.nodeIds,
          missingAssets: processLineResult.missingAssets,
          layoutDiagnostics: processLineResult.layoutDiagnostics,
          layoutStrategy: processLineResult.layoutStrategy,
          qualityReport: processLineResult.qualityReport,
        },
      })
      await appendRunEvent(runId, { type: 'result', data: processLineResult })
      const runStatus = failedFactoryRunStatus(
        processLineResult,
        false,
        'Factory process line failed quality checks.',
      )
      await updateRun(runId, {
        status: runStatus.failed ? 'failed' : 'succeeded',
        completedAt: new Date().toISOString(),
        ...(runStatus.failed ? { error: runStatus.error } : {}),
        result: processLineResult,
      })
      await appendRunEvent(runId, {
        type: 'status',
        message: runStatus.failed ? 'failed' : 'succeeded',
        data: { status: runStatus.failed ? 'failed' : 'succeeded', error: runStatus.error },
      })
      return
    }

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
          qualityReport: planResult.qualityReport,
        },
      })
      await appendRunEvent(runId, { type: 'result', data: planResult })
      const runStatus = failedFactoryRunStatus(
        planResult,
        planned.plan.kind === 'missing',
        planResult.missingAssets[0]?.reason ?? 'missing asset',
      )
      await updateRun(runId, {
        status: runStatus.failed ? 'failed' : 'succeeded',
        completedAt: new Date().toISOString(),
        ...(runStatus.failed ? { error: runStatus.error } : {}),
        result: planResult,
      })
      await appendRunEvent(runId, {
        type: 'status',
        message: runStatus.failed ? 'failed' : 'succeeded',
        data: { status: runStatus.failed ? 'failed' : 'succeeded', error: runStatus.error },
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
        lineRole:
          stringValue(run.params?.lineRole) ??
          stringValue(recordFromRunContext(run.context).lineRole),
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
        qualityReport: result.qualityReport,
      },
    })
    await appendRunEvent(runId, { type: 'result', data: result })
    const runStatus = failedFactoryRunStatus(
      result,
      !result.artifact,
      result.missingAssets[0]?.reason ?? 'missing asset',
    )
    await updateRun(runId, {
      status: runStatus.failed ? 'failed' : 'succeeded',
      completedAt: new Date().toISOString(),
      ...(runStatus.failed ? { error: runStatus.error } : {}),
      result,
    })
    await appendRunEvent(runId, {
      type: 'status',
      message: runStatus.failed ? 'failed' : 'succeeded',
      data: { status: runStatus.failed ? 'failed' : 'succeeded', error: runStatus.error },
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
