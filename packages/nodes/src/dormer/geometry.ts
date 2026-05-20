import type { DormerNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Dormer geometry — **stub port**. Produces a house silhouette:
 * a rectangular box (width × depth × height) topped by a triangular
 * gable extruded along the dormer's depth. The window opening, the
 * roof trim against the parent segment, and the gable cutout where
 * the dormer meets the host roof are all deferred — the archive
 * relied on `getDormerExposedFaces` + `generateDormerGeometry` from
 * the legacy `roof-system` for those, neither of which exists in
 * `packages/nodes`.
 *
 * What this gives us:
 *   - dormer exists in the registry / palette / inspector / undo.
 *   - placement / move / paint / delete all work via the framework.
 *   - schema's full set of fields round-trips correctly.
 *
 * Follow-up commits add the window opening + frame, the gable trim
 * (CSG against parent segment), and the per-surface material split
 * already wired in `getEffectiveDormerSurfaceMaterial`.
 */
export type DormerGeometry = {
  body: THREE.BufferGeometry
  roof: THREE.BufferGeometry
}

export function buildDormerGeometry(node: DormerNode): DormerGeometry {
  const w = node.width
  const d = node.depth
  const h = Math.max(0.05, node.height)
  const rh = Math.max(0.05, node.roofHeight)

  // Body — vertical box from the dormer's local 0 up to the wall top.
  const body = new THREE.BoxGeometry(w, h, d)
  body.translate(0, h / 2, 0)

  // Roof — extruded triangle (gable only in the stub; other roofType
  // variants will land as case-by-case geometry in follow-up).
  const roofShape = new THREE.Shape()
  roofShape.moveTo(-w / 2, 0)
  roofShape.lineTo(w / 2, 0)
  roofShape.lineTo(0, rh)
  roofShape.lineTo(-w / 2, 0)
  const roof = new THREE.ExtrudeGeometry(roofShape, {
    depth: d,
    bevelEnabled: false,
  })
  roof.translate(0, h, -d / 2)

  return { body, roof }
}

/**
 * Helper for the inspector: which window-* fields the inspector should
 * surface. Centralised here so the parametric descriptor can keep its
 * `visibleIf` predicates short and so future per-shape rules (e.g.
 * radius mode for rounded only) live alongside the geometry.
 */
export function dormerSupportsArch(node: DormerNode): boolean {
  return node.windowShape === 'arch'
}

export function dormerSupportsCornerRadii(node: DormerNode): boolean {
  return node.windowShape === 'rounded'
}
