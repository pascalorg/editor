'use client'

import {
  groundHoleOpenNode,
  groundHoleOpenNow,
  groundWindowMaskNode,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect } from 'react'
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three'
import {
  color,
  float,
  materialColor,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec3,
} from 'three/tsl'
import { Vector2 } from 'three/webgpu'

/**
 * The ground as the medium, seen from above: over a level below grade the ground stays solid and
 * a hole opens in it over the below-grade footprint, through which the level is seen clearly. The
 * hole's edge is a noise threshold, an eroded border: the distance from the footprint is compared
 * to a radius that wanders with a perlin noise, so the cut is a scalloped, living line rather
 * than an offset outline, with a thin slate rim along it.
 *
 * The footprint is a signed-distance field baked on the CPU into a small texture when the
 * footprints change (the polygons the grade ring is drawn from), so the ground's mask costs one
 * texture fetch and one noise lookup per fragment, whatever the building's outline. How far the
 * hole is open (0 to 1, eased, 0 in a capture) is the viewer's `groundHoleOpenNode`.
 */

/** The hole's base margin around the footprint, in metres. */
export const HOLE_MARGIN = 1.6
/** How far the noise moves the edge in or out of the margin, in metres. */
export const HOLE_ERODE = 0.9
/** Noise cells per metre on the ground. */
const NOISE_SCALE = 0.6
/** The slate rim on the ground side of the cut, in metres. */
const RIM_WIDTH = 0.22

const GRID = 192
/** The signed distance the texture stores: metres, negative inside, clamped to this range. */
const RANGE_MIN = -6
const RANGE_MAX = 10
/** Texture margin past the footprint's box: where the hole can reach, and some. */
const PAD = HOLE_MARGIN + HOLE_ERODE + 3

type Point = readonly [number, number]

const field = new Uint8Array(GRID * GRID).fill(255)
const fieldTexture = new DataTexture(field, GRID, GRID, RedFormat, UnsignedByteType)
fieldTexture.minFilter = LinearFilter
fieldTexture.magFilter = LinearFilter
fieldTexture.wrapS = ClampToEdgeWrapping
fieldTexture.wrapT = ClampToEdgeWrapping
fieldTexture.generateMipmaps = false
fieldTexture.needsUpdate = true

const gridOrigin = uniform(new Vector2(0, 0))
const gridSpan = uniform(1)
let originX = 0
let originZ = 0
let span = 1
let hasField = false

function encode(distance: number): number {
  const t = (distance - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)
  return Math.round(Math.min(1, Math.max(0, t)) * 255)
}

function decode(value: number): number {
  return RANGE_MIN + (value / 255) * (RANGE_MAX - RANGE_MIN)
}

function insidePolygons(polygons: ReadonlyArray<ReadonlyArray<Point>>, x: number, z: number) {
  let inside = false
  for (const polygon of polygons) {
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a, a += 1) {
      const [ax, az] = polygon[a]!
      const [bx, bz] = polygon[b]!
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
    }
  }
  return inside
}

/**
 * Bakes the signed distance to `polygons` (the below-grade footprints, world plan) into the
 * hole's texture. No polygons: the field is far everywhere, so the ground has no hole.
 */
export function setGroundHoleFootprints(polygons: ReadonlyArray<ReadonlyArray<Point>>): void {
  const points = polygons.flat()
  if (points.length === 0) {
    if (hasField) {
      field.fill(255)
      fieldTexture.needsUpdate = true
      hasField = false
    }
    return
  }
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  span = Math.max(maxX - minX, maxZ - minZ) + 2 * PAD
  originX = (minX + maxX) / 2 - span / 2
  originZ = (minZ + maxZ) / 2 - span / 2
  gridOrigin.value.set(originX, originZ)
  gridSpan.value = span
  const edges: number[] = []
  for (const polygon of polygons)
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a, a += 1)
      edges.push(polygon[b]![0], polygon[b]![1], polygon[a]![0], polygon[a]![1])
  const cell = span / GRID
  for (let row = 0; row < GRID; row += 1) {
    const z = originZ + (row + 0.5) * cell
    for (let col = 0; col < GRID; col += 1) {
      const x = originX + (col + 0.5) * cell
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < edges.length; i += 4) {
        const ax = edges[i]!
        const az = edges[i + 1]!
        const dx = edges[i + 2]! - ax
        const dz = edges[i + 3]! - az
        const length2 = dx * dx + dz * dz
        let t = length2 > 0 ? ((x - ax) * dx + (z - az) * dz) / length2 : 0
        t = Math.min(1, Math.max(0, t))
        const ex = x - (ax + dx * t)
        const ez = z - (az + dz * t)
        const d2 = ex * ex + ez * ez
        if (d2 < best) best = d2
      }
      const distance = Math.sqrt(best)
      field[row * GRID + col] = encode(insidePolygons(polygons, x, z) ? -distance : distance)
    }
  }
  fieldTexture.needsUpdate = true
  hasField = true
}

/** The baked signed distance to the footprints at a world XZ (bilinear, as the shader reads it). */
export function groundHoleDistanceAt(x: number, z: number): number {
  if (!hasField) return RANGE_MAX
  const u = Math.min(GRID - 1, Math.max(0, ((x - originX) / span) * GRID - 0.5))
  const v = Math.min(GRID - 1, Math.max(0, ((z - originZ) / span) * GRID - 0.5))
  const c0 = Math.floor(u)
  const r0 = Math.floor(v)
  const c1 = Math.min(GRID - 1, c0 + 1)
  const r1 = Math.min(GRID - 1, r0 + 1)
  const tu = u - c0
  const tv = v - r0
  const at = (r: number, c: number) => decode(field[r * GRID + c]!)
  const top = at(r0, c0) * (1 - tu) + at(r0, c1) * tu
  const bottom = at(r1, c0) * (1 - tu) + at(r1, c1) * tu
  return top * (1 - tv) + bottom * tv
}

/**
 * The CPU twin of the hole for one pick: whether `(x, z)` is surely in the hole now. The edge's
 * noise is not replayed here, so this is the part of the hole that is open whatever the noise
 * does (margin less the full erosion): a click there falls through to the floor under it, and a
 * click in the wandering fringe still lands on the ground.
 */
export function groundHoleContains(x: number, z: number): boolean {
  const open = groundHoleOpenNow()
  if (open <= 0.001) return false
  return groundHoleDistanceAt(x, z) < (HOLE_MARGIN - HOLE_ERODE) * open - 0.05
}

// ── The shader pieces ────────────────────────────────────────────────────────────────────────

let pieces: { inHole: any; rim: any } | null = null

function holePieces() {
  if (pieces) return pieces
  const open = groundHoleOpenNode()
  const uv = positionWorld.xz.sub(gridOrigin).div(gridSpan)
  const distance = texture(fieldTexture, uv)
    .r.mul(RANGE_MAX - RANGE_MIN)
    .add(RANGE_MIN)
  // One noise lookup: the radius of the hole wanders around its margin.
  const noise = mx_noise_float(vec3(positionWorld.xz.mul(NOISE_SCALE), 0.31))
  const radius = noise.mul(HOLE_ERODE).add(HOLE_MARGIN).mul(open)
  const inHole = distance.lessThan(radius).and(open.greaterThan(0.001))
  const rim = float(1)
    .sub(smoothstep(radius, radius.add(RIM_WIDTH), distance))
    .mul(smoothstep(float(0), float(0.1), open))
  pieces = { inHole, rim }
  return pieces
}

/**
 * The mask the solid ground draws with: the ground window's, and not in the hole (the hole's
 * edge being the noise threshold). Everywhere with the window and the hole closed.
 */
export function solidGroundMaskNode() {
  return groundWindowMaskNode().and(holePieces().inHole.not())
}

/**
 * How the solid ground receives shadows while the hole is open: not at all. The storeys that are
 * hidden above the level shown still cast their shadows (so the rooms stay shaded), and on the
 * ground that would read as ghosts of a building that is not there.
 */
export function groundHoleShadowNode(): () => any {
  const open = smoothstep(float(0), float(0.1), groundHoleOpenNode())
  // three calls it with the shadow node (the typing says no argument).
  return ((shadow: any) => mix(shadow, float(1), open)) as unknown as () => any
}

/** The ground's colour with a thin slate rim along the hole's cut; the plain colour with it closed. */
export function groundHoleColorNode(rimColor: string) {
  return mix(materialColor as any, color(rimColor), holePieces().rim)
}

/**
 * Feeds the hole the footprints it is cut over (the polygons the grade ring runs along), and says
 * to the rest of the viewer whether the scene has a level below grade at all: the ground materials
 * carry the hole's mask, and the eye's fill light is mounted, from then on, once, so that changing
 * floors only changes uniforms.
 */
export function GroundHole({ footprints }: { footprints: ReadonlyArray<ReadonlyArray<Point>> }) {
  useEffect(() => {
    setGroundHoleFootprints(footprints)
    const has = footprints.length > 0
    if (useViewer.getState().hasLevelBelowGrade !== has)
      useViewer.setState({ hasLevelBelowGrade: has })
  }, [footprints])
  useEffect(
    () => () => {
      setGroundHoleFootprints([])
      if (useViewer.getState().hasLevelBelowGrade) useViewer.setState({ hasLevelBelowGrade: false })
    },
    [],
  )
  return null
}
