import type { GuideNode } from '../schema'
import { markedPlanSvg } from './plan-marks'
import { referenceContours } from './reference-construction'

type Pt = [number, number]

/**
 * An imported plan's preview (L69): redrawn from the shapes and texts the import read, with nothing
 * marked, as the marked plan is. Drawn from what was read, never from the source, so an agent's SVG
 * is never handed to a renderer (the security review of L69, 2026-10-06), and every lane draws the
 * same picture. Null for a plan with nothing read to draw.
 */
export function planPreviewSvg(guide: GuideNode): string | null {
  const size = guide.metadata.planReference as { width?: unknown; height?: unknown } | undefined
  const width = typeof size?.width === 'number' ? size.width : 0
  const height = typeof size?.height === 'number' ? size.height : 0
  let contours: ReturnType<typeof referenceContours>
  try {
    contours = referenceContours(guide)
  } catch {
    return null
  }
  if (!(width > 0 && height > 0)) return null
  const labels = (
    (guide.metadata.referenceLabels ?? []) as { text: unknown; at: unknown }[]
  ).filter(
    (label): label is { text: string; at: Pt } =>
      typeof label.text === 'string' && Array.isArray(label.at),
  )
  return markedPlanSvg({
    width,
    height,
    contours: contours.map((contour) => ({
      points: contour.points as Pt[],
      stroke: contour.stroke,
    })),
    labels,
    marks: [],
  })
}
