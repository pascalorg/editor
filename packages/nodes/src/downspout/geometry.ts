import type { DownspoutNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { OutletDims } from '../gutter/profile-geometry'
import {
  computeDownspoutPath,
  type DownspoutPath,
  type DownspoutRouting,
  downspoutPipeDims,
  effectiveWallJog,
} from './routing'

/**
 * Downspout pipe builder. The pipe follows a real downspout's path —
 * a short DROP out of the collar, an OFFSET ELBOW back to the wall, the
 * VERTICAL RUN down the wall, and a bottom KICKOUT — plus the hardware
 * that makes it read real: WALL STRAPS clamping the run to the wall,
 * an open (hollow) mouth at the kickout, and a SPLASH BLOCK on the
 * ground under the mouth.
 *
 * Mesh frame is centred on the outlet: local Y = 0 is the gutter floor,
 * −Y is down, −Z is toward the wall (+Z is outward over the eave). The
 * path lives in the local Y/Z plane; X is the gutter-length axis.
 *
 * Cross-section follows the host gutter's profile: round on half-round,
 * rectangular on k-style / box. Straight legs are solid cylinders /
 * boxes welded at the corners with a small joint; the kickout leg is a
 * hollow tube so the open mouth reads through.
 *
 * Pure: no React, no scene access.
 */
const RADIAL_SEGMENTS = 16
const JOINT_SEGMENTS = 12
const FWD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)

// Pipe wall thickness for the hollow (open-mouth) kickout leg.
const PIPE_WALL = 0.004
// Wall straps — a thin band clamps the run to the wall, set in a margin
// from each end (spacing comes from the node).
const STRAP_END_MARGIN = 0.3
const STRAP_THICKNESS = 0.022
const STRAP_OVERHANG = 0.014
// Splash block — a tilted slab on the ground under the mouth that
// carries water away from the foundation.
const SPLASH_WIDTH = 0.22
const SPLASH_LENGTH = 0.34
const SPLASH_THICKNESS = 0.05
const SPLASH_TILT = 0.1

export function buildDownspoutGeometry(
  node: DownspoutNode,
  routing?: DownspoutRouting | null,
): THREE.BufferGeometry {
  const dims = downspoutPipeDims(node, routing)
  const terminal = node.terminal ?? 'splash'
  // 'straight' runs the pipe to grade with no kickout leg.
  const pathData = computeDownspoutPath(
    node.length,
    effectiveWallJog(node, routing),
    terminal !== 'straight',
  )

  // Drop consecutive duplicates (jog == 0 collapses the elbow; no kick
  // collapses the bottom two) so we never build a zero-length segment.
  const path: THREE.Vector3[] = []
  for (const [x, y, z] of pathData.points) {
    const p = new THREE.Vector3(x, y, z)
    const last = path.at(-1)
    if (!last || last.distanceTo(p) > 1e-4) path.push(p)
  }

  const pieces: THREE.BufferGeometry[] = []
  const lastLeg = path.length - 2
  for (let i = 0; i < path.length - 1; i++) {
    // The final leg (the kickout mouth) is a hollow tube so you can see
    // up the open end; the rest stay solid (their outer surface reads
    // identically, and they're capped by the collar / joints anyway).
    pieces.push(
      i === lastLeg
        ? ringTube(path[i]!, path[i + 1]!, dims)
        : segmentBetween(path[i]!, path[i + 1]!, dims),
    )
    if (i > 0) pieces.push(jointAt(path[i]!, path[i - 1]!, path[i + 1]!, dims))
  }

  if ((node.strapStyle ?? 'band') !== 'none') {
    for (const strap of buildStraps(pathData, dims, node.strapSpacing ?? 1.8)) pieces.push(strap)
  }
  if (terminal === 'splash') {
    const splash = buildSplash(pathData)
    if (splash) pieces.push(splash)
  }

  const merged = pieces.length === 1 ? pieces[0]! : (mergeGeometries(pieces, false) ?? pieces[0]!)
  if (merged !== pieces[0]) {
    for (const p of pieces) p.dispose()
  }
  merged.computeVertexNormals()
  return merged
}

/**
 * Solid segment spanning two points. Round → a cylinder; rect → a box
 * (2·halfX wide along the gutter length, 2·halfZ deep outward). The
 * orient-onto-direction rotation is purely about X for our planar path,
 * so the box's width stays aligned with the gutter length axis.
 */
function segmentBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  dims: OutletDims,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const geo =
    dims.shape === 'round'
      ? new THREE.CylinderGeometry(dims.halfX, dims.halfX, len, RADIAL_SEGMENTS).toNonIndexed()
      : new THREE.BoxGeometry(2 * dims.halfX, len, 2 * dims.halfZ).toNonIndexed()
  // The primitive runs along +Y centred at origin; rotate +Y onto the
  // segment direction, then drop it on the midpoint.
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return geo
}

/**
 * Hollow tube spanning two points — a ring (round) / rectangular-ring
 * cross-section extruded along the leg, so both ends are open and the
 * bore reads through. Used for the kickout mouth.
 */
function ringTube(a: THREE.Vector3, b: THREE.Vector3, dims: OutletDims): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const shape = new THREE.Shape()
  const hole = new THREE.Path()
  if (dims.shape === 'round') {
    shape.absarc(0, 0, dims.halfX, 0, Math.PI * 2, false)
    hole.absarc(0, 0, Math.max(0.002, dims.halfX - PIPE_WALL), 0, Math.PI * 2, true)
  } else {
    const ox = dims.halfX
    const oz = dims.halfZ
    const ix = Math.max(0.002, ox - PIPE_WALL)
    const iz = Math.max(0.002, oz - PIPE_WALL)
    shape.moveTo(-ox, -oz)
    shape.lineTo(ox, -oz)
    shape.lineTo(ox, oz)
    shape.lineTo(-ox, oz)
    shape.closePath()
    hole.moveTo(-ix, -iz)
    hole.lineTo(-ix, iz)
    hole.lineTo(ix, iz)
    hole.lineTo(ix, -iz)
    hole.closePath()
  }
  shape.holes.push(hole)
  // ExtrudeGeometry runs the shape (in XY) along +Z from 0 to depth;
  // orient +Z onto the leg direction, then move the z=0 end to `a`.
  // ExtrudeGeometry is already non-indexed, matching the merge set.
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: len,
    bevelEnabled: false,
    steps: 1,
    curveSegments: RADIAL_SEGMENTS,
  })
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(FWD, dir.normalize()))
  geo.translate(a.x, a.y, a.z)
  return geo
}

/**
 * Corner joint at `p` between the segments (prev→p) and (p→next). Round
 * → a sphere; rect → a box aligned to the bend bisector so it bridges
 * the wedge the two box ends leave open at the outer corner.
 */
function jointAt(
  p: THREE.Vector3,
  prev: THREE.Vector3,
  next: THREE.Vector3,
  dims: OutletDims,
): THREE.BufferGeometry {
  if (dims.shape === 'round') {
    const geo = new THREE.SphereGeometry(dims.halfX, JOINT_SEGMENTS, JOINT_SEGMENTS).toNonIndexed()
    geo.translate(p.x, p.y, p.z)
    return geo
  }
  const dirIn = new THREE.Vector3().subVectors(p, prev).normalize()
  const dirOut = new THREE.Vector3().subVectors(next, p).normalize()
  const bis = new THREE.Vector3().addVectors(dirIn, dirOut)
  if (bis.lengthSq() < 1e-8) bis.copy(dirOut) // straight-through; degenerate
  bis.normalize()
  const geo = new THREE.BoxGeometry(2 * dims.halfX, 2 * dims.halfZ, 2 * dims.halfZ).toNonIndexed()
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, bis))
  geo.translate(p.x, p.y, p.z)
  return geo
}

/**
 * Thin bands clamping the wall run to the wall, ~`STRAP_SPACING` apart
 * and set in from each end. Each is a flat box a touch proud of the
 * pipe so it reads as a strap wrapping the run.
 */
function buildStraps(
  path: DownspoutPath,
  dims: OutletDims,
  spacing: number,
): THREE.BufferGeometry[] {
  const top = path.wallRunTopY
  const bottom = path.wallRunBottomY
  const z = path.wallRunZ
  const runLen = top - bottom
  if (runLen < STRAP_END_MARGIN * 2 + 0.05) return []

  const usable = runLen - STRAP_END_MARGIN * 2
  const count = Math.max(1, Math.floor(usable / Math.max(0.2, spacing)) + 1)
  const stride = count > 1 ? usable / (count - 1) : 0
  const w = 2 * dims.halfX + 2 * STRAP_OVERHANG
  const d = 2 * dims.halfZ + 2 * STRAP_OVERHANG

  const straps: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const y = count > 1 ? top - STRAP_END_MARGIN - i * stride : (top + bottom) / 2
    const band = new THREE.BoxGeometry(w, STRAP_THICKNESS, d).toNonIndexed()
    band.translate(0, y, z)
    straps.push(band)
  }
  return straps
}

/**
 * Tilted slab on the ground under the mouth, extending outward (+Z,
 * away from the wall) so it carries water off from the foundation.
 */
function buildSplash(path: DownspoutPath): THREE.BufferGeometry | null {
  const [bx, by, bz] = path.bottom
  const slab = new THREE.BoxGeometry(SPLASH_WIDTH, SPLASH_THICKNESS, SPLASH_LENGTH).toNonIndexed()
  // Tilt the far (+Z) end down so it slopes away from the wall.
  slab.rotateX(SPLASH_TILT)
  slab.translate(bx, by - SPLASH_THICKNESS / 2, bz + SPLASH_LENGTH / 2)
  return slab
}
