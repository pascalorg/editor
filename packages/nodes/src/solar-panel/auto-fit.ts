import {
  type AnyNode,
  difference,
  intersection,
  nodeRegistry,
  type Ring,
  type RoofSegmentNode,
  type SolarPanelNode,
} from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import * as THREE from 'three'
import { roofFootprintInsideTrim } from '../shared/roof-footprint-trim'
import { getRoofSurfaceFaceBoundsAt, surfaceQuatFromNormal } from '../shared/roof-surface'
import { roofSurfaceFootprintFromNode } from '../shared/roof-surface-placement-guides'
import { solarPanelMountLift } from './geometry'

function hull(points: Ring): Ring {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: Ring[number], b: Ring[number], c: Ring[number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (vertices: Ring) => {
    const result: Ring = []
    for (const point of vertices) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop()
      result.push(point)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

function projectedBox(
  width: number,
  depth: number,
  bottom: number,
  top: number,
  position: readonly number[],
  rotation: THREE.Quaternion,
): Ring {
  const points: Ring = []
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      for (const y of [bottom, top]) {
        const p = new THREE.Vector3(x, y, z).applyQuaternion(rotation)
        points.push([p.x + position[0]!, p.z + position[2]!])
      }
    }
  }
  return hull(points)
}

function panelRotation(segment: RoofSegmentNode, panel: SolarPanelNode): THREE.Quaternion {
  const frame = getRoofOuterSurfaceFrameAtPoint(segment, panel.position[0], panel.position[2])
  return surfaceQuatFromNormal(frame.normal, new THREE.Quaternion())
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), panel.rotation))
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        panel.mountingType === 'tilted' ? (panel.tiltAngle * Math.PI) / 180 : 0,
      ),
    )
}

/** The projected outer envelope, including the frame and its mounting height. */
export function solarPanelFootprint(segment: RoofSegmentNode, panel: SolarPanelNode): Ring {
  return projectedBox(
    panel.columns * panel.panelWidth + (panel.columns - 1) * panel.gapX,
    panel.rows * panel.panelHeight + (panel.rows - 1) * panel.gapY,
    panel.standoffHeight + solarPanelMountLift(panel),
    panel.standoffHeight + solarPanelMountLift(panel) + panel.frameDepth,
    panel.position,
    panelRotation(segment, panel),
  )
}

/** Conservative occupied envelopes, including skylights and dormer roof openings. */
export function solarPanelObstacles(
  segment: RoofSegmentNode,
  panel: SolarPanelNode,
  nodes: readonly AnyNode[],
): Ring[] {
  const obstacles: Ring[] = []
  for (const node of nodes) {
    if (node.id === panel.id || !nodeRegistry.get(node.type)?.capabilities.roofAccessory) continue
    if (!('roofSegmentId' in node) || node.roofSegmentId !== segment.id) continue
    if (node.type === 'solar-panel') {
      obstacles.push(solarPanelFootprint(segment, node))
      continue
    }
    if (!('position' in node) || !Array.isArray(node.position)) continue
    const footprint = roofSurfaceFootprintFromNode(node, { segment })
    const upright =
      node.type === 'chimney' ||
      node.type === 'dormer' ||
      node.type === 'ridge-vent' ||
      node.type === 'gutter'
    const rotation = upright
      ? new THREE.Quaternion()
      : surfaceQuatFromNormal(
          getRoofOuterSurfaceFrameAtPoint(segment, node.position[0], node.position[2]).normal,
          new THREE.Quaternion(),
        )
    rotation.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), footprint.rotation ?? 0),
    )
    const height =
      'height' in node && typeof node.height === 'number' ? Math.max(0, node.height) : 0
    obstacles.push(
      projectedBox(footprint.width, footprint.depth, 0, height, node.position, rotation),
    )
  }
  return obstacles
}

/** Maximize panel count at the current center and orientation, without crossing a face or obstacle. */
export function computeAutoFit(
  segment: RoofSegmentNode,
  panel: SolarPanelNode,
  obstacles: readonly Ring[] = [],
): { rows: number; columns: number } | null {
  if (!(panel.panelWidth > 0 && panel.panelHeight > 0 && panel.gapX >= 0 && panel.gapY >= 0))
    return null
  const face = getRoofSurfaceFaceBoundsAt(segment, panel.position[0], panel.position[2]).polygon
  let best: { rows: number; columns: number } | null = null
  for (let rows = 1; rows <= 20; rows++) {
    for (let columns = 1; columns <= 20; columns++) {
      if (best && rows * columns <= best.rows * best.columns) continue
      const footprint = solarPanelFootprint(segment, { ...panel, rows, columns })
      if (footprint.length < 3 || !roofFootprintInsideTrim(segment, footprint)) continue
      if (difference(footprint, face, { throwOnError: true }).length > 0) continue
      if (obstacles.some((obstacle) => intersection(footprint, obstacle).length > 0)) continue
      best = { rows, columns }
    }
  }
  return best
}
