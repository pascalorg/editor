import { getActiveRoofHeight, type RoofSegmentNode, type SolarPanelNode } from '@pascal-app/core'
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

export function getAnalyticalNormal(lx: number, lz: number, seg: RoofSegmentNode): THREE.Vector3 {
  const { roofType, depth, width } = seg
  const rh = getActiveRoofHeight(seg)
  if (rh === 0) return new THREE.Vector3(0, 1, 0)

  if (roofType === 'gable') {
    const halfD = depth / 2
    return new THREE.Vector3(0, halfD, lz >= 0 ? rh : -rh).normalize()
  }
  if (roofType === 'shed') {
    return new THREE.Vector3(0, depth, -rh).normalize()
  }
  if (roofType === 'hip') {
    // All four hip faces share the same slope angle, set by `rh` over
    // `min(w/2, d/2)` (the eave-to-ridge horizontal reach perpendicular
    // to the ridge — short axis for both the trapezoidal long faces and
    // the triangular short faces). Using `depth/2` for the front/back
    // normal and `width/2` for the sides was correct only when w == d;
    // for any other aspect ratio it tilted the long-axis faces wrong.
    const fx = width > 0 ? Math.abs(lx) / (width / 2) : 0
    const fz = depth > 0 ? Math.abs(lz) / (depth / 2) : 0
    const slopeReach = Math.min(width, depth) / 2
    if (fz >= fx) {
      return new THREE.Vector3(0, slopeReach, lz >= 0 ? rh : -rh).normalize()
    }
    return new THREE.Vector3(lx >= 0 ? rh : -rh, slopeReach, 0).normalize()
  }
  const halfD = depth / 2
  return new THREE.Vector3(0, halfD, lz >= 0 ? rh : -rh).normalize()
}

// ─── Quaternion helper ───────────────────────────────────────────────
// Given a normal in the panel's parent frame, build a rotation that
// aligns the panel's local +Y to that normal. Lifted out so the
// renderer and the placement preview share one source of truth.

export function surfaceQuatFromNormal(normal: THREE.Vector3, out: THREE.Quaternion) {
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(up, normal)
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
  else right.normalize()
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
