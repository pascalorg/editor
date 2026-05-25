import { type ChimneyNode, getActiveRoofHeight, type RoofSegmentNode } from '@pascal-app/core'
import {
  Brush,
  csgEvaluator,
  csgGeometry,
  type getRoofSegmentBrushes,
  prepareBrushForCSG,
  SUBTRACTION,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { partitionTopFaceGroups } from './holes'

const visibleMat = new THREE.MeshBasicMaterial()

export type SegmentTrimBrushes = NonNullable<ReturnType<typeof getRoofSegmentBrushes>>

/**
 * CSG-trim the chimney body against the parent roof segment so the
 * portion of the chimney that passes through the wall and shingles
 * is hidden — gives the clean "chimney emerges from the roof" look
 * the archive shipped. Lives in the chimney folder (not the geometry
 * builder) because three-bvh-csg + three-mesh-bvh are viewer-only
 * deps; the renderer is the natural seam since it already imports
 * from `@pascal-app/viewer`.
 *
 * Segment brushes are passed in (built once per segment shape in the
 * renderer and reused across slider drags); the function does NOT
 * dispose them. CSG `evaluate` returns a new brush, so the input
 * brushes survive the call unmutated.
 *
 * Returns the input geometry untouched on any CSG failure so the
 * chimney still renders (just not trimmed).
 */
export function trimChimneyBodyAgainstRoof(
  body: THREE.BufferGeometry,
  segment: RoofSegmentNode,
  node: ChimneyNode,
  segBrushes: SegmentTrimBrushes,
): THREE.BufferGeometry {
  const { shinSlab, wallBrush } = segBrushes

  // Wrap the chimney body in a Brush. The body has `node.position` /
  // `node.rotation` baked into its vertices via `applyNodeTransform`
  // in `geometry.ts`, so it's already in segment-local space — the
  // same frame as the roof brushes from `getRoofSegmentBrushes`.
  const indexed = mergeVertices(body, 1e-4)
  if (!indexed.getAttribute('normal')) indexed.computeVertexNormals()
  const indexCount = indexed.getIndex()?.count ?? 0
  indexed.clearGroups()
  if (indexCount > 0) indexed.addGroup(0, indexCount, 0)
  ;(
    indexed as unknown as { computeBoundsTree?: (opts: { maxLeafSize: number }) => void }
  ).computeBoundsTree?.({ maxLeafSize: 10 })

  const chimneyBrush = new Brush(indexed, visibleMat as unknown as THREE.MeshStandardMaterial)
  chimneyBrush.updateMatrixWorld()
  prepareBrushForCSG(chimneyBrush)

  let result: THREE.BufferGeometry = body

  try {
    // Two-pass subtraction: trim the chimney shaft below the eave with
    // `wallBrush`, then trim the section above the wall but below the
    // shingles with `shinSlab`. Together these hide the chimney's body
    // wherever it passes through the roof shell, leaving only the
    // visible portion above the shingles.
    const step1 = csgEvaluator.evaluate(chimneyBrush, wallBrush, SUBTRACTION) as Brush
    prepareBrushForCSG(step1)
    const step2 = csgEvaluator.evaluate(step1, shinSlab, SUBTRACTION) as Brush

    const out = csgGeometry(step2).clone()
    const ic = out.getIndex()?.count ?? 0
    out.clearGroups()
    if (ic > 0) out.addGroup(0, ic, 0)
    out.computeVertexNormals()

    // Re-partition the top rim face into group 1 so the body mesh's
    // `[bodyMaterial, topMaterial]` array routes the rim to the top
    // material — the CSG step above wiped the partition we set inside
    // `holes.ts:carveChimneyHoles`. Same threshold as the carve step
    // (top rim is at `topY`, just below it for safety).
    const peakY = segment.wallHeight + getActiveRoofHeight(segment)
    const topY = peakY + node.heightAboveRidge
    partitionTopFaceGroups(out, topY - 0.05)

    body.dispose()
    step1.geometry.dispose()
    step2.geometry.dispose()
    indexed.dispose()

    result = out
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[chimney] roof-trim CSG failed:', e)
    indexed.dispose()
    result = body
  }

  return result
}
