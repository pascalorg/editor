import { refuse } from '../agent-tools/refusal'
import {
  alignPlanReferences,
  guideReference,
  measuredPlanScale,
  type PlanSegment,
  type PlanTransform,
  type ReferenceView,
  segmentLength,
  transformAboutAnchor,
} from '../building/reference-calibration'
import type { ReferenceContour } from '../building/reference-construction'
import { buildReferenceGuide } from '../building/reference-guides'
import { summarizePlanContours } from '../building/reference-import'
import type { AnyNode, GuideNode, LevelNode } from '../schema'
import { isBuildingMap } from './plan-survey'
import type { AgentOperation, SceneNodes } from './types'

// The editor's plan-workspace calibration and matching, for agents: the same maths and the same
// guide records (reference-calibration, buildReferenceGuide), marked as set by the agent.

type Segment = [[number, number], [number, number]]

const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits || 0

/** A placed plan by id, or the refusal saying what the id is instead. */
export function requirePlanGuide(
  nodes: SceneNodes,
  id: string,
): { guide: GuideNode; view: ReferenceView } {
  const node = nodes[id]
  if (!node) refuse('guide_not_found', `Plan not found: ${id}.`, { guideId: id })
  if (node.type !== 'guide')
    refuse('not_a_guide', `Node ${id} is a ${node.type}, not a plan (guide).`, {
      guideId: id,
      type: node.type,
    })
  try {
    return { guide: node, view: guideReference(node) }
  } catch {
    refuse(
      'not_a_plan',
      `Guide ${id} has no plan dimensions; place the plan with import_plan_reference.`,
      { guideId: id },
    )
  }
}

const contoursOf = (guide: GuideNode) =>
  (Array.isArray(guide.metadata.referenceContours)
    ? guide.metadata.referenceContours
    : []) as ReferenceContour[]

function contourOf(guide: GuideNode, id: string) {
  const found = contoursOf(guide).find((contour) => contour.id === id)
  if (!found)
    refuse(
      'contour_not_found',
      `Plan ${guide.id} has no contour ${id}; get_plan_reference lists them.`,
      { guideId: guide.id, contourId: id },
    )
  return found
}

function boundsOf(points: readonly (readonly [number, number])[]) {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/**
 * What a contour measures: an open line end to end; an area, or a line closing on itself (a tub
 * drawn as a stroke), along its bounding box.
 */
function contourSpan(contour: ReferenceContour, edge: 'long' | 'short'): Segment {
  const points = contour.points as [number, number][]
  const first = points[0]!
  const last = points[points.length - 1]!
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5
  if (contour.stroke && !closed) return [first, last]
  const { minX, minY, maxX, maxY } = boundsOf(points)
  const wide = maxX - minX >= maxY - minY
  return (edge === 'long') === wide
    ? [
        [minX, minY],
        [maxX, minY],
      ]
    : [
        [minX, minY],
        [minX, maxY],
      ]
}

/** A contour's bounding box, corner to corner: the two points a contour match lines up. */
function contourDiagonal(contour: ReferenceContour): Segment {
  const { minX, minY, maxX, maxY } = boundsOf(contour.points as [number, number][])
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

function buildingOf(nodes: SceneNodes, guide: GuideNode) {
  const level = guide.parentId ? nodes[guide.parentId] : undefined
  return level?.type === 'level' ? level.parentId : null
}

/** The guide the editor would save for this transform and calibration record, with our label. */
function calibratedGuide(
  guide: GuideNode,
  view: ReferenceView,
  transform: PlanTransform,
  segment: Segment,
  calibration: Record<string, unknown>,
  label: string,
): GuideNode {
  const node = buildReferenceGuide(
    {
      image: view.image,
      levelId: guide.parentId as LevelNode['id'],
      transform,
      segment,
      role: view.role,
      calibration: {
        ...(guide.metadata.planReference as Record<string, unknown>),
        ...calibration,
        calibratedBy: 'agent',
      },
    },
    guide,
  )
  return { ...node, scaleReference: { ...node.scaleReference!, label } }
}

type GetPlanReferenceInput = {
  guideId: string
  minPx?: number
  maxPx?: number
  region?: Segment
  limit?: number
}

/** `get_plan_reference`: a plan's size, scale and contours with position. */
export const getPlanReference: AgentOperation<GetPlanReferenceInput> = (nodes, input) => {
  const { guide, view } = requirePlanGuide(nodes, input.guideId)
  const all = summarizePlanContours(contoursOf(guide), Number.POSITIVE_INFINITY)
  const [[left, top], [right, bottom]] = input.region ?? [
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
  ]
  const contours = all.filter((contour) => {
    const size = Math.max(contour.widthPx, contour.heightPx)
    return (
      size >= (input.minPx ?? 0) &&
      size <= (input.maxPx ?? Number.POSITIVE_INFINITY) &&
      contour.xPx >= left &&
      contour.yPx >= top &&
      contour.xPx + contour.widthPx <= right &&
      contour.yPx + contour.heightPx <= bottom
    )
  })
  const planReference = guide.metadata.planReference as { sharedFrame?: string }
  return {
    result: {
      guideId: guide.id,
      name: guide.name,
      widthPx: view.image.width,
      heightPx: view.image.height,
      ...(planReference.sharedFrame ? { sharedFrame: planReference.sharedFrame } : {}),
      calibrated: !!guide.scaleReference,
      ...(guide.scaleReference
        ? {
            metersPerPixel: round(view.transform.metersPerPixel, 6),
            calibration: guide.scaleReference.label,
          }
        : {}),
      contourCount: all.length,
      contours: contours.slice(0, input.limit ?? 60),
    },
  }
}

type CalibrateInput = {
  guideId: string
  contourId?: string
  edge?: 'long' | 'short'
  points?: Segment
  standard?: keyof typeof STANDARD_METERS
  length?: number
  label: string
  replace?: boolean
}

/** US standard sizes a plan draws without printing them. */
const STANDARD_METERS = { 'entry-door': 0.9144, bathtub: 1.524, 'stair-tread': 0.2794 } as const

/** A label that admits the length was assumed rather than read or measured. */
const ASSUMED = /\b(assum|typical|guess|estimat|probabl|roughly)/i

/** `calibrate_plan_reference`: the editor's known-length calibration; the first point stays put. */
export const calibratePlanReference: AgentOperation<CalibrateInput> = (nodes, input) => {
  const { guide, view } = requirePlanGuide(nodes, input.guideId)
  if (input.contourId && input.points)
    refuse('conflicting_measure', 'Measure a contour or two points, not both.')
  if (!(input.contourId || input.points))
    refuse(
      'measure_required',
      'Say what to measure: a contourId (get_plan_reference lists them) or two points.',
    )
  if (input.length !== undefined && input.standard)
    refuse('conflicting_length', 'Give a length or a standard size, not both.')
  if (input.length === undefined && !input.standard)
    refuse(
      'length_required',
      'Give the real length: a printed dimension (length) or a standard size you can see (standard).',
    )
  if (!input.standard && ASSUMED.test(input.label))
    refuse(
      'assumed_length',
      'An assumed size is not a measurement. Measure a standard size you can see (standard: entry-door, bathtub, stair-tread) on this plan or on a unit plan you then match onto it, use a printed dimension, or ask the user.',
      { label: input.label },
    )
  const meters = input.standard ? STANDARD_METERS[input.standard] : input.length!
  if (guide.scaleReference && !input.replace)
    refuse(
      'already_calibrated',
      `Plan ${guide.id} already has a scale ("${guide.scaleReference.label}"); pass replace to recalibrate it.`,
      { guideId: guide.id, label: guide.scaleReference.label },
    )
  const segment =
    input.points ?? contourSpan(contourOf(guide, input.contourId!), input.edge ?? 'long')
  const metersPerPixel = measuredPlanScale(segment, meters)
  if (!metersPerPixel)
    refuse('zero_length', 'The two ends of the length are the same point; measure a real length.')

  const transform = transformAboutAnchor(view.image, view.transform, segment[0], { metersPerPixel })
  const node = calibratedGuide(
    guide,
    view,
    transform,
    segment,
    {
      method: 'known-length',
      knownDimension: {
        points: segment,
        meters,
        ...(input.standard ? { standard: input.standard } : {}),
      },
      baselineTransform: transform,
      metersPerPixel,
      manualCorrection: { scaleFactor: 1, anchor: segment[0] },
    },
    input.label,
  )
  return {
    result: {
      guideId: guide.id,
      metersPerPixel: round(metersPerPixel, 6),
      measuredPx: round(segmentLength(segment), 2),
      lengthMeters: round(meters, 4),
      planSizeMeters: [
        round(view.image.width * metersPerPixel, 2),
        round(view.image.height * metersPerPixel, 2),
      ],
      label: input.label,
    },
    changes: { update: [{ id: guide.id, data: node as Partial<AnyNode> }] },
  }
}

type MatchInput = {
  targetGuideId: string
  anchorGuideId: string
  targetPoints?: Segment
  anchorPoints?: Segment
  targetContourId?: string
  anchorContourId?: string
}

/** Places a transform found in the anchor's own frame into the level, as the plan workspace does. */
function inFrame(transform: PlanTransform, frame: PlanTransform): PlanTransform {
  const c = Math.cos(frame.rotation)
  const s = Math.sin(frame.rotation)
  const [x, z] = transform.position
  return {
    ...transform,
    rotation: transform.rotation + frame.rotation,
    position: [frame.position[0] + x * c + z * s, frame.position[1] - x * s + z * c],
  }
}

/**
 * A building map is the building's frame, drawn with its north: a unit plan matched onto it moves,
 * the map never turns. Victor run 5 matched the map onto B2 and turned the building 20°.
 */
function mapAsAnchor(nodes: SceneNodes, input: MatchInput): MatchInput & { swapped: boolean } {
  const target = nodes[input.targetGuideId]
  const anchor = nodes[input.anchorGuideId]
  const swap =
    target?.type === 'guide' &&
    anchor?.type === 'guide' &&
    isBuildingMap(target) &&
    !isBuildingMap(anchor)
  if (!swap) return { ...input, swapped: false }
  return {
    targetGuideId: input.anchorGuideId,
    anchorGuideId: input.targetGuideId,
    targetPoints: input.anchorPoints,
    anchorPoints: input.targetPoints,
    targetContourId: input.anchorContourId,
    anchorContourId: input.targetContourId,
    swapped: true,
  }
}

/**
 * `match_plan_reference`: the editor's two-point match. A calibrated anchor gives the target its
 * scale and place; else a calibrated target gives the anchor its scale, and moves onto it.
 */
export const matchPlanReference: AgentOperation<MatchInput> = (nodes, requested) => {
  const input = mapAsAnchor(nodes, requested)
  const target = requirePlanGuide(nodes, input.targetGuideId)
  const anchor = requirePlanGuide(nodes, input.anchorGuideId)
  if (target.guide.id === anchor.guide.id)
    refuse('same_plan', 'Match a plan onto a different plan.', { guideId: target.guide.id })
  if (buildingOf(nodes, target.guide) !== buildingOf(nodes, anchor.guide))
    refuse(
      'different_building',
      'The two plans are in different buildings; match plans of one building.',
    )

  let segments: [Segment, Segment]
  if (input.targetPoints && input.anchorPoints) segments = [input.targetPoints, input.anchorPoints]
  else if (input.targetContourId && input.anchorContourId)
    segments = [
      contourDiagonal(contourOf(target.guide, input.targetContourId)),
      contourDiagonal(contourOf(anchor.guide, input.anchorContourId)),
    ]
  else
    refuse(
      'match_points_required',
      'Give the same two points on each plan (targetPoints and anchorPoints), or one contour on each (targetContourId and anchorContourId).',
    )
  const [targetEdge, anchorEdge] = segments
  if (segmentLength(targetEdge) < 1 || segmentLength(anchorEdge) < 1)
    refuse('zero_length', 'The two points on each plan must be apart.')

  const anchorScaled = !!anchor.guide.scaleReference
  if (!(anchorScaled || target.guide.scaleReference))
    refuse(
      'not_calibrated',
      'Neither plan has a scale yet: calibrate one first (calibrate_plan_reference on a known or standard length), then match.',
    )

  const metersPerPixel = anchorScaled
    ? (segmentLength(anchorEdge) * anchor.view.transform.metersPerPixel) / segmentLength(targetEdge)
    : target.view.transform.metersPerPixel
  let aligned: ReturnType<typeof alignPlanReferences>
  try {
    aligned = alignPlanReferences({
      floorplan: target.view.image,
      sitemap: anchor.view.image,
      metersPerPixel,
      floorplanEdge: targetEdge as PlanSegment,
      sitemapEdge: anchorEdge as PlanSegment,
    })
  } catch (error) {
    refuse('points_outside_plan', `${(error as Error).message} Points are in each plan's pixels.`)
  }
  const anchorTransform = anchorScaled
    ? anchor.view.transform
    : { ...anchor.view.transform, metersPerPixel: aligned.sitemap.metersPerPixel }
  const targetTransform = inFrame(aligned.floorplan, anchorTransform)
  const alignment = {
    anchorGuideId: anchor.guide.id,
    targetGuideId: target.guide.id,
    anchorEdge,
    targetEdge,
    anchorTransform,
  }

  const targetLabel = anchorScaled
    ? `Matched onto ${anchor.guide.name ?? anchor.guide.id}`
    : target.guide.scaleReference!.label
  const update = [
    {
      id: target.guide.id,
      data: calibratedGuide(
        target.guide,
        target.view,
        targetTransform,
        targetEdge,
        {
          ...(anchorScaled ? { method: 'matched-span' } : {}),
          alignment,
          baselineTransform: targetTransform,
          metersPerPixel: targetTransform.metersPerPixel,
          manualCorrection: { scaleFactor: 1, anchor: targetEdge[0] },
        },
        targetLabel,
      ) as Partial<AnyNode>,
    },
  ]
  if (!anchorScaled)
    update.push({
      id: anchor.guide.id,
      data: calibratedGuide(
        anchor.guide,
        anchor.view,
        anchorTransform,
        anchorEdge,
        {
          method: 'matched-span',
          alignment,
          metersPerPixel: anchorTransform.metersPerPixel,
        },
        `Scale from ${target.guide.name ?? target.guide.id} (${target.guide.scaleReference!.label})`,
      ) as Partial<AnyNode>,
    })

  return {
    result: {
      targetGuideId: target.guide.id,
      anchorGuideId: anchor.guide.id,
      scaled: anchorScaled ? 'target' : 'anchor',
      metersPerPixel: round(
        anchorScaled ? targetTransform.metersPerPixel : anchorTransform.metersPerPixel,
        6,
      ),
      rotationDegrees: round(
        ((targetTransform.rotation - anchorTransform.rotation) * 180) / Math.PI,
        2,
      ),
      ...(input.swapped
        ? {
            mapKeptOrientation: true,
            note: `${anchor.guide.name ?? anchor.guide.id} is a building map: it keeps its orientation and ${target.guide.name ?? target.guide.id} moved onto it.`,
          }
        : {}),
      next: 'refine_plan_match tightens the fit and reports the leftover error.',
    },
    changes: { update },
  }
}
