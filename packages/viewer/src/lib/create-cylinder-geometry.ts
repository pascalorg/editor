import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { computeBoundsTree } from 'three-mesh-bvh'

const csgEvaluator = new Evaluator()

function computeGeometryBoundsTree(geometry: THREE.BufferGeometry) {
  ;(geometry as any).computeBoundsTree = computeBoundsTree
  ;(geometry as any).computeBoundsTree({ maxLeafSize: 10 })
}

/**
 * Creates a cylinder geometry — solid or hollow.
 * When wallThickness is provided, uses CSG subtraction (outer − inner).
 */
export function createCylinderGeometry(params: {
  radius: number
  height: number
  radialSegments: number
  wallThickness?: number
}): THREE.BufferGeometry {
  const { radius, height, radialSegments, wallThickness } = params

  if (wallThickness == null || wallThickness <= 0) {
    return new THREE.CylinderGeometry(radius, radius, height, radialSegments)
  }

  const innerRadius = radius - wallThickness
  if (innerRadius <= 0.001) {
    return new THREE.CylinderGeometry(radius, radius, height, radialSegments)
  }

  const outerGeo = new THREE.CylinderGeometry(radius, radius, height, radialSegments)
  // Slightly taller inner cylinder to avoid coplanar faces at top/bottom
  const innerGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, height + 0.02, radialSegments)

  computeGeometryBoundsTree(outerGeo)
  computeGeometryBoundsTree(innerGeo)

  const outerBrush = new Brush(outerGeo)
  const innerBrush = new Brush(innerGeo)
  innerBrush.position.y = -0.01

  const result = csgEvaluator.evaluate(outerBrush, innerBrush, SUBTRACTION)
  const resultGeo = result.geometry

  // Guard against empty CSG results (e.g., degenerate wall thickness)
  const posAttr = resultGeo.getAttribute('position')
  if (!posAttr || posAttr.count === 0) {
    outerGeo.dispose()
    innerGeo.dispose()
    resultGeo.dispose()
    return new THREE.CylinderGeometry(radius, radius, height, radialSegments)
  }

  resultGeo.computeVertexNormals()

  outerGeo.dispose()
  innerGeo.dispose()

  return resultGeo
}
