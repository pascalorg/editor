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

for (const slidingStyle of ['patio', 'bypass'] as const) {
  for (const leafCount of [2, 3, 4] as const) {
    for (const slideDirection of ['left', 'right'] as const) {
      test(`${leafCount}-panel ${slidingStyle} slides ${slideDirection} at 0, 0.5 and 1`, () => {
        const node = DoorNode.parse({
          doorType: 'sliding',
          width: 3,
          leafCount,
          slidingStyle,
          slideDirection,
        })
        const mesh = buildDoorPreviewMesh(node)
        const panels = mesh.children.filter((p) => p.name.startsWith('door-sliding-active'))
        expect(panels).toHaveLength(leafCount)
        const positions = [0, 0.5, 1].map((t) => {
          expect(poseDoorMovingParts(node, mesh, t)).toBe(true)
          return panels.map((p) => p.position.x)
        })
        const moving = positions[2]!.filter((x) => Math.abs(x) > 0.01)
        expect(moving).toHaveLength(leafCount === 4 ? 2 : 1)
        if (slidingStyle === 'bypass' || leafCount < 4)
          expect(moving.every((x) => (slideDirection === 'left' ? x < 0 : x > 0))).toBe(true)
        else expect(moving[0]! * moving[1]!).toBeLessThan(0)
        for (let index = 0; index < leafCount; index++) {
          expect(positions[0]![index]).toBeCloseTo(0)
          expect(positions[1]![index]).toBeCloseTo(positions[2]![index]! / 2)
          if (slidingStyle === 'bypass') {
            let pulls = 0
            panels[index]!.traverse((part) => {
              if (part.userData.slotId === 'hardware') pulls++
            })
            expect(pulls).toBeGreaterThan(0)
          }
        }
      })
    }
  }
}

for (const leafCount of [2, 4, 6, 8] as const) {
  for (const slideDirection of ['left', 'right'] as const) {
    test(`${leafCount} folding panels pose toward ${slideDirection}`, () => {
      const node = DoorNode.parse({
        doorType: 'folding',
        width: 4,
        leafCount,
        slideDirection,
        operationState: 0,
      })
      const mesh = buildDoorPreviewMesh(node)
      const first = mesh.getObjectByName('door-fold-0')!
      const anchor = first.position.clone()
      for (const t of [0, 0.5, 1]) {
        expect(poseDoorMovingParts(node, mesh, t)).toBe(true)
        expect(first.position.equals(anchor)).toBe(true)
        for (let index = 0; index < leafCount; index++) {
          const panel = mesh.getObjectByName(`door-fold-${index}`)!
          expect(panel).toBeDefined()
          expect(Math.abs(panel.rotation.y)).toBeCloseTo(Math.PI * 0.44 * t * (index === 0 ? 1 : 2))
        }
      }
      if (leafCount >= 6) expect(Math.sign(anchor.x)).toBe(slideDirection === 'left' ? -1 : 1)
      poseDoorMovingParts(node, mesh, 0)
      expect(first.rotation.y).toBeCloseTo(0)
    })
  }
}
