import type { AnyNode, AnyNodeId } from '../schema'

/**
 * Riser diagram (plumbing isometric) — the conventional way DWV systems
 * are drawn for permit: the drain/vent tree projected to a 30° iso so
 * vertical stacks read as vertical and horizontal runs lean off at 30°,
 * annotated with size + slope and vent terminations.
 *
 * This is a pure projector: it turns the scene's DWV nodes into 2D
 * drawables (level-independent, no rendering). The editor draws the
 * result as SVG. Air/refrigerant nodes are ignored — riser diagrams are
 * a plumbing convention.
 */

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)

/** A 3D level-local point (meters) projected to 2D iso screen space.
 *  Screen Y grows DOWNWARD (SVG convention), so higher elevation → lower
 *  screen Y. */
export function projectIso(x: number, y: number, z: number): [number, number] {
  const sx = (x - z) * COS30
  const sy = (x + z) * SIN30 - y
  return [sx, sy]
}

export type RiserLine = {
  /** Projected endpoints in iso screen space. */
  from: [number, number]
  to: [number, number]
  system: 'waste' | 'vent'
  /** Nominal size in inches. */
  diameter: number
  /** True for a (near-)vertical run — drawn solid/bold as a stack. */
  vertical: boolean
  /** Source node, so the editor can link selection. */
  nodeId: AnyNodeId
}

export type RiserMarker = {
  point: [number, number]
  kind: 'trap' | 'vent-termination' | 'fitting'
  label: string
  nodeId: AnyNodeId
}

export type RiserDiagram = {
  lines: RiserLine[]
  markers: RiserMarker[]
  /** Bounding box of all projected geometry, screen space. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** Elevation gain per horizontal meter under which a leg is "vertical". */
const VERTICAL_EPS = 4 // dy/dxz ratio: steeper than this reads as a stack

type Vec3 = readonly [number, number, number]

function legIsVertical(a: Vec3, b: Vec3): boolean {
  const horizontal = Math.hypot(b[0] - a[0], b[2] - a[2])
  const vertical = Math.abs(b[1] - a[1])
  if (horizontal < 1e-4) return true
  return vertical / horizontal > VERTICAL_EPS
}

/**
 * Build the riser diagram for the whole scene. Returns null when there's
 * no DWV geometry to draw.
 */
export function buildRiserDiagram(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): RiserDiagram | null {
  const lines: RiserLine[] = []
  const markers: RiserMarker[] = []

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (p: [number, number]) => {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  }

  for (const node of Object.values(nodes)) {
    if (!node) continue
    if (node.type === 'pipe-segment') {
      const path = node.path as Vec3[]
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!
        const b = path[i + 1]!
        const from = projectIso(a[0], a[1], a[2])
        const to = projectIso(b[0], b[1], b[2])
        grow(from)
        grow(to)
        lines.push({
          from,
          to,
          system: node.system,
          diameter: node.diameter,
          vertical: legIsVertical(a, b),
          nodeId: node.id,
        })
      }
      // Vent runs that end above everything are vent terminations
      // (through-roof). Tag the highest endpoint of a vent run.
      if (node.system === 'vent') {
        const top = path.reduce((hi, p) => (p[1] > hi[1] ? p : hi), path[0]!)
        const pt = projectIso(top[0], top[1], top[2])
        markers.push({
          point: pt,
          kind: 'vent-termination',
          label: `${node.diameter}" VTR`,
          nodeId: node.id,
        })
      }
    } else if (node.type === 'pipe-trap') {
      const pt = projectIso(node.position[0], node.position[1], node.position[2])
      grow(pt)
      markers.push({
        point: pt,
        kind: 'trap',
        label: `${node.diameter}" P-trap`,
        nodeId: node.id,
      })
    } else if (node.type === 'pipe-fitting') {
      const pt = projectIso(node.position[0], node.position[1], node.position[2])
      grow(pt)
      markers.push({
        point: pt,
        kind: 'fitting',
        label: node.fittingType,
        nodeId: node.id,
      })
    }
  }

  if (lines.length === 0 && markers.length === 0) return null

  return { lines, markers, bounds: { minX, minY, maxX, maxY } }
}
