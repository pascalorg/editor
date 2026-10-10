import { refuse } from '../agent-tools/refusal'
import type { AnyNode, GuideNode } from '../schema'
import {
  ReferenceCalibrationRequired,
  type ReferenceContour,
  requireGuide,
} from './reference-construction'
import { imagePointToLevel, type ReferencePoint } from './reference-transform'

const SAMPLES = 160
const MAX_ITERATIONS = 60
/** Rotation, translation and scale steps below this stop the fit. */
const CONVERGED = 1e-9

type Similarity = { s: number; phi: number; tx: number; tz: number }
const IDENTITY: Similarity = { s: 1, phi: 0, tx: 0, tz: 0 }

const applySimilarity = (
  { s, phi, tx, tz }: Similarity,
  [x, z]: ReferencePoint,
): ReferencePoint => [
  s * (Math.cos(phi) * x - Math.sin(phi) * z) + tx,
  s * (Math.sin(phi) * x + Math.cos(phi) * z) + tz,
]
/** `a` after `b`. */
const compose = (a: Similarity, b: Similarity): Similarity => {
  const [tx, tz] = applySimilarity(a, [b.tx, b.tz])
  return { s: a.s * b.s, phi: a.phi + b.phi, tx, tz }
}

function guideFrame(guide: GuideNode) {
  const ref = guide.metadata.planReference as { width?: number; height?: number } | undefined
  const width = Number(ref?.width)
  const height = Number(ref?.height)
  if (!(width > 0 && height > 0))
    refuse('no_image_size', `${guide.name ?? guide.id} has no image size.`, { guideId: guide.id })
  const image = { width, height }
  const transform = {
    metersPerPixel: (guide.scale * 10) / width,
    rotation: guide.rotation[1],
    position: [guide.position[0], guide.position[2]] as ReferencePoint,
  }
  return (point: ReferencePoint) => imagePointToLevel(point, image, transform)
}

function contoursOf(guide: GuideNode): ReferenceContour[] {
  const contours = guide.metadata.referenceContours
  if (!(Array.isArray(contours) && contours.length))
    refuse('no_contours', `${guide.name ?? guide.id} has no contours to match.`, {
      guideId: guide.id,
    })
  return contours as ReferenceContour[]
}

function polygonArea(points: ReferencePoint[]) {
  let sum = 0
  for (let k = 0; k < points.length; k++) {
    const a = points[k]!
    const b = points[(k + 1) % points.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

const centroid = (points: ReferencePoint[]): ReferencePoint => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
]

/** Evenly spaced points along a contour (closed unless it is a stroke). */
function resample(points: ReferencePoint[], closed: boolean): ReferencePoint[] {
  const path = closed ? [...points, points[0]!] : points
  const lengths = path.slice(1).map((p, k) => Math.hypot(p[0] - path[k]![0], p[1] - path[k]![1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return [points[0]!]
  const out: ReferencePoint[] = []
  let segment = 0
  let walked = 0
  for (let n = 0; n < SAMPLES; n++) {
    const at = (total * n) / (closed ? SAMPLES : SAMPLES - 1)
    while (segment < lengths.length - 1 && walked + lengths[segment]! < at)
      walked += lengths[segment++]!
    const t = lengths[segment]! > 0 ? Math.min(1, (at - walked) / lengths[segment]!) : 0
    const a = path[segment]!
    const b = path[segment + 1]!
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

function nearestOnPath(p: ReferencePoint, path: ReferencePoint[]): ReferencePoint {
  let best: ReferencePoint = path[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k]!
    const b = path[k + 1]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = dx * dx + dz * dz
    const t =
      length > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length)) : 0
    const q: ReferencePoint = [a[0] + dx * t, a[1] + dz * t]
    const distance = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = q
    }
  }
  return best
}

/** Least-squares similarity taking `from` onto `to` (Umeyama, in 2D). */
function fitSimilarity(
  from: ReferencePoint[],
  to: ReferencePoint[],
  scaleBounds: [number, number],
): Similarity {
  const [fx, fz] = centroid(from)
  const [tx, tz] = centroid(to)
  let sxx = 0
  let sxz = 0
  let szx = 0
  let szz = 0
  let variance = 0
  for (let k = 0; k < from.length; k++) {
    const px = from[k]![0] - fx
    const pz = from[k]![1] - fz
    const qx = to[k]![0] - tx
    const qz = to[k]![1] - tz
    sxx += qx * px
    sxz += qx * pz
    szx += qz * px
    szz += qz * pz
    variance += px * px + pz * pz
  }
  const phi = Math.atan2(szx - sxz, sxx + szz)
  const raw =
    variance > 0 ? (Math.cos(phi) * (sxx + szz) + Math.sin(phi) * (szx - sxz)) / variance : 1
  const s = Math.min(scaleBounds[1], Math.max(scaleBounds[0], raw))
  const [rx, rz] = applySimilarity({ s, phi, tx: 0, tz: 0 }, [fx, fz])
  return { s, phi, tx: tx - rx, tz: tz - rz }
}

/**
 * Tighten a plan match: fit the target plan's outline onto the matching contour of a calibrated
 * anchor plan (rotation, translation, and scale within `maxScaleChange`), and return the guide
 * transform that realises it with the leftover error in metres. A two-point match is only as good
 * as its two picks; this is the correction people otherwise make by hand.
 */
export function planReferenceRefine({
  nodes,
  targetGuideId,
  anchorGuideId,
  targetContourId,
  anchorContourId,
  maxScaleChange = 0.02,
}: {
  nodes: Record<string, AnyNode>
  targetGuideId: string
  anchorGuideId: string
  targetContourId?: string
  anchorContourId?: string
  maxScaleChange?: number
}) {
  const target = requireGuide(nodes, targetGuideId)
  const anchor = requireGuide(nodes, anchorGuideId)
  if (target.id === anchor.id)
    refuse('same_plan', 'Choose two different references.', { guideId: target.id })
  if (!anchor.scaleReference) throw new ReferenceCalibrationRequired([anchor.id])
  if (!(Number.isFinite(maxScaleChange) && maxScaleChange >= 0 && maxScaleChange < 1))
    refuse('invalid_scale_change', 'Use a scale change between 0 and 1.', { maxScaleChange })

  const toTargetLevel = guideFrame(target)
  const toAnchorLevel = guideFrame(anchor)
  const targetContours = contoursOf(target)
  const anchorContours = contoursOf(anchor)
  const byArea = (contours: ReferenceContour[]) =>
    [...contours].sort((a, b) => polygonArea(b.points) - polygonArea(a.points))
  const targetContour = targetContourId
    ? targetContours.find((c) => c.id === targetContourId)
    : (byArea(targetContours.filter((c) => !c.stroke))[0] ?? targetContours[0])
  if (!targetContour)
    refuse('contour_not_found', `Contour not found: ${targetContourId}.`, {
      contourId: targetContourId,
    })
  const closed = !targetContour.stroke
  const start = resample(targetContour.points.map(toTargetLevel), closed)
  const targetArea = polygonArea(targetContour.points.map(toTargetLevel))
  const [cx, cz] = centroid(start)
  // Without an explicit anchor contour, take the one of the same kind that best matches in place
  // and size — the footprint the plan was just matched onto.
  const anchorContour = anchorContourId
    ? anchorContours.find((c) => c.id === anchorContourId)
    : anchorContours
        .filter((c) => !!c.stroke === !closed)
        .map((c) => {
          const level = c.points.map(toAnchorLevel)
          const [ax, az] = centroid(level)
          const area = polygonArea(level)
          const sizeGap = area > 0 && targetArea > 0 ? Math.abs(Math.log(area / targetArea)) : 10
          return { c, cost: Math.hypot(ax - cx, az - cz) + sizeGap * Math.sqrt(targetArea) }
        })
        .sort((a, b) => a.cost - b.cost)[0]?.c
  if (!anchorContour)
    refuse('contour_not_found', `Contour not found: ${anchorContourId ?? 'no matching contour'}.`, {
      contourId: anchorContourId,
    })
  const anchorPath = anchorContour.points.map(toAnchorLevel)
  if (!anchorContour.stroke) anchorPath.push(anchorPath[0]!)

  let total = IDENTITY
  let residuals: number[] = []
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const moved = start.map((p) => applySimilarity(total, p))
    const nearest = moved.map((p) => nearestOnPath(p, anchorPath))
    residuals = moved.map((p, k) => Math.hypot(p[0] - nearest[k]![0], p[1] - nearest[k]![1]))
    const bounds: [number, number] = [
      (1 - maxScaleChange) / total.s,
      (1 + maxScaleChange) / total.s,
    ]
    const step = fitSimilarity(moved, nearest, bounds)
    total = compose(step, total)
    if (
      Math.abs(step.s - 1) < CONVERGED &&
      Math.abs(step.phi) < CONVERGED &&
      Math.hypot(step.tx, step.tz) < CONVERGED
    )
      break
  }
  const final = start.map((p) => applySimilarity(total, p))
  residuals = final.map((p) => {
    const q = nearestOnPath(p, anchorPath)
    return Math.hypot(p[0] - q[0], p[1] - q[1])
  })
  const [px, pz] = applySimilarity(total, [target.position[0], target.position[2]])
  return {
    update: {
      position: [px, target.position[1], pz] as GuideNode['position'],
      rotation: [
        target.rotation[0],
        target.rotation[1] - total.phi,
        target.rotation[2],
      ] as GuideNode['rotation'],
      scale: target.scale * total.s,
    },
    targetContourId: targetContour.id,
    anchorContourId: anchorContour.id,
    residualMeters: Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length),
    worstMeters: Math.max(...residuals),
  }
}
