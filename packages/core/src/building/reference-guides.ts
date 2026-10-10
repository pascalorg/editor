import { type AnyNode, GuideNode, type LevelNode } from '../schema'
import type { PlanImage, PlanSegment, PlanTransform } from './reference-calibration'
import { imagePointToLevel } from './reference-transform'

export type ReferenceImage = PlanImage & {
  id: string
  name: string
  url: string
  sourceUrl?: string
  sharedFrame?: string
}
export type CalibratedReference = {
  image: ReferenceImage
  levelId: LevelNode['id']
  transform: PlanTransform
  segment: PlanSegment
  role: 'floorplan' | 'sitemap'
  calibration: Record<string, unknown>
}

/** Native guides own placement and serialization; reference metadata only records provenance. */
export function buildReferenceGuide(input: CalibratedReference, previous?: GuideNode): GuideNode {
  const { image, transform, segment } = input
  const start = imagePointToLevel(segment[0], image, transform)
  const end = imagePointToLevel(segment[1], image, transform)
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (
    !Number.isFinite(length) ||
    length <= 0 ||
    !Number.isFinite(transform.metersPerPixel) ||
    transform.metersPerPixel <= 0
  )
    throw Error('A valid measured scale is required.')
  const metadata = { ...previous?.metadata }
  if (
    (previous?.metadata.planReference as { assetId?: string } | undefined)?.assetId !== image.id ||
    previous?.url !== image.url
  )
    delete metadata.planVectors
  return GuideNode.parse({
    ...(previous ? { id: previous.id } : {}),
    name: image.name,
    parentId: input.levelId,
    url: image.url,
    position: [
      transform.position[0],
      input.role === 'sitemap' ? 0.015 : 0.025,
      transform.position[1],
    ],
    rotation: [0, transform.rotation, 0],
    scale: (image.width * transform.metersPerPixel) / 10,
    opacity: previous?.opacity ?? (input.role === 'sitemap' ? 35 : 65),
    visible: previous?.visible ?? true,
    scaleReference: {
      start,
      end,
      realLengthMeters: length,
      measuredLengthUnits: length,
      metersPerUnit: 1,
      label:
        (input.calibration.manualCorrection as { scaleFactor?: number } | undefined)
          ?.scaleFactor !== undefined &&
        Math.abs(
          Number((input.calibration.manualCorrection as { scaleFactor: number }).scaleFactor) - 1,
        ) > 0.000001
          ? 'Adjusted reference · original measurement retained'
          : 'Matched reference · verify against another dimension',
    },
    metadata: {
      ...metadata,
      planReference: {
        version: 1,
        assetId: image.id,
        role: input.role,
        width: image.width,
        height: image.height,
        sourceUrl: image.sourceUrl,
        sharedFrame: image.sharedFrame,
        ...input.calibration,
      },
    },
  })
}

/** Validate the complete batch before any scene mutation. */
export function prepareReferenceGuides(
  inputs: CalibratedReference[],
  nodes: Record<string, AnyNode>,
  options: { replaceSitemap?: boolean } = {},
) {
  const keys = new Set<string>()
  return inputs.map((input) => {
    const level = nodes[input.levelId]
    if (level?.type !== 'level' || level.metadata.placeholderSource)
      throw Error('Choose an editable floor for every reference.')
    const replaceSitemap = options.replaceSitemap && input.role === 'sitemap'
    const key = `${input.levelId}:${replaceSitemap ? 'sitemap' : input.image.id}`
    if (keys.has(key)) throw Error('A reference may only occur once per floor.')
    keys.add(key)
    const previous = Object.values(nodes).find(
      (n): n is GuideNode =>
        n.type === 'guide' &&
        n.parentId === input.levelId &&
        (replaceSitemap
          ? (n.metadata.planReference as { role?: string } | undefined)?.role === 'sitemap'
          : (n.metadata.planReference as { assetId?: string } | undefined)?.assetId ===
            input.image.id),
    )
    return { node: buildReferenceGuide(input, previous), exists: !!previous }
  })
}
