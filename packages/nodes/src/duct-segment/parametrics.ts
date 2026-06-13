import { type DuctFittingNode, type ParametricDescriptor, useScene } from '@pascal-app/core'
import { Vector3 } from 'three'
import { getDuctFittingPorts } from '../duct-fitting/ports'
import { rollToContinueAcrossElbow } from './geometry'
import type { DuctSegmentNode } from './schema'

/** A run endpoint sitting this close to a collar counts as mated. */
const MATE_TOL_M = 0.03

function dist2(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * Cross-section roll that keeps this run continuous through a fitting
 * mated at either endpoint — the same continuity the draw tool computes
 * for freshly drawn risers (`rollToContinueAcrossElbow`), recovered here
 * for runs whose shape is flipped to rect AFTER they were drawn. Without
 * it a riser falls back to the world-axis orientation and its profile
 * lands 90° off the elbow it rises from. Returns null when no fitting is
 * mated (roll 0 — the natural horizontal orientation — is correct).
 */
function rollFromMatedFitting(duct: DuctSegmentNode): number | null {
  if (duct.path.length < 2) return null
  const first = duct.path[0]!
  const last = duct.path[duct.path.length - 1]!
  const ends = [
    { point: first, away: duct.path[1]! },
    { point: last, away: duct.path[duct.path.length - 2]! },
  ]
  const tol2 = MATE_TOL_M * MATE_TOL_M
  for (const node of Object.values(useScene.getState().nodes)) {
    if (node.type !== 'duct-fitting') continue
    const fitting = node as DuctFittingNode
    if (fitting.fittingType === 'reducer') continue
    const ports = getDuctFittingPorts(fitting)
    for (const end of ends) {
      const mated = ports.find((p) => dist2(end.point, p.position) <= tol2)
      if (!mated) continue
      // The leg on the far side of the junction is the source the
      // profile must stay continuous with: an elbow's other run leg, or
      // the tee's run when this duct is the branch.
      const source = ports.find((p) => p.id !== mated.id && p.id !== 'branch')
      if (!source) continue
      const srcDuct = Object.values(useScene.getState().nodes).find(
        (n) =>
          n.type === 'duct-segment' &&
          n.id !== duct.id &&
          ((n as DuctSegmentNode).path.length >= 2
            ? dist2((n as DuctSegmentNode).path[0]!, source.position) <= tol2 ||
              dist2(
                (n as DuctSegmentNode).path[(n as DuctSegmentNode).path.length - 1]!,
                source.position,
              ) <= tol2
            : false),
      ) as DuctSegmentNode | undefined
      const newDir = new Vector3(
        end.away[0] - end.point[0],
        end.away[1] - end.point[1],
        end.away[2] - end.point[2],
      )
      if (newDir.lengthSq() < 1e-10) continue
      newDir.normalize()
      // Only steep runs are ambiguous (world-axis fallback); a
      // horizontal run's roll-0 orientation is already canonical, and
      // re-deriving it from a possibly-stale riser roll would corrupt it.
      if (Math.abs(newDir.y) < Math.SQRT1_2) continue
      const srcRoll = srcDuct && srcDuct.shape !== 'round' ? srcDuct.roll : 0
      const srcDir = new Vector3(...source.direction)
      return rollToContinueAcrossElbow(srcDir, srcRoll, srcDir, newDir)
    }
  }
  return null
}

export const ductSegmentParametrics: ParametricDescriptor<DuctSegmentNode> = {
  // Flipping a drawn run to rect / oval recovers the cross-section roll
  // the draw tool would have computed — risers re-orient to stay
  // continuous through the elbow they turn off instead of snapping to
  // the world-axis fallback. Spiral is a round-only construction, so a
  // non-round run can never hold it: leaving round (or picking spiral on
  // a rect / oval run) falls back to plain sheet metal.
  derive: (next, patch) => {
    const out: Partial<DuctSegmentNode> = {}
    if (next.ductMaterial === 'spiral' && next.shape !== 'round') {
      out.ductMaterial = 'sheet-metal'
    }
    if ('shape' in patch && next.shape !== 'round') {
      const roll = rollFromMatedFitting(next)
      if (roll !== null) out.roll = roll
    }
    return out
  },
  groups: [
    {
      label: 'Air',
      fields: [
        {
          key: 'system',
          kind: 'enum',
          options: ['supply', 'return'],
          display: 'segmented',
        },
        {
          key: 'shape',
          kind: 'enum',
          options: ['round', 'rect', 'oval'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          visibleIf: (n) => n.shape === 'round',
        },
        {
          key: 'width',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 60,
          step: 1,
          visibleIf: (n) => n.shape !== 'round',
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'in',
          min: 3,
          max: 40,
          step: 1,
          visibleIf: (n) => n.shape !== 'round',
        },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'ductMaterial',
          kind: 'enum',
          options: ['sheet-metal', 'spiral', 'flex', 'duct-board'],
        },
        {
          key: 'seamDetail',
          kind: 'boolean',
          // Only meaningful where a body detail exists: round spiral
          // (lock seam) and round flex (wire corrugation).
          visibleIf: (n) =>
            n.shape === 'round' && (n.ductMaterial === 'spiral' || n.ductMaterial === 'flex'),
        },
        {
          key: 'insulated',
          kind: 'boolean',
        },
        {
          key: 'insulationR',
          kind: 'number',
          min: 0,
          max: 8,
          step: 0.5,
          visibleIf: (n) => n.insulated,
        },
      ],
    },
  ],
}
