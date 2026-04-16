import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { dominantPolygonAngle, setAxisAlignedPlanarUVs } from '../../lib/polygon-uv'
import type { AnyNodeId, CeilingNode, CeilingRegion } from '../../schema'
import useScene from '../../store/use-scene'

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
        updateCeilingGeometry(node as CeilingNode, mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  })

  return null
}

/**
 * Updates the geometry for a single ceiling
 */
function updateCeilingGeometry(node: CeilingNode, mesh: THREE.Mesh) {
  const newGeo = generateCeilingGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  const gridMesh = mesh.getObjectByName('ceiling-grid') as THREE.Mesh
  if (gridMesh) {
    gridMesh.geometry.dispose()
    gridMesh.geometry = newGeo
  }

  // Position at the ceiling height
  mesh.position.y = (node.height ?? 2.5) - 0.01 // Slight offset to avoid z-fighting with upper-level slabs
}

/**
 * Signed area of a 2D polygon. Positive = CCW, negative = CW.
 * Used for hole-winding correction in `buildShape` — Three.js Shape
 * triangulation requires holes to wind opposite to the outer contour,
 * or it cuts only a partial triangle out of the shape.
 */
function signedArea(polygon: ReadonlyArray<readonly [number, number]>): number {
  let a = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += polygon[i]![0] * polygon[j]![1]
    a -= polygon[j]![0] * polygon[i]![1]
  }
  return a / 2
}

/**
 * Build a Three.js Shape from a 2D polygon plus any hole polygons.
 * Extracted so the main ceiling path and the per-region path share
 * the same XZ-to-shape conversion logic. The `y = -z` negation is
 * load-bearing — Shape lives in the X-Y plane, and after the outer
 * `rotateX(-PI/2)` the shape's Y becomes the scene's -Z, so we have
 * to negate polygon's Z input up front to get the right world
 * orientation after rotation.
 *
 * Hole winding: Three.js ShapeGeometry triangulation (earcut) only
 * cuts holes correctly when the hole contour is wound OPPOSITE to
 * the outer contour. Same winding produces a partial cut (typically
 * a single triangle). `handleAddRegion` creates the default square
 * in CCW order, and RoomPlan ceiling polygons come out CCW too, so
 * we detect same-sign signed areas and reverse the hole in that case.
 * The `-z` negation flips both signs together so the comparison
 * stays valid.
 */
function buildShape(
  polygon: ReadonlyArray<readonly [number, number]>,
  holes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): THREE.Shape | null {
  if (polygon.length < 3) return null
  const outerSign = Math.sign(signedArea(polygon))
  const shape = new THREE.Shape()
  shape.moveTo(polygon[0]![0], -polygon[0]![1])
  for (let i = 1; i < polygon.length; i++) {
    shape.lineTo(polygon[i]![0], -polygon[i]![1])
  }
  shape.closePath()
  for (const rawHole of holes) {
    if (rawHole.length < 3) continue
    // Flip the hole's winding if it matches the outer contour.
    const holePolygon =
      Math.sign(signedArea(rawHole)) === outerSign ? [...rawHole].reverse() : rawHole
    const holePath = new THREE.Path()
    holePath.moveTo(holePolygon[0]![0], -holePolygon[0]![1])
    for (let i = 1; i < holePolygon.length; i++) {
      holePath.lineTo(holePolygon[i]![0], -holePolygon[i]![1])
    }
    holePath.closePath()
    shape.holes.push(holePath)
  }
  return shape
}

/**
 * Fill a `color` vertex attribute on the given geometry with a
 * single uniform RGB triple. Used to tint parts of the merged
 * ceiling buffer so the unlit ceiling material can still show
 * visual distinction between the flat main plane, the flat region
 * plane, and the vertical skirt (darker for shading).
 *
 * Must run BEFORE `mergeGeometries` — every sub-geometry that
 * enters the merge needs the same attribute set or the merge
 * rejects with null.
 */
function assignVertexColor(geometry: THREE.BufferGeometry, r: number, g: number, b: number): void {
  const positionAttr = geometry.getAttribute('position')
  if (!positionAttr) return
  const vertexCount = positionAttr.count
  const colors = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/**
 * Build the vertical skirt connecting a region plane to the main
 * ceiling plane. Without it, regions render as disconnected flat
 * sheets floating above or below the hole cut into the main ceiling.
 *
 * For each edge of the region polygon we emit a single quad (two
 * triangles) spanning the local Y range [bottomY, topY] — tray
 * ceilings get a skirt going up, soffits get one going down.
 *
 * Each quad is emitted with BOTH winding orders so it renders
 * regardless of which ceiling material (FrontSide bottomMaterial or
 * BackSide topMaterial) is active for the camera angle. Without this
 * double-sided emission the skirt only shows up from one side of the
 * well — tray ceilings look correct from orbit but become invisible
 * in walkthrough (camera inside the room looks up into the well
 * from the front-face side, which hits the transparent grid material).
 *
 * Returns null for degenerate inputs (<3 vertices or zero vertical
 * span) so the caller can skip the merge for flat regions.
 */
function buildRegionSkirt(
  polygon: ReadonlyArray<readonly [number, number]>,
  bottomY: number,
  topY: number,
): THREE.BufferGeometry | null {
  if (polygon.length < 3) return null
  if (Math.abs(topY - bottomY) < 1e-6) return null

  const n = polygon.length
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const vSpan = topY - bottomY

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x0 = polygon[i]![0]
    const z0 = polygon[i]![1]
    const x1 = polygon[j]![0]
    const z1 = polygon[j]![1]

    const dx = x1 - x0
    const dz = z1 - z0
    const edgeLen = Math.hypot(dx, dz)
    if (edgeLen < 1e-9) continue

    // Any non-zero horizontal normal is fine — the ceiling renderer
    // uses MeshBasicNodeMaterial (unlit), so normals don't drive
    // shading, only the vertex winding determines visibility via
    // FrontSide/BackSide. We set something sensible for the attribute.
    const nx = dz / edgeLen
    const nz = -dx / edgeLen

    const base = positions.length / 3
    // Four verts per edge: bottom-start, bottom-end, top-end, top-start.
    positions.push(x0, bottomY, z0)
    positions.push(x1, bottomY, z1)
    positions.push(x1, topY, z1)
    positions.push(x0, topY, z0)

    for (let k = 0; k < 4; k++) {
      normals.push(nx, 0, nz)
    }

    // Rectangular UVs scaled by world size so textures tile at their
    // natural scale regardless of edge length / skirt height.
    uvs.push(0, 0)
    uvs.push(edgeLen, 0)
    uvs.push(edgeLen, vSpan)
    uvs.push(0, vSpan)

    // Emit both winding orders: (0,1,2)+(0,2,3) for one side and
    // (0,2,1)+(0,3,2) for the reversed side. This gives the skirt
    // double-sided visibility within a single-sided mesh, which is
    // required because the ceiling renderer has to share geometry
    // between its FrontSide and BackSide sub-meshes.
    indices.push(base, base + 1, base + 2)
    indices.push(base, base + 2, base + 3)
    indices.push(base, base + 2, base + 1)
    indices.push(base, base + 3, base + 2)
  }

  if (positions.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

/**
 * Generates flat ceiling geometry from the node's polygon, optionally
 * with per-region sub-layers at different heights.
 *
 * When `ceilingNode.regions` is empty (the common case), this returns
 * a single `ShapeGeometry` of the outer polygon minus any
 * `ceilingNode.holes`, exactly like the old implementation.
 *
 * When regions are present, every region's polygon is ALSO subtracted
 * from the main shape as a hole (so the main ceiling doesn't
 * z-fight with the region below it), and each region is rendered as
 * its own flat `ShapeGeometry` translated vertically by
 * `region.height - ceilingNode.height` — the delta from the main
 * ceiling height, because the mesh's world Y position is set to the
 * main height elsewhere. All sub-geometries are then merged into one
 * `BufferGeometry` so the mesh stays single-draw-call and the grid
 * hover behaviour keeps working.
 *
 * Used for tray ceilings (inner region at higher height), soffits
 * (inner region at lower height), and multi-height rooms.
 */
export function generateCeilingGeometry(ceilingNode: CeilingNode): THREE.BufferGeometry {
  const polygon = ceilingNode.polygon
  if (polygon.length < 3) {
    return new THREE.BufferGeometry()
  }

  const mainHeight = ceilingNode.height ?? 2.5
  const regions: ReadonlyArray<CeilingRegion> = ceilingNode.regions ?? []
  const validRegions = regions.filter((r) => r.polygon.length >= 3)

  // Every valid region polygon doubles as a hole in the main ceiling:
  // the main plane would otherwise z-fight with (or completely cover)
  // the region plane below it.
  const mainHoles: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    ...(ceilingNode.holes ?? []),
    ...validRegions.map((r) => r.polygon),
  ]

  const mainShape = buildShape(polygon, mainHoles)
  if (!mainShape) return new THREE.BufferGeometry()

  const mainGeometry = new THREE.ShapeGeometry(mainShape)
  mainGeometry.rotateX(-Math.PI / 2)
  setAxisAlignedPlanarUVs(mainGeometry, dominantPolygonAngle(polygon))
  mainGeometry.computeVertexNormals()
  assignVertexColor(mainGeometry, 1, 1, 1)

  // Fast path: no regions, behave exactly like the pre-regions
  // implementation. Avoids the merge overhead for simple ceilings.
  if (validRegions.length === 0) {
    ensureUv2Attribute(mainGeometry)
    return mainGeometry
  }

  // Build a separate ShapeGeometry per region, translated vertically
  // by (region.height - mainHeight) so it sits at the right world Y
  // after the mesh's outer position is applied. Also emit a vertical
  // skirt along each region's polygon edges so tray ceilings and
  // soffits render as connected 3D shapes instead of disconnected
  // planes floating above/below the cut-out hole.
  const subGeometries: THREE.BufferGeometry[] = [mainGeometry]
  for (const region of validRegions) {
    const regionShape = buildShape(region.polygon, region.holes ?? [])
    if (!regionShape) continue
    const regionGeometry = new THREE.ShapeGeometry(regionShape)
    regionGeometry.rotateX(-Math.PI / 2)
    // Offset in Y by the delta from the main ceiling height. The
    // outer mesh.position.y already bakes in the main ceiling's
    // absolute world height, so each region only needs the relative
    // delta applied here.
    const delta = region.height - mainHeight
    regionGeometry.translate(0, delta, 0)
    setAxisAlignedPlanarUVs(regionGeometry, dominantPolygonAngle(region.polygon))
    regionGeometry.computeVertexNormals()
    assignVertexColor(regionGeometry, 1, 1, 1)
    subGeometries.push(regionGeometry)

    // Vertical skirt spanning [0, delta] in local Y (0 = main plane,
    // delta = region plane). For tray ceilings delta > 0 so the skirt
    // goes up; for soffits delta < 0 so it goes down. Both directions
    // are handled by `buildRegionSkirt` via min/max on the two Ys.
    const skirtGeometry = buildRegionSkirt(region.polygon, Math.min(0, delta), Math.max(0, delta))
    if (skirtGeometry) {
      // Darken the skirt so tray wells and soffit drops read as
      // visually distinct from the flat main ceiling. Without this
      // shading cue the unlit MeshBasicNodeMaterial renders the
      // whole geometry as one flat color and the user has no way
      // to tell there's a height change from inside the room.
      assignVertexColor(skirtGeometry, 0.62, 0.62, 0.62)
      subGeometries.push(skirtGeometry)
    }
  }

  const merged = mergeGeometries(subGeometries, false)
  if (!merged) {
    // mergeGeometries returns null when attribute sets don't match.
    // Shouldn't happen since every sub-geometry goes through the
    // same ShapeGeometry + normals + UVs pipeline, but if it does
    // fall back to the main plane alone and log so we notice.
    console.warn(
      '[ceiling-system] mergeGeometries failed for ceiling',
      ceilingNode.id,
      '— falling back to main polygon without regions.',
    )
    // Dispose the region geometries we won't use.
    for (let i = 1; i < subGeometries.length; i++) {
      subGeometries[i]!.dispose()
    }
    ensureUv2Attribute(mainGeometry)
    return mainGeometry
  }

  // mergeGeometries copies attributes into a brand-new BufferGeometry,
  // so the input geometries are safe to dispose now.
  for (const g of subGeometries) g.dispose()
  ensureUv2Attribute(merged)
  return merged
}
