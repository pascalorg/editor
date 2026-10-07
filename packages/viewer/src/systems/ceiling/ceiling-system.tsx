import {
  type AnyNodeId,
  CEILING_DRAW_OFFSET,
  CEILING_SURFACE_ROLE,
  type CeilingNode,
  type CeilingSurfaceCell,
  ceilingPaintRegions,
  computeCeilingSurfaceCells,
  getEffectiveCutterNode,
  getEffectiveNode,
  hostedCutterHoles,
  isScriptedNode,
  type MultiPolygon,
  nodeRegistry,
  resolveCeilingHeight,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mergeSurfaceHolePolygons } from '../surface-hole-geometry'

/** Name of the meshes a ceiling draws its paint regions with, one per region. */
export const CEILING_REGION_MESH = 'ceiling-region'

/**
 * The material a ceiling draws a region finish with. The ceiling's renderer
 * owns materials (theme, textures, scene materials) and leaves this on the
 * registered mesh; the system builds geometry and asks it.
 */
export type CeilingRegionMaterial = (finish: CeilingSurfaceCell['finish']) => THREE.Material

type SceneNodes = ReturnType<typeof useScene.getState>['nodes']

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
      if (node?.type !== 'ceiling') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        // Merge any live drag override so the polygon / height resize
        // arrow rebuilds the mesh at pointer rate — zustand only learns
        // the final value on commit. Mirrors WallSystem / GeometrySystem.
        const effective = getEffectiveNode(node as CeilingNode)
        const itemHoles = collectCeilingHoles(effective, nodes)
        updateCeilingGeometry(effective, mesh, itemHoles, nodes)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  }, 2)

  return null
}

/**
 * Collects ceiling-hole polygons from child nodes that declare the `ceilingCut`
 * capability. Each child's `buildCeilingHole` returns a rotated-rectangle
 * footprint in ceiling-local [x, z] space (or `null` to opt out), which is
 * merged as an extra hole before triangulation.
 *
 * The viewer never branches on `child.type` — the dispatch goes through
 * `nodeRegistry`, so any future kind (a heat lamp, a skylight panel, …) can
 * participate just by declaring `capabilities.ceilingCut` on its definition.
 */
function collectCeilingHoles(
  ceiling: CeilingNode,
  nodes: SceneNodes,
): Array<Array<[number, number]>> {
  // Only the ceiling's own children can bind to it.
  const hosted: SceneNodes = { [ceiling.id]: ceiling }
  for (const childId of ceiling.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (child) hosted[child.id] = getEffectiveCutterNode(child)
  }
  const holes = hostedCutterHoles(ceiling, hosted)

  for (const childId of ceiling.children ?? []) {
    const child = nodes[childId as AnyNodeId]
    if (!child) continue
    if (isScriptedNode(child) && child.source.manifest.cutters?.length) continue
    const def = nodeRegistry.get(child.type)
    const hole = def?.capabilities?.ceilingCut?.buildCeilingHole(child)
    if (hole) holes.push(hole)
  }
  for (const [, def] of nodeRegistry.entries())
    holes.push(...(def.capabilities?.ceilingCut?.holesFor?.(ceiling) ?? []))

  return holes
}

/**
 * Updates the geometry for a single ceiling
 */
export function updateCeilingGeometry(
  node: CeilingNode,
  mesh: THREE.Mesh,
  extraHoles: Array<Array<[number, number]>> = [],
  nodes: SceneNodes = useScene.getState().nodes,
) {
  const newGeo = generateCeilingGeometry(node, extraHoles)
  // Painted regions partition the underside: the ceiling's own mesh keeps what
  // no region covers, and each region draws as its own single-material mesh,
  // so batching buckets them by material like any other surface.
  const regions = node.polygon.length >= 3 ? ceilingPaintRegions(node, nodes) : []
  const cells = regions.length
    ? computeCeilingSurfaceCells(
        node.polygon,
        [...mergeSurfaceHolePolygons(node.holes || []), ...extraHoles],
        regions,
      )
    : null
  const surface = cells?.find((cell) => cell.role === CEILING_SURFACE_ROLE)

  mesh.geometry.dispose()
  mesh.geometry = cells ? flatCeilingGeometry(surface?.polygons ?? []) : newGeo
  mesh.userData.paintRole = CEILING_SURFACE_ROLE
  syncCeilingRegionMeshes(
    mesh,
    (cells ?? []).filter((cell) => cell.role !== CEILING_SURFACE_ROLE),
  )

  const gridMesh = mesh.getObjectByName('ceiling-grid') as THREE.Mesh
  if (gridMesh) {
    gridMesh.geometry.dispose()
    gridMesh.geometry = cells ? newGeo : newGeo.clone()
  } else if (cells) {
    newGeo.dispose()
  }

  // Position at the ceiling height and reset X/Z so live-drag mesh
  // offsets (set by move tools during the drag) don't leak into the
  // canonical position after the rebuild. Matches the pattern used by
  // FenceSystem.updateFenceGeometry / GeometrySystem (both fully reset
  // position+rotation after rebuild).
  const liveTransform = useLiveTransforms.getState().get(node.id)
  mesh.position.x = liveTransform?.position[0] ?? 0
  mesh.position.z = liveTransform?.position[2] ?? 0
  // Resolved height: explicit when stored, else the level-top bound — so a
  // follows-mode ceiling re-parks under the current plane on every rebuild
  // (level-height edits / covering-slab changes dirty-mark ceilings).
  // Slight offset to avoid z-fighting with upper-level slabs.
  mesh.position.y =
    resolveCeilingHeight(node, nodes) - CEILING_DRAW_OFFSET + (liveTransform?.position[1] ?? 0)
}

/**
 * One child mesh per region cell, reused by position so a repaint keeps its
 * mesh; surplus meshes go. The material comes from the renderer's resolver.
 */
function syncCeilingRegionMeshes(mesh: THREE.Mesh, cells: readonly CeilingSurfaceCell[]) {
  const existing = mesh.children.filter(
    (child): child is THREE.Mesh =>
      (child as THREE.Mesh).isMesh && child.name === CEILING_REGION_MESH,
  )
  const resolve = mesh.userData.ceilingRegionMaterial as CeilingRegionMaterial | undefined
  cells.forEach((cell, index) => {
    let region = existing[index]
    if (!region) {
      region = new THREE.Mesh()
      region.name = CEILING_REGION_MESH
      mesh.add(region)
    } else region.geometry.dispose()
    region.geometry = flatCeilingGeometry(cell.polygons)
    region.userData.paintRole = cell.role
    region.userData.finish = cell.finish
    region.userData.__fromGeometry = true
    region.material = resolve?.(cell.finish) ?? (mesh.material as THREE.Material)
  })
  for (const surplus of existing.slice(cells.length)) {
    surplus.geometry.dispose()
    surplus.removeFromParent()
  }
}

/** Flat geometry for level-XZ pieces, laid out the way `generateCeilingGeometry` lays a ceiling. */
function flatCeilingGeometry(pieces: MultiPolygon): THREE.BufferGeometry {
  const parts = pieces
    .filter((piece) => piece.outer.length >= 3)
    .map((piece) => {
      const shape = new THREE.Shape(piece.outer.map(([x, z]) => new THREE.Vector2(x, -z)))
      for (const hole of piece.holes)
        if (hole.length >= 3)
          shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))))
      const geometry = new THREE.ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      geometry.computeVertexNormals()
      ensureUv2Attribute(geometry)
      return geometry
    })
  if (parts.length === 0) return generateCeilingGeometry({ polygon: [] } as unknown as CeilingNode)
  if (parts.length === 1) return parts[0]!
  const merged = mergeGeometries(parts) ?? parts[0]!
  for (const part of parts) if (part !== merged) part.dispose()
  return merged
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
    degenerate.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    degenerate.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
    degenerate.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
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
