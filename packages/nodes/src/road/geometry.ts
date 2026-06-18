import {
  getMaterialPresetByRef,
  getWallCurveFrameAt,
  getWallCurveLength,
  resolveMaterial,
  sampleWallCenterline,
} from '@pascal-app/core'
import { applyMaterialPresetToMaterials, type RenderShading } from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, type Material, Mesh, MeshStandardMaterial } from 'three'
import type { RoadNode } from './schema'

function getMaterialDebugColor(material: Material): string | null {
  const color = (material as { color?: { getHexString?: () => string } }).color
  return color?.getHexString ? `#${color.getHexString()}` : null
}

function createRoadMaterial(node: RoadNode, shading: RenderShading): Material {
  if (node.materialPreset) {
    const preset = getMaterialPresetByRef(node.materialPreset)
    if (preset) {
      const material = new MeshStandardMaterial()
      applyMaterialPresetToMaterials(material, preset)
      console.log('[pascal:road:material]', {
        id: node.id,
        source: 'materialPreset',
        materialPreset: node.materialPreset,
        shading,
        resolvedColor: getMaterialDebugColor(material),
        maps: Object.keys(preset.maps).filter(
          (key) => preset.maps[key as keyof typeof preset.maps] !== undefined,
        ),
      })
      return material
    }
  }

  if (node.material) {
    const properties = resolveMaterial(node.material)
    const material = new MeshStandardMaterial({
      color: properties.color,
      roughness: properties.roughness,
      metalness: properties.metalness,
      opacity: properties.opacity,
      transparent: properties.transparent,
      side: FrontSide,
    })
    console.log('[pascal:road:material]', {
      id: node.id,
      source: 'material',
      inputColor: node.material.properties?.color,
      resolvedProperties: properties,
      shading,
      resolvedColor: getMaterialDebugColor(material),
    })
    return material
  }

  const material = new MeshStandardMaterial({
    color: node.asphaltColor,
    roughness: 0.88,
    metalness: 0.02,
  })
  console.log('[pascal:road:material]', {
    id: node.id,
    source: 'asphaltColor',
    asphaltColor: node.asphaltColor,
    shading,
    resolvedColor: getMaterialDebugColor(material),
  })
  return material
}

function createMarkingMaterial(color: string, shading: RenderShading): Material {
  void shading
  return new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 })
}

function addRoadSegment(
  group: Group,
  args: {
    x1: number
    z1: number
    x2: number
    z2: number
    width: number
    height: number
    y: number
    material: Material
  },
) {
  const dx = args.x2 - args.x1
  const dz = args.z2 - args.z1
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return

  const mesh = new Mesh(new BoxGeometry(length, args.height, args.width), args.material)
  mesh.position.set((args.x1 + args.x2) / 2, args.y, (args.z1 + args.z2) / 2)
  mesh.rotation.y = -Math.atan2(dz, dx)
  mesh.receiveShadow = true
  group.add(mesh)
}

function addRoadBody(group: Group, node: RoadNode, shading: RenderShading) {
  const points = sampleWallCenterline(node, 32)
  const material = createRoadMaterial(node, shading)

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!
    const next = points[index]!
    addRoadSegment(group, {
      x1: prev.x,
      z1: prev.y,
      x2: next.x,
      z2: next.y,
      width: node.width,
      height: node.thickness,
      y: node.elevation + node.thickness / 2,
      material,
    })
  }
}

function addLaneMarkings(group: Group, node: RoadNode, length: number, shading: RenderShading) {
  if (!node.showLaneMarkings || node.laneCount <= 1 || length <= 0.4) return

  const laneWidth = node.width / node.laneCount
  const stripeLength = Math.min(1.2, Math.max(0.35, length * 0.18))
  const stripeGap = stripeLength
  const step = stripeLength + stripeGap
  const stripeWidth = Math.min(0.12, Math.max(0.045, laneWidth * 0.04))
  const stripeHeight = 0.006
  const material = createMarkingMaterial(node.markingColor, shading)
  const segmentCount = Math.max(1, Math.floor(length / step))

  for (let laneIndex = 1; laneIndex < node.laneCount; laneIndex += 1) {
    const laneOffset = -node.width / 2 + laneWidth * laneIndex
    for (let index = 0; index < segmentCount; index += 1) {
      const distance = stripeLength / 2 + index * step
      const t = Math.max(0, Math.min(1, distance / length))
      const frame = getWallCurveFrameAt(node, t)
      const dx = frame.tangent.x
      const dz = frame.tangent.y
      const cx = frame.point.x + frame.normal.x * laneOffset
      const cz = frame.point.y + frame.normal.y * laneOffset
      const geometry = new BoxGeometry(stripeLength, stripeHeight, stripeWidth)
      const stripe = new Mesh(geometry, material)
      stripe.position.set(cx, node.elevation + node.thickness + stripeHeight / 2, cz)
      stripe.rotation.y = -Math.atan2(dz, dx)
      stripe.receiveShadow = true
      group.add(stripe)
    }
  }
}

export function buildRoadGeometry(
  node: RoadNode,
  _ctx?: unknown,
  shading: RenderShading = 'rendered',
): Group {
  const group = new Group()
  const length = getWallCurveLength(node)
  if (length < 0.01) return group

  console.log('[pascal:road:build]', {
    id: node.id,
    materialColor: node.material?.properties?.color,
    materialPreset: node.materialPreset,
    asphaltColor: node.asphaltColor,
    markingColor: node.markingColor,
    shading,
  })

  addRoadBody(group, node, shading)
  addLaneMarkings(group, node, length, shading)

  return group
}
