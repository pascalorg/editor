import {
  type AnyNodeId,
  type CeilingNode,
  getEffectiveNode,
  getScaledDimensions,
  type ItemNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeSurfaceHolePolygons } from '../surface-hole-geometry'

type SceneNodes = ReturnType<typeof useScene.getState>['nodes']

// Recessed-fixture cutouts are inset slightly inside the item footprint so the
// fixture's trim (its widest part, sitting in the ceiling plane) overlaps the
// solid ceiling around the opening and hides the cut edge.
const RECESSED_HOLE_INSET = 0.82

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

// ============================================================================
// CEILING SYSTEM
// ============================================================================

export const CeilingSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes
    // Process dirty ceilings
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'ceiling') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        // Merge any live drag override so the polygon / height resize
        // arrow rebuilds the mesh at pointer rate — zustand only learns
        // the final value on commit. Mirrors WallSystem / GeometrySystem.
        const effective = getEffectiveNode(node as CeilingNode)
        const itemHoles = collectRecessedItemHoles(effective, nodes)
        updateCeilingGeometry(effective, mesh, itemHoles)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  })

  return null
}

/**
 * Footprint cutouts for the ceiling's recessed child fixtures (e.g. recessed
 * downlights). Each is a rotated rectangle in ceiling-local [x, z] space — the
 * same space as `ceilingNode.polygon` — derived from the item's scaled
 * dimensions and 2D position/yaw. Returned as extra holes so the cutout tracks
 * the item automatically: adding, moving, or deleting a child re-dirties the
 * ceiling (see node-actions / item renderer), which rebuilds this geometry.
 */
function collectRecessedItemHoles(
  ceiling: CeilingNode,
  nodes: SceneNodes,
): Array<Array<[number, number]>> {
  const holes: Array<Array<[number, number]>> = []

  for (const childId of ceiling.children ?? []) {
    const child = nodes[childId] as ItemNode | undefined
    if (!child || child.type !== 'item') continue
    if (!child.asset.recessed || child.asset.attachTo !== 'ceiling') continue

    const [width, , depth] = getScaledDimensions(child)
    const halfW = (width / 2) * RECESSED_HOLE_INSET
    const halfD = (depth / 2) * RECESSED_HOLE_INSET
    const cx = child.position[0]
    const cz = child.position[2]
    const yaw = child.rotation?.[1] ?? 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)

    // Corners of the (inset) footprint, rotated about Y and translated to the
    // item's plan position. Y-rotation of (dx, dz): (dx·cos + dz·sin, -dx·sin + dz·cos).
    const offsets: Array<[number, number]> = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ]
    const corners: Array<[number, number]> = offsets.map(([dx, dz]) => [
      cx + dx * cos + dz * sin,
      cz - dx * sin + dz * cos,
    ])

    holes.push(corners)
  }

  return holes
}

/**
 * Updates the geometry for a single ceiling
 */
function updateCeilingGeometry(
  node: CeilingNode,
  mesh: THREE.Mesh,
  extraHoles: Array<Array<[number, number]>> = [],
) {
  const newGeo = generateCeilingGeometry(node, extraHoles)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  const gridMesh = mesh.getObjectByName('ceiling-grid') as THREE.Mesh
  if (gridMesh) {
    gridMesh.geometry.dispose()
    gridMesh.geometry = newGeo.clone()
  }

  // Position at the ceiling height and reset X/Z so live-drag mesh
  // offsets (set by move tools during the drag) don't leak into the
  // canonical position after the rebuild. Matches the pattern used by
  // FenceSystem.updateFenceGeometry / GeometrySystem (both fully reset
  // position+rotation after rebuild).
  mesh.position.x = 0
  mesh.position.z = 0
  mesh.position.y = (node.height ?? 2.5) - 0.01 // Slight offset to avoid z-fighting with upper-level slabs
}

/**
 * Generates flat ceiling geometry from polygon (no extrusion).
 *
 * `extraHoles` are transient, derived cutouts (e.g. recessed-fixture
 * footprints) that are cut alongside the node's persisted `holes` but never
 * stored on the node — they are recomputed on every rebuild.
 */
export function generateCeilingGeometry(
  ceilingNode: CeilingNode,
  extraHoles: Array<Array<[number, number]>> = [],
): THREE.BufferGeometry {
  const polygon = ceilingNode.polygon

  if (polygon.length < 3) {
    // A degenerate ceiling (fewer than 3 points, e.g. mid-edit) still gets a
    // non-empty position buffer — three zero-vertices forming one invisible
    // triangle. An empty attribute (count 0) would leave WebGPU vertex buffer
    // slot 0 unbound when this mesh (and its cloned grid overlay) is drawn,
    // which the validator rejects ("slot 0 … was not set") and which poisons
    // the whole command encoder.
    const degenerate = new THREE.BufferGeometry()
    degenerate.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    return degenerate
  }

  // Create shape from polygon
  // Shape is in X-Y plane, we'll rotate to X-Z plane
  const shape = new THREE.Shape()
  const firstPt = polygon[0]!

  // Negate Y (which becomes Z) to get correct orientation after rotation
  shape.moveTo(firstPt[0], -firstPt[1])

  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i]!
    shape.lineTo(pt[0], -pt[1])
  }
  shape.closePath()

  // Add holes to the shape: persisted structural openings (stair/elevator/
  // manual, merged to dissolve overlaps) plus transient recessed-fixture
  // cutouts. Both are in the same ceiling-local [x, z] space.
  const holes = [...mergeSurfaceHolePolygons(ceilingNode.holes || []), ...extraHoles]
  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue

    const holePath = new THREE.Path()
    const holeFirstPt = holePolygon[0]!
    holePath.moveTo(holeFirstPt[0], -holeFirstPt[1])

    for (let i = 1; i < holePolygon.length; i++) {
      const pt = holePolygon[i]!
      holePath.lineTo(pt[0], -pt[1])
    }
    holePath.closePath()

    shape.holes.push(holePath)
  }

  // Create flat shape geometry (no extrusion)
  const geometry = new THREE.ShapeGeometry(shape)

  // Rotate so the shape lies flat in X-Z plane
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  ensureUv2Attribute(geometry)

  return geometry
}
