// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, DoorNode, sceneRegistry, WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateExtrudedWall } from './wall-system'

describe('wall opening cutout', () => {
  test('cuts a floor-level door directly from node geometry without a proxy mesh', () => {
    const wall = WallNode.parse({
      id: 'wall_floor-opening-cutout',
      start: [0, 0],
      end: [2, 0],
      height: 2.5,
      thickness: 0.1,
    })
    const door = DoorNode.parse({
      id: 'door_floor-opening-cutout',
      wallId: wall.id,
      position: [1, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const wallMesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, wallMesh)

    try {
      const geometry = generateExtrudedWall(wall, [door], calculateLevelMiters([wall]))
      const position = geometry.getAttribute('position')
      const index = geometry.index
      const openingLeft = door.position[0] - door.width / 2
      const openingRight = door.position[0] + door.width / 2
      let wallFaceTrianglesInsideOpening = 0
      let baseTrianglesInsideOpening = 0

      for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
        const indices = [0, 1, 2].map((corner) =>
          index ? index.getX(offset + corner) : offset + corner,
        )
        const vertices = indices.map(
          (vertexIndex) =>
            new THREE.Vector3(
              position.getX(vertexIndex),
              position.getY(vertexIndex),
              position.getZ(vertexIndex),
            ),
        )
        const centroid = vertices
          .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
          .multiplyScalar(1 / 3)
        const insideOpeningX = centroid.x > openingLeft + 1e-4 && centroid.x < openingRight - 1e-4
        if (!insideOpeningX) continue

        const onWallFace = vertices.every(
          (vertex) => Math.abs(Math.abs(vertex.z) - (wall.thickness ?? 0.1) / 2) < 1e-5,
        )
        if (onWallFace && centroid.y > 1e-4 && centroid.y < door.height - 1e-4) {
          wallFaceTrianglesInsideOpening += 1
        }

        if (vertices.every((vertex) => Math.abs(vertex.y) < 1e-5)) {
          baseTrianglesInsideOpening += 1
        }
      }

      expect(wallFaceTrianglesInsideOpening).toBe(0)
      expect(baseTrianglesInsideOpening).toBe(0)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
      wallMesh.geometry.dispose()
    }
  })
})
