import { getOpenRoofValleys, type RoofSegmentNode, type RoofValleyPoint } from '@pascal-app/core'
import * as THREE from 'three'

export function buildOpenValleyGeometry(
  segments: readonly RoofSegmentNode[],
  width: number,
): THREE.BufferGeometry {
  const valleys = getOpenRoofValleys(segments, width)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const valley of valleys) {
    appendPanel(valley.start, valley.end, valley.firstEdge[0], valley.firstEdge[1])
    appendPanel(valley.end, valley.start, valley.secondEdge[1], valley.secondEdge[0])
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  if (positions.length > 0) {
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  } else {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
    geometry.setIndex([0, 1, 2])
  }
  return geometry

  function appendPanel(
    centerStart: RoofValleyPoint,
    centerEnd: RoofValleyPoint,
    edgeStart: RoofValleyPoint,
    edgeEnd: RoofValleyPoint,
  ) {
    const baseIndex = positions.length / 3
    const length = Math.hypot(
      centerEnd.x - centerStart.x,
      centerEnd.y - centerStart.y,
      centerEnd.z - centerStart.z,
    )
    pushPoint(centerStart)
    pushPoint(edgeStart)
    pushPoint(centerEnd)
    pushPoint(edgeEnd)
    uvs.push(0, 0, width / 2, 0, 0, length, width / 2, length)
    indices.push(
      baseIndex,
      baseIndex + 1,
      baseIndex + 2,
      baseIndex + 2,
      baseIndex + 1,
      baseIndex + 3,
    )
  }

  function pushPoint(point: RoofValleyPoint) {
    positions.push(point.x, point.y, point.z)
  }
}
