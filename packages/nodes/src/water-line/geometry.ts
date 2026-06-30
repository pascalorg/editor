import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { buildSection, INCHES_TO_METERS } from '../duct-segment/geometry'
import type { WaterLineNode } from './schema'

// System-specific colors. Cold water reads blue; hot water reads warm red.
const COLD_WATER_COLOR = '#93c5fd'
const HOT_WATER_COLOR = '#fca5a5'

const COPPER_COLOR = '#b87333'
const PEX_COLOR_COLD = '#60a5fa'
const PEX_COLOR_HOT = '#f87171'
const PVC_COLOR = '#e5e7eb'
const CPVC_COLOR = '#fde68a'

const RADIAL_SEGMENTS = 18

function getWaterLineColor(node: WaterLineNode): string {
  if (node.pipeMaterial === 'copper') return COPPER_COLOR
  if (node.pipeMaterial === 'cpvc') return CPVC_COLOR
  if (node.pipeMaterial === 'pex') {
    return node.system === 'hot-water' ? PEX_COLOR_HOT : PEX_COLOR_COLD
  }
  // pvc
  return node.system === 'hot-water' ? HOT_WATER_COLOR : COLD_WATER_COLOR
}

function createWaterLineMaterial(node: WaterLineNode): MeshStandardMaterial {
  const isMetal = node.pipeMaterial === 'copper'
  return new MeshStandardMaterial({
    color: getWaterLineColor(node),
    metalness: isMetal ? 0.6 : 0.05,
    roughness: isMetal ? 0.4 : 0.5,
  })
}

/**
 * Pure geometry builder for a pressurized water supply run: capped cylinder
 * sections between consecutive path points with sphere hubs at interior joints.
 */
export function buildWaterLineGeometry(node: WaterLineNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const material = createWaterLineMaterial(node)
  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Vector3
    const b = points[i + 1] as Vector3
    const mesh = buildSection(a, b, radius, material, `water-section-${i}`)
    if (mesh) group.add(mesh)
  }

  for (let i = 1; i < points.length - 1; i++) {
    const hub = new Mesh(
      new SphereGeometry(radius * 1.1, RADIAL_SEGMENTS, 10),
      material,
    )
    hub.name = `water-hub-${i}`
    hub.position.copy(points[i] as Vector3)
    group.add(hub)
  }

  return group
}
