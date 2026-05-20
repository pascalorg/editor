import type { BoxVentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const LOUVER_COUNT = 4
const LOUVER_INSET = 0.012

/**
 * Pure builder for the box-vent mesh. Returns a merged BufferGeometry
 * containing body + louvers + hood. Materials and per-node transforms
 * (segment-local position, slope tilt, Y rotation) live in the renderer
 * — this function only owns the shape.
 *
 * Pure: no React, no scene access, no store mutation. Safe to call from
 * unit tests, the placement preview, and the move-tool ghost.
 */
export function buildBoxVentGeometry(node: BoxVentNode): THREE.BufferGeometry {
  const w = node.width
  const d = node.depth
  const h = node.height
  const overhang = node.hoodOverhang
  const style = node.style

  const bodyH = style === 'low-profile' ? h * 0.55 : h * 0.62
  const hoodH = h - bodyH

  const pieces: THREE.BufferGeometry[] = [
    buildBody(w, d, bodyH),
    buildLouvers(w, d, bodyH),
    style === 'dome'
      ? buildDomeHood(w, d, overhang, bodyH, hoodH)
      : buildPyramidHood(w, d, overhang, bodyH, hoodH),
  ]

  return pieces.length === 1 ? pieces[0]! : (mergeGeometries(pieces, false) ?? pieces[0]!)
}

// ─── Body ────────────────────────────────────────────────────────────

function buildBody(w: number, d: number, bodyH: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // +X side
  pushQuad(positions, normals, uvs,
    [hw, 0, -hd], [hw, 0, hd], [hw, bodyH, hd], [hw, bodyH, -hd],
    [1, 0, 0])
  // -X side
  pushQuad(positions, normals, uvs,
    [-hw, 0, hd], [-hw, 0, -hd], [-hw, bodyH, -hd], [-hw, bodyH, hd],
    [-1, 0, 0])
  // +Z side
  pushQuad(positions, normals, uvs,
    [hw, 0, hd], [-hw, 0, hd], [-hw, bodyH, hd], [hw, bodyH, hd],
    [0, 0, 1])
  // -Z side
  pushQuad(positions, normals, uvs,
    [-hw, 0, -hd], [hw, 0, -hd], [hw, bodyH, -hd], [-hw, bodyH, -hd],
    [0, 0, -1])
  // Bottom (closes the body so it reads as solid from below)
  pushQuad(positions, normals, uvs,
    [-hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd],
    [0, -1, 0])

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Louvers ─────────────────────────────────────────────────────────
// Horizontal slat ridges sunken into the four body faces. Suggest
// ventilation openings without modeling actual recesses.

function buildLouvers(w: number, d: number, bodyH: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const margin = bodyH * 0.18
  const usable = bodyH - margin * 2
  const slatH = usable / (LOUVER_COUNT * 2 - 1)
  const slatGap = slatH

  for (let i = 0; i < LOUVER_COUNT; i++) {
    const y0 = margin + i * (slatH + slatGap)
    const y1 = y0 + slatH

    // +X face louver
    const xIn = hw - LOUVER_INSET
    pushQuad(positions, normals, uvs,
      [xIn, y0, -hd * 0.85], [xIn, y0, hd * 0.85],
      [xIn, y1, hd * 0.85], [xIn, y1, -hd * 0.85],
      [1, 0, 0])
    // -X face louver
    pushQuad(positions, normals, uvs,
      [-xIn, y0, hd * 0.85], [-xIn, y0, -hd * 0.85],
      [-xIn, y1, -hd * 0.85], [-xIn, y1, hd * 0.85],
      [-1, 0, 0])
    // +Z face
    const zIn = hd - LOUVER_INSET
    pushQuad(positions, normals, uvs,
      [hw * 0.85, y0, zIn], [-hw * 0.85, y0, zIn],
      [-hw * 0.85, y1, zIn], [hw * 0.85, y1, zIn],
      [0, 0, 1])
    // -Z face
    pushQuad(positions, normals, uvs,
      [-hw * 0.85, y0, -zIn], [hw * 0.85, y0, -zIn],
      [hw * 0.85, y1, -zIn], [-hw * 0.85, y1, -zIn],
      [0, 0, -1])
  }

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Pyramid hood ────────────────────────────────────────────────────
// Flat-top truncated pyramid with overhang at the base. Bottom (where
// hood meets body) is at y=bodyH and width = w + 2*overhang. Top is at
// y=bodyH+hoodH and width = w*0.6 (tapered).

function buildPyramidHood(
  w: number,
  d: number,
  overhang: number,
  bodyH: number,
  hoodH: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const bw = w / 2 + overhang
  const bd = d / 2 + overhang
  const tw = w * 0.3
  const td = d * 0.3

  const y0 = bodyH
  const y1 = bodyH + hoodH

  // Underside skirt (visible from below where it overhangs the body)
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [-bw, y0, bd], [bw, y0, bd], [bw, y0, -bd],
    [0, -1, 0])

  // +X sloped face
  pushQuad(positions, normals, uvs,
    [bw, y0, -bd], [bw, y0, bd], [tw, y1, td], [tw, y1, -td],
    [bw - tw, hoodH, 0])
  // -X sloped face
  pushQuad(positions, normals, uvs,
    [-bw, y0, bd], [-bw, y0, -bd], [-tw, y1, -td], [-tw, y1, td],
    [-(bw - tw), hoodH, 0])
  // +Z sloped face
  pushQuad(positions, normals, uvs,
    [bw, y0, bd], [-bw, y0, bd], [-tw, y1, td], [tw, y1, td],
    [0, hoodH, bd - td])
  // -Z sloped face
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [bw, y0, -bd], [tw, y1, -td], [-tw, y1, -td],
    [0, hoodH, -(bd - td)])

  // Flat top
  pushQuad(positions, normals, uvs,
    [-tw, y1, -td], [-tw, y1, td], [tw, y1, td], [tw, y1, -td],
    [0, 1, 0])

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Dome hood ───────────────────────────────────────────────────────
// Half-ellipsoid cap (low-rise dome) with overhang skirt.

function buildDomeHood(
  w: number,
  d: number,
  overhang: number,
  bodyH: number,
  hoodH: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const bw = w / 2 + overhang
  const bd = d / 2 + overhang
  const y0 = bodyH

  // Skirt underside
  pushQuad(positions, normals, uvs,
    [-bw, y0, -bd], [-bw, y0, bd], [bw, y0, bd], [bw, y0, -bd],
    [0, -1, 0])

  // Sample a low-resolution sphere (5 lat × 12 lng) so the dome is
  // cheap to build per-edit but still reads as round at typical
  // camera distances.
  const lat = 5
  const lng = 12
  const points: THREE.Vector3[][] = []
  for (let i = 0; i <= lat; i++) {
    const row: THREE.Vector3[] = []
    const phi = (Math.PI / 2) * (i / lat)
    const r = Math.cos(phi)
    const y = y0 + hoodH * Math.sin(phi)
    for (let j = 0; j <= lng; j++) {
      const theta = (Math.PI * 2) * (j / lng)
      const x = bw * r * Math.cos(theta)
      const z = bd * r * Math.sin(theta)
      row.push(new THREE.Vector3(x, y, z))
    }
    points.push(row)
  }

  const ab = new THREE.Vector3()
  const ad = new THREE.Vector3()
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lng; j++) {
      const a = points[i]![j]!
      const b = points[i]![j + 1]!
      const c = points[i + 1]![j + 1]!
      const d2 = points[i + 1]![j]!
      ab.subVectors(b, a)
      ad.subVectors(d2, a)
      const n = new THREE.Vector3().crossVectors(ab, ad).normalize()
      pushQuad(positions, normals, uvs,
        [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z], [d2.x, d2.y, d2.z],
        [n.x, n.y, n.z])
    }
  }

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildBufferGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  d: number[],
  n: number[],
) {
  const nLen = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!) || 1
  const nx = n[0]! / nLen
  const ny = n[1]! / nLen
  const nz = n[2]! / nLen

  positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, 1, 0, 1, 1)
  positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, 1, 1, 0, 1)
}

/**
 * Slope tilt for a box-vent at segment-local Z position. The vent's
 * X axis stays parallel to the segment's ridge; the +Z (down-slope)
 * side dips, the -Z (up-slope) side lifts. Flat segments return 0.
 *
 * Pure: lifted out so the renderer / move tool / preview share one
 * source of truth.
 */
export function computeBoxVentSlopeTilt(
  segment: { roofType: string; roofHeight: number; depth: number } | undefined,
  localZ: number,
): number {
  if (!segment || segment.roofType === 'flat' || localZ === 0) return 0
  const slopeAngle = Math.atan2(segment.roofHeight, segment.depth / 2)
  return localZ > 0 ? slopeAngle : -slopeAngle
}
