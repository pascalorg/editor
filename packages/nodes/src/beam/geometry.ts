import { type BeamNode, beamPlan } from '@pascal-app/core'
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { applyPlanarWorldUvs, copyUvToSecondaryChannel } from '../shared/primitive-uv'

/** The seam left between the plies of a built-up beam, so a (2) 2x10 reads as two boards. */
const PLY_SEAM = 0.0015

/**
 * Where a beam's box sits in its level, level-local: its centre, its turn about Y (local X runs
 * start → end) and its size along, up and across. Null for a beam of no length.
 */
export type BeamBox = {
  position: [number, number, number]
  rotationY: number
  size: [number, number, number]
}

export function beamBox(
  beam: Pick<BeamNode, 'start' | 'end' | 'width' | 'depth'>,
  top: number,
): BeamBox | null {
  const plan = beamPlan(beam)
  if (plan.length < 1e-6) return null
  return {
    position: [
      (plan.start[0] + plan.end[0]) / 2,
      top - beam.depth / 2,
      (plan.start[1] + plan.end[1]) / 2,
    ],
    // Three.js turns local +X to (cos θ, 0, −sin θ): θ = −atan2(dz, dx) runs it along the beam.
    rotationY: -Math.atan2(plan.direction[1], plan.direction[0]),
    size: [plan.length, beam.depth, beam.width],
  }
}

function box(length: number, height: number, across: number, y: number, z: number): BufferGeometry {
  const geometry = new BoxGeometry(length, height, across).toNonIndexed()
  geometry.translate(0, y, z)
  return geometry
}

/**
 * The beam's solid about its own centre, local X along it: one block for a solid timber, glulam
 * or a single LVL; its plies side by side with a hairline between for a built-up beam; a W shape's
 * two flanges and web for steel. UVs run a metre to the texture repeat, the grain along the beam.
 */
export function buildBeamGeometry(
  beam: Pick<BeamNode, 'width' | 'depth' | 'plies' | 'material'>,
  length: number,
): BufferGeometry {
  const { width, depth } = beam
  let parts: BufferGeometry[]
  if (beam.material === 'steel') {
    // A W8x10's flanges are 0.205 in, its web 0.17 in: the same proportions at any size.
    const flange = Math.max(0.004, depth * 0.026)
    const web = Math.max(0.003, width * 0.043)
    parts = [
      box(length, flange, width, depth / 2 - flange / 2, 0),
      box(length, flange, width, -depth / 2 + flange / 2, 0),
      box(length, depth - flange * 2, web, 0, 0),
    ]
  } else if (beam.plies > 1) {
    // The seams fall between the plies; the outer faces stay the beam's.
    const seam = Math.min(PLY_SEAM, width / beam.plies / 2)
    const ply = (width - seam * (beam.plies - 1)) / beam.plies
    parts = Array.from({ length: beam.plies }, (_, index) =>
      box(length, depth, ply, 0, -width / 2 + ply / 2 + index * (ply + seam)),
    )
  } else {
    parts = [box(length, depth, width, 0, 0)]
  }
  const merged = parts.length === 1 ? parts[0]! : (mergeGeometries(parts) ?? parts[0]!)
  if (merged !== parts[0]) for (const part of parts) part.dispose()
  applyPlanarWorldUvs(merged)
  copyUvToSecondaryChannel(merged)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}
