import {
  getActiveRoofHeight,
  getSegmentSlopeFrame,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
  type SolarPanelNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'

const SOLAR_CELL_SIZE_M = 0.16

// Procedurally generated cell texture used by the default panel material.
// Drawn once into an offscreen canvas, wrapped, and tiled per cell by the
// stretched UVs assigned in `buildSolarPanelGeometry`.
export function createSolarPanelTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#dde3ec'
  ctx.fillRect(0, 0, size, size)

  const pad = size * 0.04
  const x = pad
  const y = pad
  const cellW = size - pad * 2
  const cellH = size - pad * 2
  const chamfer = cellW * 0.16

  ctx.beginPath()
  ctx.moveTo(x + chamfer, y)
  ctx.lineTo(x + cellW - chamfer, y)
  ctx.lineTo(x + cellW, y + chamfer)
  ctx.lineTo(x + cellW, y + cellH - chamfer)
  ctx.lineTo(x + cellW - chamfer, y + cellH)
  ctx.lineTo(x + chamfer, y + cellH)
  ctx.lineTo(x, y + cellH - chamfer)
  ctx.lineTo(x, y + chamfer)
  ctx.closePath()

  const grad = ctx.createLinearGradient(x, y, x + cellW, y + cellH)
  grad.addColorStop(0, '#0f1b3a')
  grad.addColorStop(1, '#162546')
  ctx.fillStyle = grad
  ctx.fill()

  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(120, 150, 200, 0.10)'
  ctx.lineWidth = 0.5
  const fingers = 16
  for (let f = 1; f < fingers; f++) {
    const fx = x + (cellW * f) / fingers
    ctx.beginPath()
    ctx.moveTo(fx, y)
    ctx.lineTo(fx, y + cellH)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(200, 210, 225, 0.35)'
  ctx.lineWidth = Math.max(1, cellH * 0.008)
  for (let b = 1; b <= 2; b++) {
    const by = y + (cellH * b) / 3
    ctx.beginPath()
    ctx.moveTo(x, by)
    ctx.lineTo(x + cellW, by)
    ctx.stroke()
  }
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

let _defaultPanelMaterial: THREE.Material | null = null
export function getDefaultPanelMaterial(): THREE.Material {
  if (_defaultPanelMaterial) return _defaultPanelMaterial
  const map = createSolarPanelTexture()
  // MeshStandardNodeMaterial: WebGPU-native — avoids the "writeMask not zero"
  // MRT error that fires when MeshStandardMaterial is used in the WebGPU pass.
  const mat = new MeshStandardNodeMaterial({
    color: new THREE.Color(map ? 0xffffff : 0x0c0c1f),
    roughness: 0.22,
    metalness: 0.35,
  })
  if (map) mat.map = map
  _defaultPanelMaterial = mat
  return _defaultPanelMaterial
}

/**
 * Pure builder for a solar panel array. Generates one merged
 * BufferGeometry containing every cell of the rows × columns grid,
 * with two render groups so the frame (group 0) and the glass
 * (group 1) can carry distinct materials.
 *
 * Pure: no React, no scene access, no store mutation. The renderer
 * places this geometry in segment-local space with the surface tilt
 * applied as an outer JSX rotation.
 */
export function buildSolarPanelGeometry(node: SolarPanelNode): THREE.BufferGeometry | null {
  const {
    rows,
    columns,
    panelWidth,
    panelHeight,
    gapX,
    gapY,
    frameThickness,
    frameDepth,
    standoffHeight,
  } = node

  const frameGeos: THREE.BufferGeometry[] = []
  const panelGeos: THREE.BufferGeometry[] = []

  const totalW = columns * panelWidth + (columns - 1) * gapX
  const totalH = rows * panelHeight + (rows - 1) * gapY
  const originX = -totalW / 2
  const originZ = -totalH / 2

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cx = originX + c * (panelWidth + gapX) + panelWidth / 2
      const cz = originZ + r * (panelHeight + gapY) + panelHeight / 2
      const y = standoffHeight + frameDepth / 2

      const glassW = panelWidth - 2 * frameThickness
      const glassH = panelHeight - 2 * frameThickness
      if (glassW > 0 && glassH > 0) {
        const glass = new THREE.BoxGeometry(glassW, frameDepth * 0.6, glassH)
        glass.translate(cx, y + frameDepth * 0.2, cz)
        // Stretch the cell UVs so a tiled cell texture reads correctly
        // regardless of the panel's aspect ratio.
        const cellsU = Math.max(1, Math.round(glassW / SOLAR_CELL_SIZE_M))
        const cellsV = Math.max(1, Math.round(glassH / SOLAR_CELL_SIZE_M))
        const uv = glass.getAttribute('uv') as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * cellsU, uv.getY(i) * cellsV)
        }
        uv.needsUpdate = true
        panelGeos.push(glass)
      }

      const ft = frameThickness
      const fd = frameDepth

      const left = new THREE.BoxGeometry(ft, fd, panelHeight)
      left.translate(cx - panelWidth / 2 + ft / 2, y, cz)
      frameGeos.push(left)

      const right = new THREE.BoxGeometry(ft, fd, panelHeight)
      right.translate(cx + panelWidth / 2 - ft / 2, y, cz)
      frameGeos.push(right)

      const top = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      top.translate(cx, y, cz - panelHeight / 2 + ft / 2)
      frameGeos.push(top)

      const bottom = new THREE.BoxGeometry(panelWidth - 2 * ft, fd, ft)
      bottom.translate(cx, y, cz + panelHeight / 2 - ft / 2)
      frameGeos.push(bottom)
    }
  }

  if (frameGeos.length === 0) return null

  const frameMerged = mergeGeometries(frameGeos, false)
  const panelMerged = panelGeos.length > 0 ? mergeGeometries(panelGeos, false) : null
  for (const g of frameGeos) g.dispose()
  for (const g of panelGeos) g.dispose()

  if (!frameMerged) return null

  if (panelMerged) {
    const combined = mergeGeometries([frameMerged, panelMerged], true)
    frameMerged.dispose()
    panelMerged.dispose()
    return combined
  }

  frameMerged.clearGroups()
  frameMerged.addGroup(0, frameMerged.index?.count ?? frameMerged.attributes.position!.count, 0)
  return frameMerged
}

// ─── Roof-surface helpers ────────────────────────────────────────────
// Used to drop the panel onto the slope when the schema's
// `surfaceNormal` is absent (legacy data or simplified placement).

export function getSurfaceY(lx: number, lz: number, seg: RoofSegmentNode): number {
  const { roofType, wallHeight, depth, width } = seg
  const rh = getActiveRoofHeight(seg)
  const peakY = wallHeight + rh
  if (rh === 0) return wallHeight

  if (roofType === 'gable') {
    const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - t * rh
  }
  if (roofType === 'shed') {
    const t = (lz + depth / 2) / (depth || 1)
    return peakY - t * rh
  }
  if (roofType === 'hip') {
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    return peakY - Math.max(fx, fz) * rh
  }
  const t = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
  return peakY - t * rh
}

// Outward normal for a roof surface tilting at angle θ in the horizontal
// direction (dx, dz). Derivation: the surface tangent vectors are the
// ridge axis (perpendicular to the fall line, horizontal) and the
// down-slope direction (cos θ horizontal + −sin θ vertical). Crossing
// them gives the outward normal ∝ (sin θ · dx, cos θ, sin θ · dz),
// equivalently (dx · tan θ, 1, dz · tan θ) un-normalised.
function buildSlopeNormal(dx: number, dz: number, tan: number): THREE.Vector3 {
  return new THREE.Vector3(dx * tan, 1, dz * tan).normalize()
}

export function getAnalyticalNormal(lx: number, lz: number, seg: RoofSegmentNode): THREE.Vector3 {
  const { roofType, depth, width } = seg
  const slope = getSegmentSlopeFrame(seg)
  if (slope.activeRh === 0 || slope.tanTheta === 0) {
    return new THREE.Vector3(0, 1, 0)
  }
  const primaryTan = slope.tanTheta
  const halfW = width / 2
  const halfD = depth / 2

  // Ridge runs along X — slope falls in ±Z. Gambrel shares the gable
  // dispatch (its kink-to-eave/lower tier is the primary slope frame).
  if (roofType === 'gable' || roofType === 'gambrel') {
    if (roofType === 'gambrel') {
      // Tier-aware: the upper (shallower) face spans |z| < mz; the
      // lower (steep) face spans mz < |z| ≤ halfD. Using primaryTan on
      // the upper tier would tilt the ghost too steeply near the ridge.
      const lowerWidthRatio =
        seg.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio
      const lowerHeightRatio =
        seg.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio
      const mz = halfD * lowerWidthRatio
      if (Math.abs(lz) <= mz) {
        const upperRise = slope.activeRh * (1 - lowerHeightRatio)
        const upperRun = mz
        const upperTan = upperRun > 0 ? upperRise / upperRun : 0
        return buildSlopeNormal(0, lz >= 0 ? 1 : -1, upperTan)
      }
    }
    return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
  }

  // Single slope falling toward +Z (ridge at -Z, eave at +Z).
  if (roofType === 'shed') {
    return buildSlopeNormal(0, 1, primaryTan)
  }

  // 4-sided slopes: the dominant axis chooses which face the point sits
  // on. Hip is uniform across all four faces. Mansard has a steep outer
  // band (primaryTan) and a shallow top inside the waist. Dutch has hip
  // ends and gable sides — both share the same primaryTan from the
  // slope frame, so directional dispatch is enough.
  if (roofType === 'hip') {
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    if (fz >= fx) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan)
  }

  if (roofType === 'mansard') {
    const widthRatio = seg.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio
    const heightRatio = seg.mansardSteepHeightRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio
    const inset = Math.min(width, depth) * widthRatio
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    const onZ = fz >= fx
    const inSteepBand = onZ ? Math.abs(lz) > halfD - inset : Math.abs(lx) > halfW - inset

    let tan = primaryTan
    if (!inSteepBand) {
      // Top hip (shallow) above the waist — rises from the waist
      // rectangle at fraction `heightRatio` of activeRh up to the peak.
      const topRise = slope.activeRh * (1 - heightRatio)
      const topRun = Math.max(0, Math.min(halfW, halfD) - inset)
      tan = topRun > 0 ? topRise / topRun : 0
    }
    if (onZ) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, tan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, tan)
  }

  if (roofType === 'dutch') {
    // Hip on the short-axis ends, gable on the long-axis sides. Both
    // share the primary pitch on their primary (eave-band) face, so the
    // approximation collapses to "pick the dominant axis."
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    if (fz >= fx) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan)
  }

  return new THREE.Vector3(0, 1, 0)
}

// ─── Quaternion helper ───────────────────────────────────────────────
// Given a normal in the panel's parent frame, build a rotation that
// aligns the panel's local +Y to that normal. Lifted out so the
// renderer and the placement preview share one source of truth.

export function surfaceQuatFromNormal(normal: THREE.Vector3, out: THREE.Quaternion) {
  // Build `right` by projecting world +X onto the surface plane instead of
  // using `up × normal`. The cross-product version flips sign when the
  // normal's Z component flips (e.g. the two slopes of a gable roof), so
  // the resulting basis has its +X axis reversed on one slope — which
  // makes hosted children's local +X point in opposite world directions
  // depending on which slope they sit on, and registry chevrons end up
  // anchored to the wrong edge. Projecting +X keeps the basis stable
  // across slope-flips that share the same X axis.
  const wx = new THREE.Vector3(1, 0, 0)
  const right = wx.sub(normal.clone().multiplyScalar(new THREE.Vector3(1, 0, 0).dot(normal)))
  if (right.lengthSq() < 1e-6) {
    // Degenerate: normal is parallel to ±X. Fall back to +Z so the basis
    // is still well-defined; this is the wall-like edge case (vertical
    // surface facing along X) where any in-plane convention is OK.
    right.set(0, 0, 1)
  } else {
    right.normalize()
  }
  const forward = new THREE.Vector3().crossVectors(right, normal).normalize()
  const m = new THREE.Matrix4().makeBasis(right, normal, forward)
  return out.setFromRotationMatrix(m)
}

// ─── Layout helpers (used by the inspector / placement tool) ─────────

function getSlopeDepthBounds(
  segment: RoofSegmentNode,
  panelLocalZ: number,
): { minZ: number; maxZ: number } {
  const halfD = segment.depth / 2
  switch (segment.roofType) {
    case 'gable':
    case 'gambrel':
    case 'dutch':
    case 'mansard':
    case 'hip':
      return panelLocalZ >= 0 ? { minZ: 0, maxZ: halfD } : { minZ: -halfD, maxZ: 0 }
    default:
      return { minZ: -halfD, maxZ: halfD }
  }
}

/**
 * Return the rows/columns that fit the array edge-to-edge on the slope
 * the panel is sitting on. Returns null when nothing fits. Capped at
 * the schema's hard limit of 20.
 */
export function computeAutoFit(
  segment: RoofSegmentNode,
  panel: SolarPanelNode,
): { rows: number; columns: number } | null {
  const { minZ, maxZ } = getSlopeDepthBounds(segment, panel.position[2] ?? 0)
  const usableW = segment.width
  const usableD = maxZ - minZ
  if (usableW <= 0 || usableD <= 0) return null

  const columns = Math.floor((usableW + panel.gapX) / (panel.panelWidth + panel.gapX))
  const rows = Math.floor((usableD + panel.gapY) / (panel.panelHeight + panel.gapY))
  if (columns < 1 || rows < 1) return null

  return { rows: Math.min(rows, 20), columns: Math.min(columns, 20) }
}

export function flippedPanelDims(panel: SolarPanelNode): {
  panelWidth: number
  panelHeight: number
} {
  return { panelWidth: panel.panelHeight, panelHeight: panel.panelWidth }
}
