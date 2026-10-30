import {
  type DoorNode,
  OPENING_CASING_PROUD,
  type OpeningCasingHost,
  openingCasingBoards,
  openingCasingFaces,
  openingCasingWidth,
  openingHostFacing,
  type WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'
import { buildOpeningCutoutShape, getRoundedOpeningRadii } from './opening-cutout-geometry'

/** Name of the meshes a door or window builds its casing from. */
export const OPENING_CASING_MESH_NAME = 'opening-casing'

/**
 * A door's or window's casing as meshes in the unit's own frame, to hang on the
 * mesh its frame is built on: the boards of `openingCasingBoards` on each cased
 * face of the host, turned half round with a unit that faces the host's back. A
 * rectangular opening is cased with butted boards. An arched or rounded one is
 * cased with a band that follows the cutout's own profile over its head and down
 * its sides; a window's bottom board stays straight below it.
 */
export function buildOpeningCasingMeshes(
  opening: DoorNode | WindowNode,
  host: OpeningCasingHost,
  material: THREE.Material,
): THREE.Mesh[] {
  const facing = openingHostFacing(opening)
  const shaped = opening.openingShape === 'arch' || opening.openingShape === 'rounded'
  const meshes: THREE.Mesh[] = []
  const add = (geometry: THREE.BufferGeometry, face: 'a' | 'b') => {
    // Turned half round, the unit's x and z run against the host's.
    if (facing < 0) geometry.rotateY(Math.PI)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = OPENING_CASING_MESH_NAME
    mesh.userData.slotId = `casing-${face}`
    meshes.push(mesh)
  }

  for (const board of openingCasingBoards(opening, host)) {
    if (shaped && (board.part === 'head' || board.part === 'leg')) continue
    const [width, height, depth] = board.size
    const geometry = new THREE.BoxGeometry(width, height, depth)
    applyWorldScaleBoxUVs(geometry, width, height, depth)
    geometry.translate(...board.center)
    add(geometry, board.face)
  }

  if (shaped) {
    const band = casingBandShape(opening, openingCasingWidth(opening))
    for (const { face, plane, out } of openingCasingFaces(opening, host)) {
      const geometry = new THREE.ExtrudeGeometry(band, {
        depth: OPENING_CASING_PROUD,
        bevelEnabled: false,
        curveSegments: 24,
      })
      geometry.translate(0, 0, out > 0 ? plane : plane - OPENING_CASING_PROUD)
      add(geometry, face)
    }
  }

  return meshes
}

/**
 * The casing band of an arched or rounded opening as one outline, in the host
 * frame: out from the cutout's profile by `width` over the head and down both
 * sides, open along the bottom (a door's floor, a window's bottom board).
 */
function casingBandShape(opening: DoorNode | WindowNode, width: number): THREE.Shape {
  const halfWidth = opening.width / 2
  const halfHeight = opening.height / 2
  const inner = buildOpeningCutoutShape(opening, {
    left: -halfWidth,
    right: halfWidth,
    bottom: -halfHeight,
    top: halfHeight,
  }).getPoints(24)
  const outer = buildOpeningCutoutShape(grownOpening(opening, width), {
    left: -halfWidth - width,
    right: halfWidth + width,
    bottom: -halfHeight,
    top: halfHeight + width,
  }).getPoints(24)
  // Both profiles start along the bottom, left to right, and end back at their
  // first point: the band runs up and over the outer one from its bottom right,
  // then back over the inner one from its bottom left.
  return new THREE.Shape([...outer.slice(1), ...inner.slice(1).reverse()])
}

/**
 * The opening a casing band's outer edge follows: its arch or its top corners
 * grown by `width`, so the band keeps one width all round, and square at the
 * bottom, where the band stops.
 */
function grownOpening<T extends DoorNode | WindowNode>(opening: T, width: number): T {
  if (opening.openingShape === 'arch') {
    const archHeight = Math.min(
      Math.max(opening.archHeight ?? opening.width / 2, 0.01),
      opening.height,
    )
    return { ...opening, archHeight: archHeight + width }
  }
  const radii = getRoundedOpeningRadii(opening, opening.width, opening.height)
  const grow = (radius: number) => (radius > 1e-6 ? radius + width : 0)
  return opening.type === 'window'
    ? {
        ...opening,
        openingRadiusMode: 'individual',
        openingCornerRadii: [grow(radii.topLeft), grow(radii.topRight), 0, 0],
      }
    : {
        ...opening,
        openingRadiusMode: 'individual',
        openingTopRadii: [grow(radii.topLeft), grow(radii.topRight)],
      }
}
