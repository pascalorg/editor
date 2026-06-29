// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildDoorPreviewMesh, poseDoorMovingParts } from '../../index'

// The named moving group each operation-door builder emits at the closed pose.
const MOVING_GROUP: Record<string, string> = {
  sliding: 'door-sliding-active',
  pocket: 'door-pocket-leaf',
  barn: 'door-barn-leaf',
  'garage-tiltup': 'door-tiltup-leaf',
  folding: 'door-fold-0',
  'garage-sectional': 'door-sectional-0',
  'garage-rollup': 'door-rollup-curtain',
}

function worldPosition(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true)
  return object.getWorldPosition(new THREE.Vector3())
}

describe('operation door open kinematics', () => {
  // Each operation door builds its moving parts in a named group at the closed
  // pose; `poseDoorMovingParts` then drives the open motion (the single source
  // of truth shared by the live system and the GLB exporter). This guards the
  // build-once + pose-at-t contract: the group exists, rests closed, and moves.
  for (const doorType of Object.keys(MOVING_GROUP)) {
    test(`${doorType} builds a moving group that opens`, () => {
      const node = DoorNode.parse({ id: `door_${doorType}`, doorType, operationState: 0 })
      const mesh = buildDoorPreviewMesh(node)

      const group = mesh.getObjectByName(MOVING_GROUP[doorType]!)
      expect(group).toBeDefined()

      // Closed snapshot.
      poseDoorMovingParts(node, mesh, 0)
      const closedPos = worldPosition(group!)
      const closedScaleY = group!.scale.y
      const closedRotX = group!.rotation.x
      const closedRotY = group!.rotation.y

      // Open snapshot — at least one of translation / rotation / scale changes.
      poseDoorMovingParts(node, mesh, 1)
      const openPos = worldPosition(group!)
      const moved =
        closedPos.distanceTo(openPos) > 0.05 ||
        Math.abs(closedScaleY - group!.scale.y) > 0.1 ||
        Math.abs(closedRotX - group!.rotation.x) > 0.05 ||
        Math.abs(closedRotY - group!.rotation.y) > 0.05
      expect(moved).toBe(true)

      // Posing back to closed is the identity of the rest pose.
      poseDoorMovingParts(node, mesh, 0)
      expect(worldPosition(group!).distanceTo(closedPos)).toBeLessThan(1e-6)
    })
  }
})
