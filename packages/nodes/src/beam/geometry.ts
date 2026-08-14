import type { GeometryContext } from '@pascal-app/core/registry'
import { BoxGeometry, Group, Mesh } from 'three'
import { beamMaterial } from './material'
import type { BeamNode } from './schema'

/**
 * The beam's concrete body — the element the user drew.
 *
 * The shutter is not drawn here: the formwork assemblies the beam hosts build
 * their own shutters (walls and slabs do the same), so this is only the box of
 * concrete the shutter surrounds. Built in level coordinates — the centreline
 * runs start→end in X/Z as given, and the body stands from `elevation` (the
 * soffit) up to `elevation + depth`.
 */
export function buildBeamBody(node: BeamNode, _ctx: GeometryContext): Group {
  const group = new Group()
  const startX = node.start[0]
  const startZ = node.start[1]
  const endX = node.end[0]
  const endZ = node.end[1]
  const length = Math.hypot(endX - startX, endZ - startZ)
  if (length <= 0) return group

  const material = beamMaterial()
  const body = new Mesh(new BoxGeometry(length, node.depth, node.width), material)
  body.name = 'beam-body'
  body.position.set((startX + endX) / 2, node.elevation + node.depth / 2, (startZ + endZ) / 2)
  // Rotate the box to the centreline's heading. Three.js rotation.y turns +X
  // toward +Z? No — rotation.y rotates +X toward −Z; the complement keeps the
  // body aligned with start→end.
  const heading = Math.atan2(endZ - startZ, endX - startX)
  body.rotation.y = -heading
  group.add(body)
  return group
}
