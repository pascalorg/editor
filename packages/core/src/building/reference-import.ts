import { GuideNode } from '../schema'
import { type RasterPlan, rasterWallLines } from './plan-raster-walls'
import type { ReferenceContour } from './reference-construction'
import { readSvgPlan, type SvgContour, type SvgLabel, type SvgPlan } from './reference-svg'

/** What a plan file holds: its pixel size, and for an SVG the contours it draws. */
export type PlanSource = { width: number; height: number; mimeType: string; svg: SvgPlan | null }

const UNSUPPORTED = 'Choose an SVG, PNG, JPEG or WebP plan.'

function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i++
      continue
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!]
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      i += 2
      continue
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!)
  }
  return null
}

function webpSize(b: Uint8Array): [number, number] | null {
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  if (chunk === 'VP8X')
    return [
      1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
      1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
    ]
  if (chunk === 'VP8 ')
    return [(b[26]! | (b[27]! << 8)) & 0x3fff, (b[28]! | (b[29]! << 8)) & 0x3fff]
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
  }
  return null
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) =>
  bytes.every((value, k) => b[at + k] === value)

/** Read a plan file's size (and SVG geometry) from its bytes: the same answer in a browser and on
 * a server, with no image decoder. */
export function readPlanSource(bytes: Uint8Array, mediaType?: string): PlanSource {
  let size: [number, number] | null = null
  let mimeType = ''
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.length >= 24) size = [view.getUint32(16), view.getUint32(20)]
    mimeType = 'image/png'
  } else if (startsWith(bytes, [0xff, 0xd8])) {
    size = jpegSize(bytes)
    mimeType = 'image/jpeg'
  } else if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    size = bytes.length >= 30 ? webpSize(bytes) : null
    mimeType = 'image/webp'
  } else {
    const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
    if (mediaType === 'image/svg+xml' || head.startsWith('<')) {
      const svg = readSvgPlan(new TextDecoder().decode(bytes))
      return { width: svg.width, height: svg.height, mimeType: 'image/svg+xml', svg }
    }
    throw Error(UNSUPPORTED)
  }
  if (!(size && size[0] > 0 && size[1] > 0))
    throw Error(`This ${mimeType} plan has no readable size.`)
  return { width: size[0], height: size[1], mimeType, svg: null }
}

/**
 * A raster plan's walls as an SVG plan's lines: centrelines with their stroke width, in the plan's
 * pixels. Traced from the pixels the host decoded, at whatever size it decoded them.
 */
function tracedWalls(raster: RasterPlan, source: PlanSource): SvgContour[] {
  const [sx, sy] = [source.width / raster.width, source.height / raster.height]
  return rasterWallLines(raster).segments.map(({ a, b, thickness }, index) => ({
    id: `s${index}`,
    points: [
      [a[0] * sx, a[1] * sy],
      [b[0] * sx, b[1] * sy],
    ],
    stroke: true,
    strokeWidth: thickness * (a[1] === b[1] ? sy : sx),
  }))
}

/**
 * The shapes a plan guide carries for the tools that read it (the plan survey, the reference
 * elements, furnish_from_plan): its contours and texts, in the pixels its `planReference` declares.
 * Every import writes them here, import_plan_reference and the editor's upload and trace alike, so
 * a plan reads the same wherever it came in. The frame is the importer's: the editor sizes a plan
 * as the browser decodes it, which is not an SVG's own size when it is given in mm or by its
 * viewBox alone.
 */
export function planReferenceShapes(
  plan: string | SvgPlan,
  frame: { width: number; height: number },
): { referenceContours?: SvgContour[]; referenceLabels?: SvgLabel[] } {
  const { width, height, contours, labels } = typeof plan === 'string' ? readSvgPlan(plan) : plan
  const [sx, sy] = [frame.width / width, frame.height / height]
  const at = ([x, y]: [number, number]): [number, number] => [x * sx, y * sy]
  return {
    ...(contours.length
      ? {
          referenceContours: contours.map((contour) => ({
            ...contour,
            points: contour.points.map(at),
            ...(contour.holes ? { holes: contour.holes.map((hole) => hole.map(at)) } : {}),
            ...(contour.strokeWidth
              ? { strokeWidth: contour.strokeWidth * Math.sqrt(sx * sy) }
              : {}),
          })),
        }
      : {}),
    ...(labels.length
      ? { referenceLabels: labels.map((label) => ({ ...label, at: at(label.at) })) }
      : {}),
  }
}

/**
 * A plan placed on a floor as a guide, uncalibrated: scale 1 spans the image across 10 m until a
 * person calibrates it (or `align_reference_frames` passes on a calibration). Its SVG contours
 * ride along, so `planReferenceConstruction` can build from it; a raster's traced walls do too,
 * when the host decoded its pixels (`raster`).
 */
export function planReferenceGuide({
  levelId,
  name,
  url,
  source,
  sharedFrame,
  raster,
}: {
  levelId: string
  name?: string
  url: string
  source: PlanSource
  sharedFrame?: string
  raster?: RasterPlan
}): GuideNode {
  const traced = !source.svg && raster ? tracedWalls(raster, source) : null
  const shapes = planReferenceShapes(
    source.svg ?? {
      width: source.width,
      height: source.height,
      contours: traced ?? [],
      labels: [],
    },
    source,
  )
  return GuideNode.parse({
    name: name ?? 'Plan',
    url,
    parentId: levelId,
    scale: 1,
    opacity: 50,
    scaleReference: null,
    metadata: {
      planReference: {
        version: 1,
        role: 'floorplan',
        width: source.width,
        height: source.height,
        mimeType: source.mimeType,
        ...(sharedFrame ? { sharedFrame } : {}),
        ...(traced ? { traced: 'walls' } : {}),
      },
      ...shapes,
    },
  })
}

/** A manual correction of a placed plan: move in metres, turn about its centre, scale by a factor. */
export function planReferenceAdjust(
  guide: GuideNode,
  {
    dx = 0,
    dz = 0,
    rotateDegrees = 0,
    scaleFactor = 1,
  }: { dx?: number; dz?: number; rotateDegrees?: number; scaleFactor?: number },
): Pick<GuideNode, 'position' | 'rotation' | 'scale'> {
  if (!(Number.isFinite(scaleFactor) && scaleFactor > 0))
    throw Error('Use a positive, finite scale factor.')
  if (![dx, dz, rotateDegrees].every(Number.isFinite)) throw Error('Use finite offsets and angles.')
  return {
    position: [guide.position[0] + dx, guide.position[1], guide.position[2] + dz],
    rotation: [
      guide.rotation[0],
      guide.rotation[1] + (rotateDegrees * Math.PI) / 180,
      guide.rotation[2],
    ],
    scale: guide.scale * scaleFactor,
  }
}

/** What an agent needs to pick contours without reading their geometry: the biggest first. */
export function summarizePlanContours(contours: readonly ReferenceContour[], limit = 40) {
  return contours
    .map((contour) => {
      const xs = contour.points.map((p) => p[0])
      const ys = contour.points.map((p) => p[1])
      const px = (value: number) => Math.round(value * 100) / 100
      return {
        id: contour.id,
        kind: contour.stroke ? ('line' as const) : ('area' as const),
        xPx: px(Math.min(...xs)),
        yPx: px(Math.min(...ys)),
        widthPx: px(Math.max(...xs) - Math.min(...xs)),
        heightPx: px(Math.max(...ys) - Math.min(...ys)),
        ...((contour as SvgContour).strokeWidth
          ? { strokeWidthPx: Math.round((contour as SvgContour).strokeWidth! * 100) / 100 }
          : {}),
        ...(contour.name ? { name: contour.name } : {}),
      }
    })
    .sort((a, b) => Math.max(b.widthPx, b.heightPx) - Math.max(a.widthPx, a.heightPx))
    .slice(0, limit)
}

/**
 * What importing a plan reports, alike on every surface: its pixel size, the contours it carries to
 * build from (an SVG's, or a raster's traced walls), and why a raster carries none.
 */
export function planImportSummary(guide: GuideNode, { vectorizer = false } = {}) {
  const ref = guide.metadata.planReference as {
    width: number
    height: number
    mimeType: string
    traced?: 'walls'
  }
  const contours = (guide.metadata.referenceContours ?? []) as SvgContour[]
  const lineGroups = groupPlanLines(contours)
  return {
    guideId: guide.id,
    width: ref.width,
    height: ref.height,
    contours: contours.length,
    largestContours: summarizePlanContours(contours),
    lineGroups,
    ...(lineGroups.some((group) => !group.ids)
      ? {
          lineGroupsNote:
            'A group of more than 60 lines leaves out its ids: build it whole with create_reference_elements strokeWidthsPx.',
        }
      : {}),
    ...(ref.traced ? { traced: ref.traced } : {}),
    ...(contours.length
      ? {
          furnishing:
            'Once the plan is calibrated and its rooms are built, furnish_from_plan numbers the furniture, fixtures and cars it draws and places them from the catalog.',
        }
      : {}),
    ...(vectorizer && ref.mimeType !== 'image/svg+xml'
      ? {
          vectorize:
            'A raster plan gives its walls at most: vectorize_plan reads its furniture, fixtures, cars, door swings and labels as an SVG (paid: see its description).',
        }
      : {}),
    ...(ref.mimeType !== 'image/svg+xml' && !ref.traced
      ? {
          note: 'Pascal cannot decode this raster plan here: it is placed to read from, with no wall lines to build.',
        }
      : {}),
  }
}

/** Lines grouped by drawn width, thickest first: plans draw walls with the heaviest stroke, so one
 * group is usually every wall. Small groups list their ids. */
export function groupPlanLines(contours: readonly SvgContour[], { idLimit = 60 } = {}) {
  const groups = new Map<number, string[]>()
  for (const contour of contours) {
    if (!contour.stroke) continue
    const width = Math.round((contour.strokeWidth ?? 1) * 100) / 100
    groups.set(width, [...(groups.get(width) ?? []), contour.id])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([strokeWidthPx, ids]) => ({
      strokeWidthPx,
      count: ids.length,
      ...(ids.length <= idLimit ? { ids } : {}),
    }))
}
