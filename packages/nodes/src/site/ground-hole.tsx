'use client'

import {
  groundHoleOpenNode,
  groundHoleOpenNow,
  groundWindowMaskNode,
  type UndergroundEdge,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
} from 'three'
import {
  color,
  float,
  materialColor,
  mix,
  mx_fractal_noise_float,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec3,
} from 'three/tsl'
import { Vector2 } from 'three/webgpu'
import { GroundPit, setGroundPitEdge } from './ground-pit'
import { buildPitWalls, type PitWalls } from './ground-pit-geometry'
import { fractalNoise3 } from './hole-noise'
import { EDGE_LOOKS, type EdgeLook } from './underground-edge'

/**
 * The ground as the medium, seen from above: over a level below grade the ground stays solid and
 * a hole opens in it over the below-grade footprint, through which the level is seen clearly. The
 * hole's edge is a noise threshold, an eroded border: the distance from the footprint is compared
 * to a radius that wanders with a fractal perlin noise (broad waves with finer ones riding them),
 * so the cut is a living, eroded line rather than an offset outline. Along it the ground darkens
 * in a soft feather and a thin light line marks the cut itself.
 *
 * The footprint is a signed-distance field baked on the CPU into a small texture when the
 * footprints change (the polygons the grade ring is drawn from), so the ground's mask costs one
 * texture fetch and one noise lookup per fragment, whatever the building's outline. How far the
 * hole is open (0 to 1, eased, 0 in a capture) is the viewer's `groundHoleOpenNode`.
 */

/**
 * The shipped edge's base margin around the footprint (metres) and how far the noise moves the
 * edge in or out of it. The edge looks (`underground-edge.ts`) vary both, and the noise's scale
 * (cells per metre of its broadest octave, ~1.7 m waves at today's), through uniforms.
 */
export const HOLE_MARGIN = EDGE_LOOKS.noise.margin
export const HOLE_ERODE = EDGE_LOOKS.noise.erode
/**
 * Three octaves, each finer and weaker than the last (cell size 1.7 m, 0.8 m, 0.4 m). The sum is
 * divided by its largest value, so the noise stays within ±1 and the hole's guaranteed core
 * (margin less the full erosion) still holds; the fine octaves are weak enough that the edge
 * never folds over into islets.
 */
const NOISE_LACUNARITY = 2.1
const NOISE_DIMINISH = 0.4
const NOISE_NORMALISE = 1 / (1 + NOISE_DIMINISH + NOISE_DIMINISH ** 2)

/** How far the pit's floor reaches past the hole's cut, in metres (under the walls). */
const FLOOR_OVERLAP = 0.08

const GRID = 192
/** The signed distance the texture stores: metres, negative inside, clamped to this range. */
const RANGE_MIN = -6
const RANGE_MAX = 10
/** Texture margin past the footprint's box: where the hole can reach, and some. */
const PAD = HOLE_MARGIN + HOLE_ERODE + 3

let look: EdgeLook = EDGE_LOOKS.noise
const holeMargin = uniform(look.margin)
const holeErode = uniform(look.erode)
const holeScale = uniform(look.scale)
const featherWidth = uniform(look.featherWidth)
const featherStrength = uniform(look.featherStrength)
const lineWidth = uniform(look.lineWidth)
const lineColor = uniform(new Color(look.lineColor))

/**
 * Sets the hole's edge look: the shader's margin, erosion, noise scale, feather and line (all
 * uniforms, nothing recompiles), and the CPU's twin of them. The pit's walls are cut again by
 * `GroundHole` after this.
 */
export function setGroundHoleEdge(edge: UndergroundEdge): void {
  look = EDGE_LOOKS[edge]
  holeMargin.value = look.margin
  holeErode.value = look.erode
  holeScale.value = look.scale
  featherWidth.value = look.featherWidth
  featherStrength.value = look.featherStrength
  lineWidth.value = look.lineWidth
  lineColor.value.set(look.lineColor)
  setGroundPitEdge(look)
}

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

/** The baked field's box in the world's plan, `null` while no footprint is baked. */
export function groundHoleBox(): { originX: number; originZ: number; span: number } | null {
  return hasField ? { originX, originZ, span } : null
}

/**
 * The hole's radius at a world XZ at full opening, as the shader's noise gives it: what the pit's
 * walls are laid along (`hole-noise.ts` is that noise on the CPU).
 */
export function holeRadiusAt(x: number, z: number): number {
  if (look.erode === 0) return look.margin
  return (
    look.margin +
    look.erode *
      fractalNoise3(x * look.scale, z * look.scale, 0.31, 3, NOISE_LACUNARITY, NOISE_DIMINISH)
  )
}

/** The fractal's own bound (three octaves of perlin within ±1): the radius stays within this of its margin. */
const NOISE_BOUND = 1 + NOISE_DIMINISH + NOISE_DIMINISH ** 2

/**
 * The CPU twin of the hole for one pick: whether `(x, z)` is surely in the hole now. The edge's
 * noise is not replayed here, so this is the part of the hole that is open whatever the noise
 * does (margin less the full erosion): a click there falls through to the floor under it, and a
 * click in the wandering fringe still lands on the ground.
 */
export function groundHoleContains(x: number, z: number): boolean {
  const open = groundHoleOpenNow()
  if (open <= 0.001) return false
  return groundHoleDistanceAt(x, z) < (look.margin - look.erode) * open - 0.05
}

// ── The shader pieces ────────────────────────────────────────────────────────────────────────

let pieces: { inHole: any; floorInHole: any; feather: any; line: any } | null = null

function holePieces() {
  if (pieces) return pieces
  const open = groundHoleOpenNode()
  const uv = positionWorld.xz.sub(gridOrigin).div(gridSpan)
  const distance = texture(fieldTexture, uv)
    .r.mul(RANGE_MAX - RANGE_MIN)
    .add(RANGE_MIN)
  // One fractal lookup: the radius of the hole wanders around its margin.
  const noise = mx_fractal_noise_float(
    vec3(positionWorld.xz.mul(holeScale), 0.31),
    3,
    NOISE_LACUNARITY,
    NOISE_DIMINISH,
    NOISE_NORMALISE,
  )
  const radius = noise.mul(holeErode).add(holeMargin).mul(open)
  const inHole = distance.lessThan(radius).and(open.greaterThan(0.001))
  const opening = smoothstep(float(0), float(0.1), open)
  const beyond = (width: unknown) =>
    float(1)
      .sub(smoothstep(radius, radius.add(width as never), distance))
      .mul(opening)
  // The pit's floor reaches a little past the cut, under the walls, so no hairline shows between.
  const floorInHole = distance.lessThan(radius.add(FLOOR_OVERLAP)).and(open.greaterThan(0.001))
  pieces = { inHole, floorInHole, feather: beyond(featherWidth), line: beyond(lineWidth) }
  return pieces
}

/**
 * The mask the solid ground draws with: the ground window's, and not in the hole (the hole's
 * edge being the noise threshold). Everywhere with the window and the hole closed.
 */
export function solidGroundMaskNode() {
  return groundWindowMaskNode().and(holePieces().inHole.not())
}

/** Whether a fragment is in the hole, a hand's width over: what the pit's floor is drawn in. */
export function groundHoleFloorNode() {
  return holePieces().floorInHole
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

/**
 * The ground's colour with a soft shade (`shadeColor`) feathered along the hole's cut and a thin
 * light line on the cut itself; the plain colour with the hole closed.
 */
export function groundHoleColorNode(shadeColor: string) {
  const { feather, line } = holePieces()
  const shaded = mix(materialColor as any, color(shadeColor), feather.mul(featherStrength))
  return mix(shaded, lineColor, line)
}

/**
 * Feeds the hole the footprints it is cut over (the polygons the grade ring runs along: the level
 * shown and the ones between it and grade), and says to the rest of the viewer whether the scene
 * has a level below grade at all (`present`): the ground materials carry the hole's mask, and the
 * eye's fill light is mounted, from then on, once, so that changing floors only changes uniforms.
 *
 * It also stands the pit in the hole (`ground-pit.tsx`): walls cut along the hole's own contour
 * from the ground (`topAt`, at `topY` flat) down to `floorY`, the floor of the level shown, in the
 * `topsoil` colour at their top; its dark floor is drawn at `drawnFloorY` (`groundPitFloorY`).
 */
export function GroundHole({
  footprints,
  present,
  floorY,
  drawnFloorY,
  topY,
  topAt,
  topsoil,
}: {
  footprints: ReadonlyArray<ReadonlyArray<Point>>
  present: boolean
  floorY: number | null
  drawnFloorY: number | null
  topY: number
  topAt: (x: number, z: number) => number
  topsoil: string
}) {
  const edge = useViewer((state) => state.undergroundLook.edge)
  const [pit, setPit] = useState<{
    walls: PitWalls | null
    box: { originX: number; originZ: number; span: number } | null
  } | null>(null)
  useEffect(() => {
    setGroundHoleEdge(edge)
    setGroundHoleFootprints(footprints)
    const box = groundHoleBox()
    setPit(
      box
        ? {
            walls: buildPitWalls({
              ...box,
              distanceAt: groundHoleDistanceAt,
              radiusAt: holeRadiusAt,
              topAt,
              radiusMin: look.margin - look.erode * NOISE_BOUND,
              radiusMax: look.margin + look.erode * NOISE_BOUND,
            }),
            box,
          }
        : null,
    )
  }, [footprints, topAt, edge])
  useEffect(() => {
    if (useViewer.getState().hasLevelBelowGrade !== present)
      useViewer.setState({ hasLevelBelowGrade: present })
  }, [present])
  useEffect(
    () => () => {
      setGroundHoleFootprints([])
      if (useViewer.getState().hasLevelBelowGrade) useViewer.setState({ hasLevelBelowGrade: false })
    },
    [],
  )
  return present ? (
    <GroundPit
      box={pit?.box ?? null}
      drawnFloorY={drawnFloorY}
      floorY={floorY}
      inHole={groundHoleFloorNode()}
      topsoil={topsoil}
      topY={topY}
      walls={pit?.walls ?? null}
    />
  ) : null
}
