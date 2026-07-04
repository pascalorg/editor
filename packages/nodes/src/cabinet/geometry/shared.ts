import {
  type CabinetModuleNode,
  type CabinetNode,
  type GeometryContext,
  getMaterialPresetByRef,
  type MaterialSchema,
} from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  glassMaterial as defaultGlassMaterial,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  FrontSide,
  type Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Shape,
} from 'three'
import { type CabinetSlotId, cabinetSlots } from '../slots'

export type CabinetGeometryNode = CabinetNode | CabinetModuleNode
export type CabinetSlotMaterials = Record<CabinetSlotId, Material>

const CABINET_SLOT_DEFAULTS = Object.fromEntries(
  cabinetSlots().map((slot) => [slot.slotId, slot.default]),
) as Record<CabinetSlotId, string>

export function createWorldScaleBoxGeometry(
  width: number,
  height: number,
  depth: number,
): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth)
  applyWorldScaleBoxUVs(geometry, width, height, depth)
  return geometry
}

function getLegacyCabinetMaterial(
  node: CabinetGeometryNode,
  shading: RenderShading,
): Material | null {
  if (node.materialPreset) {
    const preset = getMaterialPresetByRef(node.materialPreset)
    if (preset) {
      const base = createDefaultMaterial('#ffffff', 0.6, shading)
      applyMaterialPresetToMaterials(base, preset)
      return base
    }
  }
  if (node.material) return createMaterial(node.material as MaterialSchema, shading)
  return null
}

function getCabinetSlotMaterial(
  node: CabinetGeometryNode,
  slotId: CabinetSlotId,
  materials: GeometryContext['materials'],
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): Material {
  if (!textures) {
    if (slotId === 'glass') return defaultGlassMaterial
    return createSurfaceRoleMaterial('joinery', colorPreset, FrontSide, sceneTheme)
  }

  const slotRef = node.slots?.[slotId]
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, materials, shading)
    if (resolved) return resolved
  }

  if (
    slotId === 'front' ||
    slotId === 'carcass' ||
    slotId === 'countertop' ||
    slotId === 'plinth'
  ) {
    const legacy = getLegacyCabinetMaterial(node, shading)
    if (legacy) return legacy
  }

  return resolveSlotDefaultMaterial(
    CABINET_SLOT_DEFAULTS[slotId],
    shading,
    slotId === 'hardware' || slotId === 'appliance' ? 0.45 : 0.8,
  )
}

export function getCabinetSlotMaterials(
  node: CabinetGeometryNode,
  ctx: GeometryContext | undefined,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
): CabinetSlotMaterials {
  return {
    front: getCabinetSlotMaterial(
      node,
      'front',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    carcass: getCabinetSlotMaterial(
      node,
      'carcass',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    countertop: getCabinetSlotMaterial(
      node,
      'countertop',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    plinth: getCabinetSlotMaterial(
      node,
      'plinth',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    hardware: getCabinetSlotMaterial(
      node,
      'hardware',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    glass: getCabinetSlotMaterial(
      node,
      'glass',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    appliance: getCabinetSlotMaterial(
      node,
      'appliance',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
    applianceInterior: getCabinetSlotMaterial(
      node,
      'applianceInterior',
      ctx?.materials,
      shading,
      textures,
      colorPreset,
      sceneTheme,
    ),
  }
}

export function stampSlot<T extends Mesh>(mesh: T, slotId: CabinetSlotId): T {
  mesh.userData.slotId = slotId
  return mesh
}

export function addBox(
  group: Group,
  size: [number, number, number],
  position: [number, number, number],
  materialOrColor: Material | string,
  name: string,
  slotId: CabinetSlotId = 'carcass',
) {
  const material =
    typeof materialOrColor === 'string'
      ? new MeshStandardMaterial({ color: materialOrColor, metalness: 0.08, roughness: 0.72 })
      : materialOrColor
  const geometry = createWorldScaleBoxGeometry(size[0], size[1], size[2])
  const mesh = stampSlot(new Mesh(geometry, material), slotId)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

export const OVEN_OPEN_ANGLE = (88 * Math.PI) / 180
export const APPLIANCE_CAVITY_WALL = 0.02

export const applianceDisplayMaterial = new MeshStandardMaterial({
  color: '#120c05',
  emissive: '#ff9a3d',
  emissiveIntensity: 0.85,
  roughness: 0.3,
})
export const applianceLampMaterial = new MeshStandardMaterial({
  color: '#2b2417',
  emissive: '#ffd9a0',
  emissiveIntensity: 0.6,
  roughness: 0.4,
})
export const microwaveScreenMaterial = new MeshStandardMaterial({
  color: '#05070a',
  emissive: '#111827',
  emissiveIntensity: 0.2,
  metalness: 0.05,
  roughness: 0.32,
})
export const microwaveButtonMaterial = new MeshStandardMaterial({
  color: '#2f3338',
  metalness: 0.35,
  roughness: 0.42,
})
export const microwaveStartButtonMaterial = new MeshStandardMaterial({
  color: '#1d6f45',
  emissive: '#16a34a',
  emissiveIntensity: 0.08,
  metalness: 0.2,
  roughness: 0.38,
})
export const microwaveCancelButtonMaterial = new MeshStandardMaterial({
  color: '#7f1d1d',
  emissive: '#ef4444',
  emissiveIntensity: 0.08,
  metalness: 0.2,
  roughness: 0.38,
})
export const microwavePanelMaterial = new MeshStandardMaterial({
  color: '#16191d',
  metalness: 0.55,
  roughness: 0.36,
})
export const cooktopGlassMaterial = new MeshStandardMaterial({
  color: '#17191c',
  metalness: 0.45,
  roughness: 0.07,
})
export const cooktopBurnerMaterial = new MeshStandardMaterial({
  color: '#7d8389',
  metalness: 0.85,
  roughness: 0.3,
})
export const cooktopTrimMaterial = new MeshStandardMaterial({
  color: '#3a3d41',
  metalness: 0.85,
  roughness: 0.3,
})
export const cooktopGrateMaterial = new MeshStandardMaterial({
  color: '#0d0e10',
  metalness: 0.55,
  roughness: 0.5,
})
export const cooktopInductionZoneMaterial = new MeshStandardMaterial({
  color: '#07111f',
  emissive: '#2563eb',
  emissiveIntensity: 0.22,
  metalness: 0.05,
  roughness: 0.2,
})
export const cooktopInductionActiveZoneMaterial = new MeshStandardMaterial({
  color: '#0b1f3a',
  emissive: '#38bdf8',
  emissiveIntensity: 0.75,
  metalness: 0.05,
  roughness: 0.18,
})
export const cooktopKnobOnMaterial = new MeshStandardMaterial({
  color: '#ffb86b',
  emissive: '#f97316',
  emissiveIntensity: 0.45,
  metalness: 0.2,
  roughness: 0.24,
})
export const cooktopKnobHitMaterial = new MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  transparent: true,
  opacity: 0,
})
export const refrigeratorSilverMaterial = new MeshStandardMaterial({
  color: '#c9ccd0',
  metalness: 0.78,
  roughness: 0.32,
})
export const refrigeratorBrassAccentMaterial = new MeshStandardMaterial({
  color: '#b3925f',
  metalness: 0.75,
  roughness: 0.3,
})
export const refrigeratorDarkTrimMaterial = new MeshStandardMaterial({
  color: '#4d5257',
  metalness: 0.6,
  roughness: 0.42,
})
export const refrigeratorSealMaterial = new MeshStandardMaterial({
  color: '#d9dbdd',
  metalness: 0.02,
  roughness: 0.6,
})
export const refrigeratorLinerMaterial = new MeshStandardMaterial({
  color: '#f7f8f9',
  metalness: 0.02,
  roughness: 0.55,
})
export const refrigeratorLinerAccentMaterial = new MeshStandardMaterial({
  color: '#eef0f2',
  metalness: 0.02,
  roughness: 0.48,
})
export const refrigeratorDrawerMaterial = new MeshStandardMaterial({
  color: '#eef4f8',
  transparent: true,
  opacity: 0.45,
  metalness: 0.02,
  roughness: 0.18,
})
export const refrigeratorBinMaterial = new MeshStandardMaterial({
  color: '#f4f6f8',
  transparent: true,
  opacity: 0.62,
  metalness: 0.02,
  roughness: 0.24,
})
export const refrigeratorLightMaterial = new MeshStandardMaterial({
  color: '#fff7d6',
  emissive: '#fff1a8',
  emissiveIntensity: 0.32,
  roughness: 0.24,
})
export const refrigeratorWaterMaterial = new MeshStandardMaterial({
  color: '#38bdf8',
  emissive: '#0ea5e9',
  emissiveIntensity: 0.18,
  metalness: 0.05,
  roughness: 0.22,
})
export const ovenDialMaterial = new MeshStandardMaterial({
  color: '#d5d7d8',
  metalness: 0.72,
  roughness: 0.24,
})
export const ovenIndicatorMaterial = new MeshStandardMaterial({
  color: '#f8fafc',
  emissive: '#f8fafc',
  emissiveIntensity: 0.12,
  metalness: 0.1,
  roughness: 0.32,
})
export const ovenHeatElementMaterial = new MeshStandardMaterial({
  color: '#4a1f16',
  emissive: '#ff6b35',
  emissiveIntensity: 0.28,
  metalness: 0.35,
  roughness: 0.42,
})
export const ovenStatusLightMaterials = ['#f97316', '#22c55e', '#38bdf8'].map(
  (color) =>
    new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      roughness: 0.28,
    }),
)

// These module-level materials are shared by every cabinet instance in the
// scene. Without the cached flag, the geometry system's disposeChildren would
// dispose them on each rebuild, breaking every other cabinet still using them
// and forcing scene-wide shader recompiles.
for (const material of [
  applianceDisplayMaterial,
  applianceLampMaterial,
  microwaveScreenMaterial,
  microwaveButtonMaterial,
  microwaveStartButtonMaterial,
  microwaveCancelButtonMaterial,
  microwavePanelMaterial,
  cooktopGlassMaterial,
  cooktopBurnerMaterial,
  cooktopTrimMaterial,
  cooktopGrateMaterial,
  cooktopInductionZoneMaterial,
  cooktopInductionActiveZoneMaterial,
  cooktopKnobOnMaterial,
  cooktopKnobHitMaterial,
  refrigeratorSilverMaterial,
  refrigeratorBrassAccentMaterial,
  refrigeratorDarkTrimMaterial,
  refrigeratorSealMaterial,
  refrigeratorLinerMaterial,
  refrigeratorLinerAccentMaterial,
  refrigeratorDrawerMaterial,
  refrigeratorBinMaterial,
  refrigeratorLightMaterial,
  refrigeratorWaterMaterial,
  ovenDialMaterial,
  ovenIndicatorMaterial,
  ovenHeatElementMaterial,
  ...ovenStatusLightMaterials,
]) {
  material.userData.__pascalCachedMaterial = true
}

export function addApplianceHandle(
  group: Object3D,
  material: Material,
  position: [number, number, number],
  length: number,
  vertical: boolean,
  name: string,
) {
  const tube = stampSlot(
    new Mesh(new CylinderGeometry(0.009, 0.009, length, 16), material),
    'appliance',
  )
  tube.name = name
  tube.position.set(position[0], position[1], position[2] + 0.042)
  if (!vertical) tube.rotation.z = Math.PI / 2
  tube.castShadow = true
  group.add(tube)

  const standoffDistance = length * 0.38
  for (const offset of [-standoffDistance, standoffDistance]) {
    const standoff = stampSlot(
      new Mesh(new CylinderGeometry(0.006, 0.006, 0.04, 10), material),
      'appliance',
    )
    standoff.name = `${name}-standoff`
    standoff.position.set(
      position[0] + (vertical ? 0 : offset),
      position[1] + (vertical ? offset : 0),
      position[2] + 0.02,
    )
    standoff.rotation.x = Math.PI / 2
    standoff.castShadow = true
    group.add(standoff)
  }
}

export function roundedButtonGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
) {
  const shape = new Shape()
  const halfWidth = width / 2
  const halfHeight = height / 2
  const r = Math.min(radius, halfWidth, halfHeight)
  shape.moveTo(-halfWidth + r, -halfHeight)
  shape.lineTo(halfWidth - r, -halfHeight)
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r)
  shape.lineTo(halfWidth, halfHeight - r)
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight)
  shape.lineTo(-halfWidth + r, halfHeight)
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r)
  shape.lineTo(-halfWidth, -halfHeight + r)
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight)

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(0.0015, depth * 0.3),
    bevelSize: Math.min(0.0015, r * 0.35),
    bevelSegments: 2,
    curveSegments: 8,
    steps: 1,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  return geometry
}

export function addMicrowaveDisplaySegments(
  group: Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  name: string,
) {
  const segmentWidth = width * 0.16
  const segmentHeight = 0.004
  for (let i = 0; i < 3; i += 1) {
    const segment = stampSlot(
      new Mesh(new BoxGeometry(segmentWidth, segmentHeight, 0.002), applianceDisplayMaterial),
      'appliance',
    )
    segment.name = `${name}-display-segment-${i}`
    segment.position.set(x - width * 0.22 + i * width * 0.22, y, z + 0.006)
    group.add(segment)
  }
}

export function addWireRack(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
) {
  const bar = 0.006
  const frame: Array<{ size: [number, number, number]; position: [number, number, number] }> = [
    { size: [width, bar, bar], position: [0, y, zCenter + depth / 2 - bar / 2] },
    { size: [width, bar, bar], position: [0, y, zCenter - depth / 2 + bar / 2] },
    { size: [bar, bar, depth], position: [-width / 2 + bar / 2, y, zCenter] },
    { size: [bar, bar, depth], position: [width / 2 - bar / 2, y, zCenter] },
  ]
  frame.forEach((piece, i) => {
    addBox(
      group,
      piece.size,
      piece.position,
      materials.applianceInterior,
      `${name}-frame-${i}`,
      'applianceInterior',
    )
  })
  for (let i = 1; i <= 7; i++) {
    const x = -width / 2 + (width * i) / 8
    addBox(
      group,
      [0.004, 0.004, Math.max(0.01, depth - bar * 2)],
      [x, y, zCenter],
      materials.applianceInterior,
      `${name}-bar-${i}`,
      'applianceInterior',
    )
  }
}
