import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { buildSection, INCHES_TO_METERS } from '../duct-segment/geometry'
import type { PipeSegmentNode } from './schema'

const PVC_COLOR = '#f5f5f5'
const ABS_COLOR = '#3a3a3a'
const CAST_IRON_COLOR = '#54575c'
/** Vents read slightly translucent-matte so they don't visually compete
 *  with the water-carrying waste runs. */
const VENT_OPACITY = 0.85

const RADIAL_SEGMENTS = 20

type PipeAppearance = {
  pipeMaterial: 'pvc' | 'abs' | 'cast-iron'
  system: 'waste' | 'vent'
}

function getPipeColor(node: PipeAppearance): string {
  if (node.pipeMaterial === 'abs') return ABS_COLOR
  if (node.pipeMaterial === 'cast-iron') return CAST_IRON_COLOR
  return PVC_COLOR
}

export function createPipeMaterial(node: PipeAppearance): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: getPipeColor(node),
    metalness: node.pipeMaterial === 'cast-iron' ? 0.5 : 0.05,
    roughness: node.pipeMaterial === 'cast-iron' ? 0.6 : 0.45,
    transparent: node.system === 'vent',
    opacity: node.system === 'vent' ? VENT_OPACITY : 1,
  })
}

/**
 * Pure geometry builder for a DWV pipe run: capped cylinder sections
 * between consecutive path points with sphere hubs at interior joints
 * (proper wyes / sanitary tees come in the next slice). Slope lives in
 * the path's Y coordinates — nothing here is slope-aware.
 */
export function buildPipeSegmentGeometry(node: PipeSegmentNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const material = createPipeMaterial(node)
  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as Vector3
    const b = points[i + 1] as Vector3
    const mesh = buildSection(a, b, radius, material, `pipe-section-${i}`)
    if (mesh) group.add(mesh)
  }
  // Slightly proud hubs at interior joints — reads as a coupling.
  for (let i = 1; i < points.length - 1; i++) {
    const hub = new Mesh(new SphereGeometry(radius * 1.12, RADIAL_SEGMENTS, 12), material)
    hub.name = `pipe-hub-${i}`
    hub.position.copy(points[i] as Vector3)
    group.add(hub)
  }

  return group
}
