import { refuse } from '../agent-tools/refusal'
import { rasterFramedSvg } from '../building/plan-vectorize'
import { guideReference } from '../building/reference-calibration'
import { planReferenceShapes } from '../building/reference-import'
import type { SvgContour } from '../building/reference-svg'
import { polygonArea } from '../building/room-habitable'
import type { GuideNode } from '../schema'
import { levelPlanGuide } from './furnish-from-plan'
import type { LevelTargetInput } from './level-target'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

/**
 * `vectorize_plan` (L42): a raster plan as the host's vectoriser draws it, so what a raster import
 * cannot trace (furniture, fixtures, cars, door swings, labels) reads. The host asks its paid
 * vectoriser before the call (`vectorizePlanTarget` first, which refuses a plan already in SVG
 * before any spend) and passes the answer as `context.planVector`. The guide then shows the SVG,
 * framed in the raster's pixels so its place and calibration hold, and keeps the original image.
 */

type VectorizePlanInput = LevelTargetInput & { guideId?: string }

const isVectorPlan = (guide: GuideNode) =>
  (guide.metadata.planReference as { mimeType?: string }).mimeType === 'image/svg+xml' ||
  /\.svg(?:$|\?)/i.test(guide.url) ||
  guide.url.startsWith('data:image/svg+xml')

/** The raster plan the host's vectoriser reads: refused, before any spend, when there is none. */
export function vectorizePlanTarget(
  nodes: SceneNodes,
  input: VectorizePlanInput,
  context: AgentContext,
) {
  const { guide } = levelPlanGuide(nodes, input, context, { shapes: false })
  if (isVectorPlan(guide))
    refuse(
      'already_vector',
      `Plan ${guide.id} is an SVG already: what it draws reads as it is (furnish_from_plan, survey_plan_references). Nothing was spent.`,
      { guideId: guide.id },
    )
  const { width, height, mimeType } = guide.metadata.planReference as {
    width: number
    height: number
    mimeType?: string
  }
  return { guideId: guide.id, url: guide.url, mimeType: mimeType ?? 'image/png', width, height }
}

export const vectorizePlan: AgentOperation<VectorizePlanInput> = (nodes, input, context) => {
  const target = vectorizePlanTarget(nodes, input, context)
  const { guideId } = target
  const answer = context.planVector?.guideId === guideId ? context.planVector : undefined
  if (!answer)
    refuse(
      'vectorizer_unavailable',
      "This server has no plan vectoriser. Convert the plan to SVG elsewhere and import that with import_plan_reference: an SVG's furniture, doors and labels read as they are.",
      { guideId },
    )
  if (answer.refusal) refuse(answer.refusal.code, answer.refusal.message, { guideId })
  if (answer.error)
    refuse('vectorize_failed', `The vectoriser failed: ${answer.error} The plan is as it was.`, {
      guideId,
    })
  let svg: string
  let shapes: ReturnType<typeof planReferenceShapes>
  try {
    svg = rasterFramedSvg(answer.svg ?? '', target)
    shapes = planReferenceShapes(svg, target)
  } catch (error) {
    refuse(
      'vectorize_failed',
      `The vectoriser's answer holds no SVG plan (${error instanceof Error ? error.message : String(error)}). The plan is as it was.`,
      { guideId },
    )
  }
  const contours = shapes.referenceContours?.length ?? 0
  if (!contours)
    refuse('vectorize_failed', "The vectoriser's SVG draws nothing. The plan is as it was.", {
      guideId,
    })

  const guide = nodes[guideId] as GuideNode
  const { traced: _traced, ...planReference } = guide.metadata.planReference as Record<
    string,
    unknown
  >
  const { referenceContours: _contours, referenceLabels: _labels, ...metadata } = guide.metadata
  const model = answer.model ?? 'vectoriser'
  const data = {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    metadata: {
      ...metadata,
      planReference: { ...planReference, mimeType: 'image/svg+xml' },
      planVectors: { method: model, originalUrl: guide.url },
      ...shapes,
    },
  } as Partial<GuideNode>
  const outline = planOutline({ ...guide, ...data } as GuideNode)
  return {
    result: {
      ok: true,
      guideId,
      contours,
      labels: shapes.referenceLabels?.length ?? 0,
      model,
      ...(answer.cost ? { cost: answer.cost } : {}),
      ...(outline ? { outline: outline.reported } : {}),
      message: `The plan reads as an SVG now, in its own pixels and calibration: furnish_from_plan numbers the furniture, fixtures and cars it draws. Its original image is kept (metadata.planVectors.originalUrl).${outline ? ` ${outline.advice}` : ''}`,
    },
    changes: { update: [{ id: guideId, data }] },
  }
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * The building's outline as the SVG draws it (its largest closed shape), measured at the plan's
 * scale. A scale set on the raster stays: L42 live, set on the trace's largest contour, which was
 * no outline, it read 0.090 m a pixel and every piece three times too large. Its outline in metres
 * shows a wrong scale at a glance.
 */
function planOutline(guide: GuideNode) {
  const [largest] = ((guide.metadata.referenceContours ?? []) as SvgContour[])
    .filter((contour) => !contour.stroke && contour.points.length >= 3)
    .map((contour) => ({ contour, area: Math.abs(polygonArea(contour.points)) }))
    .sort((a, b) => b.area - a.area)
  if (!largest) return null
  const { id, points } = largest.contour
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const sizePx = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
  if (!guide.scaleReference)
    return {
      reported: { contourId: id, sizePx: sizePx.map(round) },
      advice: `Calibrate it next (calibrate_plan_reference); its outline is contour ${id}, ${sizePx.map(Math.round).join(' × ')} px.`,
    }
  const metersPerPixel = guideReference(guide).transform.metersPerPixel
  const sizeMeters = sizePx.map((value) => round(value * metersPerPixel))
  return {
    reported: { contourId: id, sizeMeters },
    advice: `Its scale was set before ("${guide.scaleReference.label}"): at that scale its outline, contour ${id}, is ${sizeMeters.join(' × ')} m. If that is not the building's size, recalibrate on the outline: calibrate_plan_reference {contourId: '${id}', length, replace: true}.`,
  }
}
