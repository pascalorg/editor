// @ts-expect-error - bun:test is provided by the Bun runtime; viewer does not
// include Bun globals in its library tsconfig.
import { describe, expect, test } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildDoorPreviewMesh, poseDoorMovingParts } from './door-system'

describe('door export pose helpers', () => {
  test('resets every folding panel to an identity rest pose', () => {
    const node = DoorNode.parse({
      id: 'door_folding',
      doorType: 'folding',
      leafCount: 4,
      operationState: 0.65,
    })
    const mesh = buildDoorPreviewMesh(node)

    expect(poseDoorMovingParts(node, mesh, 1)).toBe(true)
    expect(poseDoorMovingParts(node, mesh, 0)).toBe(true)

    for (let index = 0; index < 4; index++) {
      const panel = mesh.getObjectByName(`door-fold-${index}`)
      expect(panel).toBeDefined()
      expect(panel!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-4)
    }
  })

  test('moves a sliding active panel without moving the fixed panel', () => {
    const node = DoorNode.parse({
      id: 'door_sliding',
      doorType: 'sliding',
      width: 1,
      frameThickness: 0.05,
      slideDirection: 'left',
    })
    const mesh = buildDoorPreviewMesh(node)
    const active = mesh.getObjectByName('door-sliding-active')
    expect(active).toBeDefined()
    expect(active!.position.x).toBeCloseTo(0)

    expect(poseDoorMovingParts(node, mesh, 1)).toBe(true)
    expect(active!.position.x).toBeLessThan(-0.1)

    expect(poseDoorMovingParts(node, mesh, 0)).toBe(true)
    expect(active!.position.x).toBeCloseTo(0)
  })
})
