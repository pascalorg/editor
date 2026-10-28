import { describe, expect, test } from 'bun:test'
import { DoorNode, OPENING_FRAME_LIP, useScene, WallNode } from '@pascal-app/core'
import * as THREE from 'three'
import { OPENING_CASING_MESH_NAME } from '../wall/opening-casing-geometry'
import { buildDoorPreviewMesh } from './door-system'

/**
 * A door's frame used to be 0.07 m deep whatever its wall, so a thicker wall showed its cut faces
 * around the frame. Left unset, the depth now follows the host wall: its thickness plus a lip on
 * each face. An explicit depth is still rendered as stored.
 */
function doorOn(wallThickness: number, patch: Partial<DoorNode> = {}) {
  const wall = WallNode.parse({
    id: `wall_frame_${wallThickness}`,
    start: [0, 0],
    end: [4, 0],
    thickness: wallThickness,
  })
  const door = DoorNode.parse({
    id: 'door_frame_test',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
    ...patch,
  })
  const previous = useScene.getState().nodes
  useScene.setState({ nodes: { ...previous, [wall.id]: wall } })
  const mesh = buildDoorPreviewMesh(door)
  useScene.setState({ nodes: previous })
  return mesh
}

/** The depth of the door's hit box: the frame's extent through the wall. */
function hitboxDepth(mesh: THREE.Mesh): number {
  const box = mesh.geometry as THREE.BoxGeometry
  return box.parameters.depth
}

/**
 * The deepest extent of the door's frame posts, in the door's own frame. The casing shares the
 * frame's paint but is trim on the wall faces, so it is left out.
 */
function frameExtent(mesh: THREE.Mesh): { min: number; max: number } {
  mesh.updateWorldMatrix(true, true)
  const toDoor = mesh.matrixWorld.clone().invert()
  const extent = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
  mesh.traverse((object) => {
    const part = object as THREE.Mesh
    if (
      !part.isMesh ||
      part === mesh ||
      part.name === 'cutout' ||
      part.name === OPENING_CASING_MESH_NAME ||
      part.userData.slotId !== 'frame'
    )
      return
    const box = new THREE.Box3().setFromObject(part).applyMatrix4(toDoor)
    extent.min = Math.min(extent.min, box.min.z)
    extent.max = Math.max(extent.max, box.max.z)
  })
  return extent
}

describe("a door's frame depth follows its wall", () => {
  test('a door with no frame depth in a 0.2 m wall gets a 0.22 m frame', () => {
    const mesh = doorOn(0.2)
    expect(hitboxDepth(mesh)).toBeCloseTo(0.2 + OPENING_FRAME_LIP * 2, 9)
    const extent = frameExtent(mesh)
    expect(extent.max).toBeCloseTo(0.11, 6)
    expect(extent.min).toBeCloseTo(-0.11, 6)
  })

  test('an explicit 0.07 m frame stays 0.07 m in a 0.2 m wall', () => {
    const mesh = doorOn(0.2, { frameDepth: 0.07 })
    expect(hitboxDepth(mesh)).toBeCloseTo(0.07, 9)
    const extent = frameExtent(mesh)
    expect(extent.max).toBeCloseTo(0.035, 6)
    expect(extent.min).toBeCloseTo(-0.035, 6)
  })

  test('the same door on a thicker wall re-resolves', () => {
    expect(hitboxDepth(doorOn(0.1))).toBeCloseTo(0.12, 9)
    expect(hitboxDepth(doorOn(0.35))).toBeCloseTo(0.37, 9)
  })
})
