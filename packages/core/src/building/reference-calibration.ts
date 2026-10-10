import type { GuideNode } from '../schema'
import type { ReferenceImage } from './reference-guides'
import { imagePointToLevel } from './reference-transform'

/** Image pixels use +Y down; a guide uses +Z down in the level's top view. */
export type PlanPoint = [number, number]
export type PlanSegment = [PlanPoint, PlanPoint]
export type PlanImage = { width: number; height: number }
export type PlanTransform = { metersPerPixel: number; rotation: number; position: PlanPoint }

export function segmentLength([a, b]: PlanSegment) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

export function measuredPlanScale(points: PlanPoint[], meters: number): number | null {
  if (points.length !== 2 || !Number.isFinite(meters) || meters <= 0) return null
  if (points.some((point) => point.some((value) => !Number.isFinite(value)))) return null
  const pixels = segmentLength(points as PlanSegment)
  return pixels >= 1 ? meters / pixels : null
}

/** SVG affine transform uses the exact guide transforms that will be saved on import. */
export function imageOverlayMatrix(
  source: PlanImage,
  sourceTransform: PlanTransform,
  target: PlanImage,
  targetTransform: PlanTransform,
): [number, number, number, number, number, number] {
  const project = (point: PlanPoint): PlanPoint => {
    const world = imagePointToLevel(point, source, sourceTransform)
    const x = world[0] - targetTransform.position[0],
      z = world[1] - targetTransform.position[1]
    const c = Math.cos(targetTransform.rotation),
      s = Math.sin(targetTransform.rotation)
    return [
      (x * c - z * s) / targetTransform.metersPerPixel + target.width / 2,
      (x * s + z * c) / targetTransform.metersPerPixel + target.height / 2,
    ]
  }
  const origin = project([0, 0]),
    x = project([1, 0]),
    y = project([0, 1])
  return [
    x[0] - origin[0],
    x[1] - origin[1],
    y[0] - origin[0],
    y[1] - origin[1],
    origin[0],
    origin[1],
  ]
}

/** Transfer a measured scale and align two ordered endpoints, without distorting either image. */
export function alignPlanReferences(args: {
  floorplan: PlanImage
  sitemap: PlanImage
  metersPerPixel: number
  floorplanEdge: PlanSegment
  sitemapEdge: PlanSegment
}) {
  const { floorplan, sitemap, metersPerPixel, floorplanEdge: a, sitemapEdge: b } = args
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0)
    throw Error('Calibrate a known length first.')
  for (const image of [floorplan, sitemap]) {
    if (![image.width, image.height].every((n) => Number.isFinite(n) && n > 0))
      throw Error('Invalid image dimensions.')
  }
  for (const [edge, image] of [
    [a, floorplan],
    [b, sitemap],
  ] as const) {
    if (
      edge.some(
        (p) =>
          !p.every(Number.isFinite) ||
          p[0] < 0 ||
          p[1] < 0 ||
          p[0] > image.width ||
          p[1] > image.height,
      ) ||
      segmentLength(edge) < 1
    )
      throw Error('Select two distinct points inside each image.')
  }
  const realLength = segmentLength(a) * metersPerPixel
  const map: PlanTransform = {
    metersPerPixel: realLength / segmentLength(b),
    rotation: 0,
    position: [0, 0],
  }
  const rotation =
    Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]) -
    Math.atan2(b[1][1] - b[0][1], b[1][0] - b[0][0])
  const plan: PlanTransform = { metersPerPixel, rotation, position: [0, 0] }
  const from = imagePointToLevel(a[0], floorplan, plan),
    to = imagePointToLevel(b[0], sitemap, map)
  plan.position = [to[0] - from[0], to[1] - from[1]]
  return { floorplan: plan, sitemap: map, realLength }
}

export type ReferenceView = {
  image: ReferenceImage
  transform: PlanTransform
  opacity: number
  role: 'floorplan' | 'sitemap'
}

export function levelPointToImage(
  point: PlanPoint,
  image: PlanImage,
  transform: PlanTransform,
): PlanPoint {
  const x = point[0] - transform.position[0],
    z = point[1] - transform.position[1]
  const c = Math.cos(transform.rotation),
    s = Math.sin(transform.rotation)
  return [
    (x * c - z * s) / transform.metersPerPixel + image.width / 2,
    (x * s + z * c) / transform.metersPerPixel + image.height / 2,
  ]
}

/** The pivot stays in level coordinates while scale or rotation changes. */
export function transformAboutAnchor(
  image: PlanImage,
  transform: PlanTransform,
  anchor: PlanPoint,
  changes: { metersPerPixel?: number; rotation?: number },
): PlanTransform {
  const next = { ...transform, ...changes }
  if (
    !Number.isFinite(next.metersPerPixel) ||
    next.metersPerPixel <= 0 ||
    !Number.isFinite(next.rotation)
  )
    throw Error('Use a positive scale and a finite angle.')
  const before = imagePointToLevel(anchor, image, transform),
    after = imagePointToLevel(anchor, image, next)
  return {
    ...next,
    position: [next.position[0] + before[0] - after[0], next.position[1] + before[1] - after[1]],
  }
}

export function guideReference(guide: GuideNode): ReferenceView {
  const ref = guide.metadata.planReference as Record<string, unknown> | undefined
  if (
    !ref ||
    typeof ref.width !== 'number' ||
    typeof ref.height !== 'number' ||
    !Number.isFinite(ref.width) ||
    !Number.isFinite(ref.height) ||
    !(ref.width > 0 && ref.height > 0)
  )
    throw Error('This reference has no image dimensions.')
  if (!Number.isFinite(guide.scale) || guide.scale <= 0)
    throw Error('Set a positive reference scale.')
  return {
    image: {
      id: String(ref.assetId ?? guide.id),
      name: guide.name ?? 'Plan',
      url: guide.url,
      width: ref.width,
      height: ref.height,
      sourceUrl: typeof ref.sourceUrl === 'string' ? ref.sourceUrl : undefined,
      sharedFrame: typeof ref.sharedFrame === 'string' ? ref.sharedFrame : undefined,
    },
    transform: {
      metersPerPixel: (guide.scale * 10) / ref.width,
      position: [guide.position[0], guide.position[2]],
      rotation: guide.rotation[1],
    },
    opacity: guide.opacity,
    role: ref.role === 'sitemap' ? 'sitemap' : 'floorplan',
  }
}
