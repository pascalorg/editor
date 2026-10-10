import { z } from 'zod'
import { refuse } from '../agent-tools/refusal'
import type { AnyNode, GuideNode, WallNode } from '../schema'
import type { BalconyOptions } from './balcony'
import { type OutlinePrimitiveKind, outlineBatchPrimitiveNodes } from './reference-primitives'

const point = z.tuple([z.number().finite(), z.number().finite()])
export const ReferenceContour = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  points: z.array(point).min(2).max(1024),
  holes: z.array(z.array(point).min(3).max(1024)).max(32).optional(),
  stroke: z.boolean().optional(),
  /** A dashed stroke: drawn overhead or hidden (cupboards above, a garage door's travel). */
  dashed: z.boolean().optional(),
})
export type ReferenceContour = z.infer<typeof ReferenceContour>

/** The plan reference named, or a refusal every surface answers the same. */
export function requireGuide(nodes: Record<string, AnyNode>, id: string): GuideNode {
  const guide = nodes[id]
  if (guide?.type !== 'guide')
    refuse('reference_not_found', `Reference not found: ${id}.`, { guideId: id })
  return guide
}

/** The floor a plan goes on, or a refusal naming the one asked for. */
export function requirePlanLevel(
  nodes: Record<string, AnyNode>,
  level: string | null | undefined,
  asked?: string,
): string {
  if (level && nodes[level]?.type === 'level') return level
  return refuse(
    'level_not_found',
    asked ? `Level not found: ${asked}.` : 'There is no level to put the plan on.',
    asked ? { levelId: asked } : {},
  )
}

export class ReferenceCalibrationRequired extends Error {
  constructor(readonly guideIds: string[]) {
    super(
      'Human calibration required: select two points on the plan and enter a known length, then apply the reference in the editor.',
    )
  }
}

export function referenceContours(guide: GuideNode): ReferenceContour[] {
  return z.array(ReferenceContour).min(1).max(512).parse(guide.metadata.referenceContours)
}

/** Both MCP and the editor commit this complete plan in one transaction. */
export function planReferenceConstruction({
  nodes,
  guideIds,
  kind,
  shapeIds,
  thickness,
  height,
  balcony,
}: {
  nodes: Record<string, AnyNode>
  guideIds: string[]
  kind: OutlinePrimitiveKind
  shapeIds?: string[]
  thickness?: number
  height?: number
  balcony?: BalconyOptions
}): AnyNode[] {
  if (!guideIds.length || guideIds.length > 32 || new Set(guideIds).size !== guideIds.length)
    refuse('references_required', 'Choose 1–32 different references.', { guideIds })
  if (shapeIds && (!shapeIds.length || new Set(shapeIds).size !== shapeIds.length))
    refuse(
      'contours_repeated',
      'Choose different contour IDs, or omit the selection to use all contours.',
    )
  const guides = guideIds.map((id) => {
    return requireGuide(nodes, id)
  })
  const pending = guides.filter((g) => !g.scaleReference).map((g) => g.id)
  if (pending.length) throw new ReferenceCalibrationRequired(pending)
  const created: AnyNode[] = []
  for (const guide of guides) {
    const level = nodes[guide.parentId ?? '']
    if (level?.type !== 'level')
      refuse('reference_without_floor', 'Every reference must belong to a floor.', {
        guideId: guide.id,
      })
    const contours = referenceContours(guide)
    if (shapeIds?.some((id) => !contours.some((c) => c.id === id)))
      refuse('contour_not_found', `A selected contour is missing from ${guide.name ?? guide.id}.`, {
        guideId: guide.id,
      })
    const context = { ...nodes, ...Object.fromEntries(created.map((n) => [n.id, n])) }
    const existing = Object.values(context)
    const targetType = kind === 'walls' ? 'wall' : kind === 'balcony' ? 'slab' : kind
    const shapes = contours.filter(
      (c) =>
        (!shapeIds || shapeIds.includes(c.id)) &&
        (kind === 'walls' ||
          !existing.some((n) => {
            const origin = n.metadata.referenceOutline as
              | { guideId?: string; outlineId?: string }
              | undefined
            return (
              n.type === targetType &&
              origin?.guideId === guide.id &&
              origin.outlineId === c.id &&
              (targetType !== 'slab' || (kind === 'balcony') === !!n.metadata.balcony)
            )
          })),
    )
    if (!shapes.length) continue
    created.push(
      ...outlineBatchPrimitiveNodes({
        guide,
        level,
        shapes,
        kind,
        thickness,
        height,
        balcony,
        name: guide.name ?? 'Reference',
        contextNodes: context,
        existingWalls: existing.filter(
          (n): n is WallNode => n.type === 'wall' && n.parentId === level.id,
        ),
      }),
    )
    if (created.length > 10000)
      refuse('too_many_nodes', 'Build fewer floors in one operation.', { nodes: created.length })
  }
  return created
}

/** Only a declared identical image frame can inherit an existing measured transform. */
export function planReferenceFrameAlignment(
  nodes: Record<string, AnyNode>,
  anchorGuideId: string,
  targetGuideIds: string[],
): GuideNode[] {
  const anchor = nodes[anchorGuideId]
  if (anchor?.type !== 'guide')
    refuse('anchor_required', `Choose a reference as the anchor: ${anchorGuideId} is not one.`, {
      anchorGuideId,
    })
  if (!anchor.scaleReference) throw new ReferenceCalibrationRequired([anchor.id])
  const ref = anchor.metadata.planReference as Record<string, unknown> | undefined
  const anchorLevel = nodes[anchor.parentId ?? '']
  if (!ref?.sharedFrame || anchorLevel?.type !== 'level')
    refuse(
      'no_shared_frame',
      'The calibrated reference must declare a shared image frame and belong to a floor.',
      { anchorGuideId },
    )
  if (
    !targetGuideIds.length ||
    targetGuideIds.length > 32 ||
    new Set(targetGuideIds).size !== targetGuideIds.length
  )
    refuse('targets_required', 'Choose 1–32 different target references.', { targetGuideIds })
  return targetGuideIds
    .filter((id) => id !== anchorGuideId)
    .map((id) => {
      const guide = requireGuide(nodes, id)
      const target = guide.metadata.planReference as Record<string, unknown> | undefined
      const level = nodes[guide.parentId ?? '']
      if (
        target?.sharedFrame !== ref.sharedFrame ||
        target?.width !== ref.width ||
        target?.height !== ref.height ||
        level?.type !== 'level' ||
        level.parentId !== anchorLevel.parentId
      )
        refuse(
          'frames_differ',
          'Only references in the same building with identical declared frames can be aligned together.',
          { guideId: guide.id },
        )
      return {
        ...guide,
        scale: anchor.scale,
        position: [anchor.position[0], guide.position[1], anchor.position[2]],
        rotation: [...anchor.rotation],
        scaleReference: structuredClone(anchor.scaleReference),
        metadata: {
          ...guide.metadata,
          planReference: {
            ...target,
            method: 'shared-frame',
            anchorGuideId,
            metersPerPixel: (anchor.scale * 10) / Number(ref.width),
            inheritedCalibration: {
              scaleReference: anchor.scaleReference,
              knownDimension: ref.knownDimension,
            },
          },
        },
      }
    })
}
