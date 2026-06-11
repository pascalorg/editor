import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import type { DuctSegmentNode } from './schema'

export const INCHES_TO_METERS = 0.0254
// Insulation wraps the duct in a roughly uniform shell. A strictly physical
// mapping (fiberglass ≈ R-3.2 per inch) makes low R-values nearly invisible
// at screen scale — R-1 would add only ~8 mm over a 15 cm duct. So the shell
// uses a perceptual mapping: a visible base jacket as soon as insulation is
// non-zero, plus a clear per-R increment. Anchored so R-8 still lands near
// the real-world ~3" jacket.
const INSULATION_BASE_IN = 0.5
const INSULATION_INCHES_PER_R = 0.3125
function pickInsulationThickness(r: number): number {
  if (r <= 0) return 0
  return (INSULATION_BASE_IN + r * INSULATION_INCHES_PER_R) * INCHES_TO_METERS
}

const SUPPLY_COLOR = '#d4825a'
const RETURN_COLOR = '#5a8ad4'
const FLEX_COLOR = '#8a8a8a'
const SHEET_METAL_COLOR = '#c2c2c2'
const DUCT_BOARD_COLOR = '#a5946d'

const RADIAL_SEGMENTS = 24

const UP = new Vector3(0, 1, 0)

/**
 * Cylinder spanning `start`→`end` at `radius`. Shared by the segment and
 * fitting builders — fittings are just short sections + a junction.
 */
export function buildSection(
  start: Vector3,
  end: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  name: string,
): Mesh | null {
  const dir = new Vector3().subVectors(end, start)
  const length = dir.length()
  if (length < 1e-6) return null
  dir.normalize()

  // Capped, front-side-only — ducts should read as solid metal tubes,
  // not hollow open-ended shells.
  const geom = new CylinderGeometry(radius, radius, length, RADIAL_SEGMENTS, 1, false)
  const mesh = new Mesh(geom, material)
  mesh.name = name
  mesh.position.copy(start).addScaledVector(dir, length / 2)
  mesh.quaternion.setFromUnitVectors(UP, dir)
  return mesh
}

type DuctAppearance = {
  ductMaterial: 'sheet-metal' | 'flex' | 'duct-board'
  system: 'supply' | 'return'
}

function getDuctColor(node: DuctAppearance): string {
  if (node.ductMaterial === 'flex') return FLEX_COLOR
  if (node.ductMaterial === 'duct-board') return DUCT_BOARD_COLOR
  return SHEET_METAL_COLOR
}

function getSystemTint(node: DuctAppearance): string {
  return node.system === 'supply' ? SUPPLY_COLOR : RETURN_COLOR
}

/**
 * Standard duct body material — color by construction material with a
 * faint supply/return emissive tint. Shared with the fitting builder so
 * connected runs and junctions read as one system.
 */
export function createDuctMaterial(node: DuctAppearance): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: getDuctColor(node),
    metalness: node.ductMaterial === 'flex' ? 0.1 : 0.6,
    roughness: node.ductMaterial === 'flex' ? 0.85 : 0.4,
    emissive: getSystemTint(node),
    emissiveIntensity: 0.08,
  })
}

/**
 * Pure geometry builder for a round duct segment polyline.
 *
 * Strategy:
 *   - For every consecutive pair of path points, build a cylinder of the
 *     duct's inner diameter.
 *   - Drop a sphere of the same radius at every interior joint to cap the
 *     corner smoothly (no mitering yet — fittings come in a later slice).
 *   - When insulation is non-zero, repeat the same pattern at a larger
 *     radius using a translucent shell material.
 *
 * All children are returned in level-local meters; the framework's
 * `<ParametricNodeRenderer>` handles the node-level transform (currently
 * identity since the schema has no position field — the path itself is
 * absolute within the level).
 */
export function buildDuctSegmentGeometry(node: DuctSegmentNode): Group {
  const group = new Group()
  if (node.path.length < 2) return group

  const radius = (node.diameter * INCHES_TO_METERS) / 2
  const ductMaterial = createDuctMaterial(node)

  const points = node.path.map(([x, y, z]) => new Vector3(x, y, z))

  for (let i = 0; i < points.length - 1; i++) {
    // Loop bounds + min(2) on the schema guarantee both points exist.
    const a = points[i] as Vector3
    const b = points[i + 1] as Vector3
    const mesh = buildSection(a, b, radius, ductMaterial, `duct-section-${i}`)
    if (mesh) group.add(mesh)
  }

  // Joint caps at interior points only (skip first and last — they're open
  // ends for now; equipment / terminal nodes will cap them later).
  for (let i = 1; i < points.length - 1; i++) {
    const joint = new Mesh(new SphereGeometry(radius, RADIAL_SEGMENTS, 12), ductMaterial)
    joint.name = `duct-joint-${i}`
    joint.position.copy(points[i] as Vector3)
    group.add(joint)
  }

  const insulationThickness = pickInsulationThickness(node.insulationR)
  if (insulationThickness > 0) {
    const insulationRadius = radius + insulationThickness
    const insulationMaterial = new MeshStandardMaterial({
      color: '#f0e4c8',
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.25,
    })
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i] as Vector3
      const b = points[i + 1] as Vector3
      const mesh = buildSection(a, b, insulationRadius, insulationMaterial, `duct-insulation-${i}`)
      if (mesh) group.add(mesh)
    }
    for (let i = 1; i < points.length - 1; i++) {
      const joint = new Mesh(
        new SphereGeometry(insulationRadius, RADIAL_SEGMENTS, 12),
        insulationMaterial,
      )
      joint.name = `duct-insulation-joint-${i}`
      joint.position.copy(points[i] as Vector3)
      group.add(joint)
    }
  }

  return group
}
