import { type GeometryContext, getMaterialPresetByRef } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  createDefaultMaterial,
  createMaterial,
  type RenderShading,
} from '@pascal-app/viewer'
import { BoxGeometry, Group, type Material, Mesh } from 'three'
import type { FireplaceNode } from './schema'

const DEFAULT_SURROUND_COLOR = '#3a3a3a'
const DEFAULT_MANTEL_COLOR = '#4a3520'
const DEFAULT_HEARTH_COLOR = '#2a2a2a'
const DEFAULT_FIREBOX_COLOR = '#1a1a1a'

function getMaterial(
  node: FireplaceNode,
  preset: string | undefined,
  fallbackColor: string,
  shading: RenderShading,
): Material {
  if (preset) {
    const presetObj = getMaterialPresetByRef(preset)
    if (presetObj) {
      const base = createDefaultMaterial('#ffffff', 0.5, shading)
      applyMaterialPresetToMaterials(base, presetObj)
      return base
    }
  }
  if (node.material) return createMaterial(node.material, shading)
  return createDefaultMaterial(fallbackColor, 0.7, shading)
}

function getMantelMaterial(node: FireplaceNode, shading: RenderShading): Material {
  if (node.mantelMaterialPreset) {
    const presetObj = getMaterialPresetByRef(node.mantelMaterialPreset)
    if (presetObj) {
      const base = createDefaultMaterial('#ffffff', 0.5, shading)
      applyMaterialPresetToMaterials(base, presetObj)
      return base
    }
  }
  if (node.mantelMaterial) return createMaterial(node.mantelMaterial, shading)
  return createDefaultMaterial(DEFAULT_MANTEL_COLOR, 0.8, shading)
}

function getHearthMaterial(node: FireplaceNode, shading: RenderShading): Material {
  if (node.hearthMaterialPreset) {
    const presetObj = getMaterialPresetByRef(node.hearthMaterialPreset)
    if (presetObj) {
      const base = createDefaultMaterial('#ffffff', 0.5, shading)
      applyMaterialPresetToMaterials(base, presetObj)
      return base
    }
  }
  if (node.hearthMaterial) return createMaterial(node.hearthMaterial, shading)
  return createDefaultMaterial(DEFAULT_HEARTH_COLOR, 0.8, shading)
}

function getFireboxMaterial(node: FireplaceNode, shading: RenderShading): Material {
  if (node.fireboxMaterialPreset) {
    const presetObj = getMaterialPresetByRef(node.fireboxMaterialPreset)
    if (presetObj) {
      const base = createDefaultMaterial('#ffffff', 0.5, shading)
      applyMaterialPresetToMaterials(base, presetObj)
      return base
    }
  }
  if (node.fireboxMaterial) return createMaterial(node.fireboxMaterial, shading)
  return createDefaultMaterial(DEFAULT_FIREBOX_COLOR, 0.9, shading)
}

export function buildFireplaceGeometry(
  node: FireplaceNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  group.name = 'fireplace-geometry'

  const surroundMat = getMaterial(node, node.materialPreset, DEFAULT_SURROUND_COLOR, shading)
  const mantelMat = getMantelMaterial(node, shading)
  const hearthMat = getHearthMaterial(node, shading)
  const fireboxMat = getFireboxMaterial(node, shading)

  const { width, height, depth, style, cornerAngle } = node
  const {
    fireboxWidth,
    fireboxHeight,
    fireboxDepth,
    fireboxSillHeight,
    mantelHeight,
    mantelOverhang,
    mantelThickness,
    hearthDepth,
    hearthHeight,
    hearthWidth,
    surroundWidth,
    lintelHeight,
  } = node

  // Hearths — the floor-level stone slab extending forward of the firebox.
  const hearthW = width + hearthWidth * 2
  const hearthMesh = new Mesh(new BoxGeometry(hearthW, hearthHeight, hearthDepth), hearthMat)
  hearthMesh.name = 'fireplace-hearth'
  hearthMesh.position.set(0, hearthHeight / 2, hearthDepth / 2)
  group.add(hearthMesh)

  // Surround — the vertical structure around the firebox opening.
  // Left + right pillars.
  const pillarHeight = height - hearthHeight
  const pillarY = hearthHeight + pillarHeight / 2

  const leftPillar = new Mesh(new BoxGeometry(surroundWidth, pillarHeight, depth), surroundMat)
  leftPillar.name = 'fireplace-surround-left'
  leftPillar.position.set(-(width / 2 - surroundWidth / 2), pillarY, 0)
  group.add(leftPillar)

  const rightPillar = new Mesh(new BoxGeometry(surroundWidth, pillarHeight, depth), surroundMat)
  rightPillar.name = 'fireplace-surround-right'
  rightPillar.position.set(width / 2 - surroundWidth / 2, pillarY, 0)
  group.add(rightPillar)

  // Lintel — the horizontal beam above the firebox opening.
  const lintelY = hearthHeight + fireboxSillHeight + fireboxHeight + lintelHeight / 2
  const lintel = new Mesh(new BoxGeometry(width, lintelHeight, depth), surroundMat)
  lintel.name = 'fireplace-lintel'
  lintel.position.set(0, lintelY, 0)
  group.add(lintel)

  // Top filler — fills the gap between lintel top and the overall height.
  const topFillerHeight = height - (fireboxSillHeight + fireboxHeight + lintelHeight) - hearthHeight
  if (topFillerHeight > 0.01) {
    const topFiller = new Mesh(new BoxGeometry(width, topFillerHeight, depth), surroundMat)
    topFiller.name = 'fireplace-top'
    topFiller.position.set(
      0,
      hearthHeight + fireboxSillHeight + fireboxHeight + lintelHeight + topFillerHeight / 2,
      0,
    )
    group.add(topFiller)
  }

  // Firebox interior — a dark recessed box. Positioned behind the opening.
  const fireboxY = hearthHeight + fireboxSillHeight + fireboxHeight / 2
  const fireboxZ = -depth / 2 + fireboxDepth / 2

  // Firebox walls (back + top + sides) — all in dark firebox material.
  const fireboxInterior = new Mesh(
    new BoxGeometry(fireboxWidth, fireboxHeight, fireboxDepth),
    fireboxMat,
  )
  fireboxInterior.name = 'fireplace-firebox'
  fireboxInterior.position.set(0, fireboxY, fireboxZ)
  group.add(fireboxInterior)

  // Back wall of the firebox (thinner, dark).
  const fireboxBack = new Mesh(new BoxGeometry(fireboxWidth, fireboxHeight, 0.02), fireboxMat)
  fireboxBack.name = 'fireplace-firebox-back'
  fireboxBack.position.set(0, fireboxY, -depth / 2 + 0.01)
  group.add(fireboxBack)

  // Mantel shelf — the decorative top piece that overhangs the surround.
  if (mantelHeight > 0) {
    const mantelW = width + mantelOverhang * 2 + node.mantelWidth * 2
    const mantelD = depth + mantelOverhang
    const mantel = new Mesh(new BoxGeometry(mantelW, mantelThickness, mantelD), mantelMat)
    mantel.name = 'fireplace-mantel'
    const mantelY = height - mantelThickness / 2
    mantel.position.set(0, mantelY, mantelOverhang / 2)
    group.add(mantel)
  }

  // Corner style — rotate the whole structure by cornerAngle.
  if (style === 'corner') {
    group.rotation.y = (cornerAngle * Math.PI) / 180
  }

  // Double-sided — add a second firebox opening on the back.
  if (style === 'double-sided') {
    const backFirebox = new Mesh(
      new BoxGeometry(fireboxWidth, fireboxHeight, fireboxDepth),
      fireboxMat,
    )
    backFirebox.name = 'fireplace-firebox-back-side'
    backFirebox.position.set(0, fireboxY, depth / 2 - fireboxDepth / 2)
    group.add(backFirebox)
  }

  // Freestanding — add a back panel to close the structure.
  if (style === 'freestanding') {
    const backPanel = new Mesh(new BoxGeometry(width, height, 0.05), surroundMat)
    backPanel.name = 'fireplace-back-panel'
    backPanel.position.set(0, height / 2, -depth / 2)
    group.add(backPanel)
  }

  for (const child of group.children) {
    child.castShadow = true
    child.receiveShadow = true
  }

  return group
}
