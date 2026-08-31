// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildDoorPreviewMesh } from '../../index'

const DOOR_TYPES = [
  'hinged',
  'double',
  'french',
  'folding',
  'pocket',
  'barn',
  'sliding',
  'garage-sectional',
  'garage-rollup',
  'garage-tiltup',
] as const

function visibleBounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  for (const child of mesh.children) {
    if (child.name === 'cutout') continue
    bounds.expandByObject(child, true)
  }
  return bounds
}

describe('door floor alignment', () => {
  for (const doorType of DOOR_TYPES) {
    test(`${doorType} does not extend below the opening floor`, () => {
      const node = DoorNode.parse({
        id: `door_floor-alignment-${doorType}`,
        doorType,
        operationState: 0,
        threshold: true,
      })
      const mesh = buildDoorPreviewMesh(node)
      const bounds = visibleBounds(mesh)

      expect(bounds.min.y).toBeGreaterThanOrEqual(-node.height / 2 - 1e-6)
    })
  }

  test('keeps the wall cutout bottom locked to the opening floor', () => {
    const node = DoorNode.parse({ id: 'door_floor-alignment-cutout' })
    const mesh = buildDoorPreviewMesh(node)
    const cutout = mesh.getObjectByName('cutout') as THREE.Mesh
    cutout.geometry.computeBoundingBox()

    expect(cutout.geometry.boundingBox?.min.y).toBeCloseTo(-node.height / 2, 6)
  })
})
