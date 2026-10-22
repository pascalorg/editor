import type { SolarPanelNode } from '@pascal-app/core'
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
export function solarPanelMountLift(node: SolarPanelNode): number {
  const angle = node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0
  const depth = node.rows * node.panelHeight + (node.rows - 1) * node.gapY
  return (depth / 2) * Math.abs(Math.tan(angle))
}

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
  const lift = solarPanelMountLift(node)
  const angle = node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0
  const originX = -totalW / 2
  const originZ = -totalH / 2

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cx = originX + c * (panelWidth + gapX) + panelWidth / 2
      const cz = originZ + r * (panelHeight + gapY) + panelHeight / 2
      const y = standoffHeight + lift + frameDepth / 2

      const ft = Math.min(Math.max(0, frameThickness), Math.min(panelWidth, panelHeight) * 0.45)
      const glassW = panelWidth - 2 * ft
      const glassH = panelHeight - 2 * ft
      if (glassW > 0 && glassH > 0) {
        const glass = new THREE.BoxGeometry(glassW, frameDepth * 0.6, glassH)
        glass.translate(cx, y + frameDepth * 0.1, cz)
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

      const fd = frameDepth

      const backsheet = new THREE.BoxGeometry(glassW, Math.min(0.008, fd * 0.2), glassH)
      backsheet.translate(cx, y - fd * 0.4, cz)
      frameGeos.push(backsheet)
      for (const offset of [-panelHeight * 0.3, panelHeight * 0.3]) {
        const rail = new THREE.BoxGeometry(panelWidth, 0.018, 0.035)
        const railY = standoffHeight + lift - 0.009
        rail.translate(cx, railY, cz + offset)
        frameGeos.push(rail)
        for (const side of [-1, 1]) {
          const top = new THREE.Vector3(cx + side * panelWidth * 0.35, railY, cz + offset)
          const rotated = top.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), angle)
          const bottom = new THREE.Vector3(rotated.x, 0, rotated.z).applyAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -angle,
          )
          const length = top.distanceTo(bottom)
          if (length > 0.001) {
            const leg = new THREE.BoxGeometry(0.025, length, 0.025)
            leg.applyQuaternion(
              new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                top.clone().sub(bottom).normalize(),
              ),
            )
            leg.translate(...top.clone().add(bottom).multiplyScalar(0.5).toArray())
            frameGeos.push(leg)
          }
        }
      }

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

// ─── Layout helpers (used by the inspector / placement tool) ─────────

export function flippedPanelDims(panel: SolarPanelNode): {
  panelWidth: number
  panelHeight: number
} {
  return { panelWidth: panel.panelHeight, panelHeight: panel.panelWidth }
}
