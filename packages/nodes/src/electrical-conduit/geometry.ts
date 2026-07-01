import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { buildSection, INCHES_TO_METERS } from '../duct-segment/geometry'
import type { ElectricalConduitNode } from './schema'

const EMT_COLOR = '#9ca3af'
const PVC_COLOR = '#d1d5db'
const FLEX_COLOR = '#6b7280'

const RADIAL_SEGMENTS = 16

function getConduitColor(node: ElectricalConduitNode): string {
  if (node.conduitMaterial === 'emt') return EMT_COLOR
  if (node.conduitMaterial === 'flex') return FLEX_COLOR
  return PVC_COLOR
}

function createConduitMaterial(node: ElectricalConduitNode): MeshStandardMaterial {
  const isMetal = node.conduitMaterial === 'emt'
  return new MeshStandardMaterial({
    color: getConduitColor(node),
    metalness: isMetal ? 0.7 : 0.05,
    roughness: isMetal ? 0.35 : 0.55,
  })
}

/**
 * Pure geometry builder for an electrical conduit run: capped cylinder
 * sections between consecutive path points with sphere hubs at interior
 * joints (proper conduit bodies come in a later slice).
 */
export function buildElectricalConduitGeometry(node: ElectricalConduitNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const material = createConduitMaterial(node)
  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Vector3
    const b = points[i + 1] as Vector3
    const mesh = buildSection(a, b, radius, material, `conduit-section-${i}`)
    if (mesh) group.add(mesh)
  }

  for (let i = 1; i < points.length - 1; i++) {
    const hub = new Mesh(
      new SphereGeometry(radius * 1.1, RADIAL_SEGMENTS, 10),
      material,
    )
    hub.name = `conduit-hub-${i}`
    hub.position.copy(points[i] as Vector3)
    group.add(hub)
  }

  return group
}
