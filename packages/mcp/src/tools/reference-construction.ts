import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { achievedChanges, type SceneNodes } from '@pascal-app/core/agent-operations'
import {
  adjustPlanReferenceTool,
  alignReferenceFramesTool,
  importPlanReferenceTool,
  isAgentRefusal,
  refinePlanMatchTool,
  refuse,
} from '@pascal-app/core/agent-tools'
import {
  planImportSummary,
  planPreviewSvg,
  planReferenceAdjust,
  planReferenceFrameAlignment,
  planReferenceGuide,
  planReferenceRefine,
  type RasterPlan,
  ReferenceCalibrationRequired,
  readPlanSource,
  requireGuide,
  requirePlanLevel,
} from '@pascal-app/core/building'
import type { AnyNode, AnyNodeId, GuideNode } from '@pascal-app/core/schema'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { refusalResult, toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { type SourceResolver, UPLOAD_HINT } from './source-resolver'

function failure(error: unknown) {
  if (isAgentRefusal(error)) return refusalResult(error)
  return error instanceof ReferenceCalibrationRequired
    ? toolError(error.message, {
        status: 'human_action_required',
        action: 'calibrate_reference',
        guideIds: error.guideIds,
        retryAfter:
          'Calibrate one plan with calibrate_plan_reference on a printed or standard length (a US door leaf 36 in, a bathtub 60 in) and say what you measured, or match_plan_reference it onto a calibrated plan; ask the user only when nothing standard is visible. Then retry.',
      })
    : toolError(error instanceof Error ? error.message : 'Reference construction failed.')
}
const result = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  structuredContent: payload,
})

/** Inline SVG markup or a data:image URL. The server never fetches a remote plan. */
function inlinePlan(
  source: string,
  uploads: boolean,
): { bytes: Uint8Array; url: string; mediaType?: string } {
  const trimmed = source.trim()
  if (trimmed.startsWith('<')) {
    const bytes = new TextEncoder().encode(trimmed)
    return {
      bytes,
      url: `data:image/svg+xml;base64,${Buffer.from(bytes).toString('base64')}`,
      mediaType: 'image/svg+xml',
    }
  }
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(trimmed)
  if (!match)
    refuse(
      'plan_not_inline',
      `Pass the plan inline: SVG markup or a data:image/...;base64 URL. The server does not fetch remote files.${uploads ? ` ${UPLOAD_HINT}` : ''}`,
    )
  return { bytes: Buffer.from(match[2]!, 'base64'), url: trimmed, mediaType: match[1] }
}

/**
 * Decodes a raster plan's pixels on the host (core decodes no image). Without one, a PNG, JPEG or
 * WebP plan is placed to read from, with no wall lines traced.
 */
export type PlanRasterDecoder = (bytes: Uint8Array, mediaType: string) => Promise<RasterPlan>

function lowestLevelId(nodes: Record<string, AnyNode>) {
  return Object.values(nodes)
    .filter((node) => node.type === 'level')
    .sort((a, b) => (a as { level?: number }).level! - (b as { level?: number }).level!)[0]?.id
}

export function registerReferenceConstruction(
  server: McpServer,
  operations: SceneOperations,
  decodeRaster?: PlanRasterDecoder,
  /** The host vectorises raster plans: a raster's import says what that would read. */
  vectorizer = false,
  /** Plans the agent uploaded rather than inlined (`asset:<id>`). */
  resolveSource?: SourceResolver,
  /** Draws an SVG plan as the PNG the model is shown, as the chat does (L69). */
  rasterizeSvg?: (svg: string) => Promise<{ data: string; mimeType: string }>,
) {
  server.registerTool(
    alignReferenceFramesTool.name,
    {
      title: alignReferenceFramesTool.title,
      description: alignReferenceFramesTool.description,
      inputSchema: alignReferenceFramesTool.input,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ anchorGuideId, targetGuideIds }) => {
      let guides: GuideNode[]
      try {
        guides = planReferenceFrameAlignment(operations.getNodes(), anchorGuideId, targetGuideIds)
      } catch (error) {
        return failure(error)
      }
      if (!guides.length) return result({ status: 'already_present', updatedIds: [] })
      const achieved = achievedChanges(operations.getNodes() as SceneNodes, {
        update: guides.map((guide) => ({ id: guide.id, data: guide })),
      })
      operations.applyPatch(
        guides.map((guide) => ({ op: 'update' as const, id: guide.id, data: guide })),
      )
      const persistence = await publishLiveSceneSnapshot(operations, 'align_reference_frames')
      return result({
        status: 'aligned',
        updatedIds: guides.map((g) => g.id),
        achieved,
        ...persistencePayload(persistence),
      })
    },
  )
  server.registerTool(
    importPlanReferenceTool.name,
    {
      title: importPlanReferenceTool.title,
      description: importPlanReferenceTool.description,
      inputSchema: importPlanReferenceTool.input,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ source, levelId, name, sharedFrame }) => {
      let guide: GuideNode
      let svgPlan = false
      try {
        const nodes = operations.getNodes() as Record<string, AnyNode>
        const level = requirePlanLevel(nodes, levelId ?? lowestLevelId(nodes), levelId)
        const plan =
          (await resolveSource?.(source, 'keep')) ?? inlinePlan(source, Boolean(resolveSource))
        const read = readPlanSource(plan.bytes, plan.mediaType)
        svgPlan = Boolean(read.svg)
        guide = planReferenceGuide({
          levelId: level,
          name,
          url: plan.url,
          source: read,
          sharedFrame,
          ...(!read.svg && decodeRaster
            ? { raster: await decodeRaster(plan.bytes, read.mimeType) }
            : {}),
        })
      } catch (error) {
        return failure(error)
      }
      const achieved = achievedChanges(operations.getNodes() as SceneNodes, {
        create: [{ node: guide, parentId: guide.parentId as string }],
      })
      operations.applyPatch([{ op: 'create', node: guide, parentId: guide.parentId as AnyNodeId }])
      const persistence = await publishLiveSceneSnapshot(operations, 'import_plan_reference')
      const payload = {
        status: 'imported',
        ...planImportSummary(guide, { vectorizer }),
        calibrated: false,
        achieved,
        ...persistencePayload(persistence),
      }
      // An SVG plan comes back drawn, as the chat shows its model a picture of it (one contract,
      // L69): redrawn from the shapes and texts the import read, so the agent's SVG itself never
      // reaches the host's renderer. A raster plan is the agent's own picture.
      const preview = svgPlan && rasterizeSvg ? planPreviewSvg(guide) : null
      const image = preview && rasterizeSvg ? await rasterizeSvg(preview).catch(() => null) : null
      if (!image) return result(payload)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload) },
          { type: 'image' as const, data: image.data, mimeType: image.mimeType },
        ],
        structuredContent: { ...payload, preview: `data:${image.mimeType};base64,${image.data}` },
      }
    },
  )
  server.registerTool(
    adjustPlanReferenceTool.name,
    {
      title: adjustPlanReferenceTool.title,
      description: adjustPlanReferenceTool.description,
      inputSchema: adjustPlanReferenceTool.input,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ guideId, ...delta }) => {
      let data: ReturnType<typeof planReferenceAdjust>
      try {
        data = planReferenceAdjust(
          requireGuide(operations.getNodes() as Record<string, AnyNode>, guideId),
          delta,
        )
      } catch (error) {
        return failure(error)
      }
      const achieved = achievedChanges(operations.getNodes() as SceneNodes, {
        update: [{ id: guideId, data }],
      })
      operations.applyPatch([{ op: 'update', id: guideId as AnyNodeId, data }])
      const persistence = await publishLiveSceneSnapshot(operations, 'adjust_plan_reference')
      return result({
        status: 'adjusted',
        guideId,
        ...data,
        achieved,
        ...persistencePayload(persistence),
      })
    },
  )
  server.registerTool(
    refinePlanMatchTool.name,
    {
      title: refinePlanMatchTool.title,
      description: refinePlanMatchTool.description,
      inputSchema: refinePlanMatchTool.input,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async (input) => {
      let refined: ReturnType<typeof planReferenceRefine>
      try {
        refined = planReferenceRefine({
          ...input,
          nodes: operations.getNodes() as Record<string, AnyNode>,
        })
      } catch (error) {
        return failure(error)
      }
      const achieved = achievedChanges(operations.getNodes() as SceneNodes, {
        update: [{ id: input.targetGuideId, data: refined.update }],
      })
      operations.applyPatch([
        { op: 'update', id: input.targetGuideId as AnyNodeId, data: refined.update },
      ])
      const persistence = await publishLiveSceneSnapshot(operations, 'refine_plan_match')
      return result({
        status: 'refined',
        ...refined,
        achieved,
        ...persistencePayload(persistence),
      })
    },
  )
}
