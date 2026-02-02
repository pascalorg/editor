import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import type { AnyNodeId, RoofNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// ROOF GEOMETRY CONSTANTS
// ============================================================================

const THICKNESS_A = 0.05 // Roof cover thickness (5cm)
const THICKNESS_B = 0.1 // Structure thickness (10cm)
const ROOF_COVER_OVERHANG = 0.05 // Extension of cover past structure (5cm)
const EAVE_OVERHANG = 0.4 // Horizontal eave overhang (40cm)
const RAKE_OVERHANG = 0.3 // Overhang at gable ends (30cm)
const WALL_THICKNESS = 0.2 // Gable wall thickness (20cm)
const BASE_HEIGHT = 0.5 // Base height / knee wall / truss heel (50cm)

// ============================================================================
// ROOF SYSTEM
// ============================================================================

export const RoofSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    // Process dirty roofs
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'roof') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateRoofGeometry(node as RoofNode, mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  })

  return null
}

/**
 * Updates the geometry and transform for a single roof
 */
function updateRoofGeometry(node: RoofNode, mesh: THREE.Mesh) {
  const newGeo = generateRoofGeometry(node)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // Update position and rotation
  mesh.position.set(node.position[0], node.position[1], node.position[2])
  mesh.rotation.y = node.rotation
}

/**
 * Helper to solve pitch angle analytically given rise, run and thicknesses
 * Solves: run * tan(a) + (ThickA + ThickB)/cos(a) = rise
 */
function solvePitch(rise: number, run: number, thickA: number, thickB: number): number {
  const T = thickA + thickB
  if (run < 0.01) return 0

  const R = Math.sqrt(run * run + rise * rise)
  if (R <= T) {
    return Math.atan2(rise, run) * 0.5 // Fallback
  }

  const phi = Math.atan2(rise, run)
  const shift = Math.asin(T / R)

  return phi - shift
}

/**
 * Helper to create a Three.js Shape from polygon points
 */
function createShape(points: { x: number; y: number }[]): THREE.Shape {
  const shape = new THREE.Shape()
  if (points.length === 0) return shape
  const firstPoint = points[0]
  if (!firstPoint) return shape
  shape.moveTo(firstPoint.x, firstPoint.y)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point) {
      shape.lineTo(point.x, point.y)
    }
  }
  shape.closePath()
  return shape
}

/**
 * Generate profile for one side of the roof (left or right)
 */
function getSideProfile(
  dir: 1 | -1,
  width: number,
  roofHeight: number,
): {
  pointsA: { x: number; y: number }[]
  pointsB: { x: number; y: number }[]
  pointsSide: { x: number; y: number }[]
  pointsC1: { x: number; y: number }[]
  pointsC2: { x: number; y: number }[]
} {
  const halfWall = WALL_THICKNESS / 2

  const rise = Math.max(0, roofHeight - BASE_HEIGHT)
  const run = width - halfWall

  const angle = solvePitch(rise, run, THICKNESS_A, THICKNESS_B)
  const tanA = Math.tan(angle)
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)

  const ridgeUnderY = BASE_HEIGHT + run * tanA
  const ridgeInterfaceY = ridgeUnderY + THICKNESS_B / cosA
  const ridgeTopY = ridgeInterfaceY + THICKNESS_A / cosA

  const wallOuterTopY = BASE_HEIGHT - WALL_THICKNESS * tanA

  const overhangDx = EAVE_OVERHANG * cosA

  const eaveTopZ = width + halfWall + overhangDx
  const eaveTopY = ridgeTopY - eaveTopZ * tanA

  const coverExtDx = ROOF_COVER_OVERHANG * cosA
  const coverExtDy = ROOF_COVER_OVERHANG * sinA

  const eaveTopExtZ = eaveTopZ + coverExtDx
  const eaveTopExtY = eaveTopY - coverExtDy

  const eaveInterfaceExtZ = eaveTopExtZ - THICKNESS_A * sinA
  const eaveInterfaceExtY = eaveTopExtY - THICKNESS_A * cosA

  const eaveInterfaceZ = eaveTopZ

  const eaveBottomZ = eaveTopZ
  const eaveBottomY = ridgeUnderY - eaveTopZ * tanA

  // Layer A (Cover)
  const pointsA = [
    { x: 0, y: ridgeTopY },
    { x: dir * eaveTopExtZ, y: eaveTopExtY },
    { x: dir * eaveInterfaceExtZ, y: eaveInterfaceExtY },
    { x: 0, y: ridgeInterfaceY },
  ]

  // Layer B (Structure)
  const pointsB = [
    { x: 0, y: ridgeInterfaceY },
    { x: dir * eaveInterfaceZ, y: ridgeInterfaceY - eaveTopZ * tanA },
    { x: dir * eaveBottomZ, y: eaveBottomY },
    { x: 0, y: ridgeUnderY },
  ]

  // Side Wall
  const zInner = width - halfWall
  const zOuter = width + halfWall

  const pointsSide = [
    { x: dir * zInner, y: 0 },
    { x: dir * zOuter, y: 0 },
    { x: dir * zOuter, y: Math.max(0, wallOuterTopY) },
    { x: dir * zInner, y: BASE_HEIGHT },
  ]

  // Gable Top (C1)
  const pointsC1 = [
    { x: 0, y: BASE_HEIGHT },
    { x: dir * zInner, y: BASE_HEIGHT },
    { x: dir * zInner, y: BASE_HEIGHT },
    { x: 0, y: ridgeUnderY },
  ]

  // Gable Base (C2)
  const pointsC2 = [
    { x: 0, y: 0 },
    { x: dir * zInner, y: 0 },
    { x: dir * zInner, y: BASE_HEIGHT },
    { x: 0, y: BASE_HEIGHT },
  ]

  return { pointsA, pointsB, pointsSide, pointsC1, pointsC2 }
}

/**
 * Generates detailed gable roof geometry with layers, walls, and overhangs
 */
export function generateRoofGeometry(roofNode: RoofNode): THREE.BufferGeometry {
  const { length, height, leftWidth, rightWidth } = roofNode

  const ridgeLength = length

  // Get profiles for both sides
  const leftP = getSideProfile(1, leftWidth, height)
  const rightP = getSideProfile(-1, rightWidth, height)

  // Create shapes from profiles
  const shapes = {
    ALeft: createShape(leftP.pointsA),
    ARight: createShape(rightP.pointsA),
    BLeft: createShape(leftP.pointsB),
    BRight: createShape(rightP.pointsB),
    SideLeft: createShape(leftP.pointsSide),
    SideRight: createShape(rightP.pointsSide),
    C1Left: createShape(leftP.pointsC1),
    C1Right: createShape(rightP.pointsC1),
    C2Left: createShape(leftP.pointsC2),
    C2Right: createShape(rightP.pointsC2),
  }

  // Calculate extrusion lengths and offsets
  const lengths = {
    A: ridgeLength + 2 * RAKE_OVERHANG + 2 * ROOF_COVER_OVERHANG + WALL_THICKNESS,
    B: ridgeLength + 2 * RAKE_OVERHANG + WALL_THICKNESS,
    Side: ridgeLength + WALL_THICKNESS,
    Gable: WALL_THICKNESS,
  }

  const offsets = {
    A: -RAKE_OVERHANG - ROOF_COVER_OVERHANG - WALL_THICKNESS / 2,
    B: -RAKE_OVERHANG - WALL_THICKNESS / 2,
    Side: -WALL_THICKNESS / 2,
    GableFront: -WALL_THICKNESS / 2,
    GableBack: ridgeLength - WALL_THICKNESS / 2,
  }

  // Helper to create and position extruded geometry
  const createPart = (shape: THREE.Shape, depth: number, xOffset: number) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    // Rotate to align: extrusion goes along X axis
    geo.rotateY(Math.PI / 2)
    geo.translate(xOffset, 0, 0)
    return geo
  }

  // Create all parts
  const geometries: THREE.BufferGeometry[] = []

  // Layer A (Cover) - both sides
  geometries.push(createPart(shapes.ALeft, lengths.A, offsets.A))
  geometries.push(createPart(shapes.ARight, lengths.A, offsets.A))

  // Layer B (Structure) - both sides
  geometries.push(createPart(shapes.BLeft, lengths.B, offsets.B))
  geometries.push(createPart(shapes.BRight, lengths.B, offsets.B))

  // Side Walls - both sides
  geometries.push(createPart(shapes.SideLeft, lengths.Side, offsets.Side))
  geometries.push(createPart(shapes.SideRight, lengths.Side, offsets.Side))

  // Gable Walls (Front)
  geometries.push(createPart(shapes.C1Left, lengths.Gable, offsets.GableFront))
  geometries.push(createPart(shapes.C1Right, lengths.Gable, offsets.GableFront))
  geometries.push(createPart(shapes.C2Left, lengths.Gable, offsets.GableFront))
  geometries.push(createPart(shapes.C2Right, lengths.Gable, offsets.GableFront))

  // Gable Walls (Back)
  geometries.push(createPart(shapes.C1Left, lengths.Gable, offsets.GableBack))
  geometries.push(createPart(shapes.C1Right, lengths.Gable, offsets.GableBack))
  geometries.push(createPart(shapes.C2Left, lengths.Gable, offsets.GableBack))
  geometries.push(createPart(shapes.C2Right, lengths.Gable, offsets.GableBack))

  // Merge all geometries
  const mergedGeometry = new THREE.BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (const geo of geometries) {
    const posAttr = geo.getAttribute('position')
    const normAttr = geo.getAttribute('normal')
    const uvAttr = geo.getAttribute('uv')

    if (posAttr) {
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      }
    }
    if (normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
      }
    }
    if (uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        uvs.push(uvAttr.getX(i), uvAttr.getY(i))
      }
    }

    geo.dispose()
  }

  mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  mergedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  if (uvs.length > 0) {
    mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  }

  mergedGeometry.computeVertexNormals()

  // Center the geometry at X=0 (translate by -ridgeLength/2)
  // This matches the old geometry centering behavior
  mergedGeometry.translate(-ridgeLength / 2, 0, 0)

  return mergedGeometry
}
