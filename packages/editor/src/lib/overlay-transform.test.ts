import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Group } from 'three'
import { copyOverlayWorldTransform } from './overlay-transform'

test('opening overlays retain the source transform through God-mode zoom and rotation', () => {
  const model = new Group()
  const wall = new Group()
  const opening = new Group()
  model.add(wall)
  wall.add(opening)
  wall.rotation.y = 0.8
  opening.position.set(2, 1.5, 0.1)
  const portal = new Group()
  portal.position.set(4, 1, -2)
  portal.rotation.y = -0.4
  const overlay = new Group()
  portal.add(overlay)
  for (const scale of [0.01, 0.2, 1, 4, 0.05]) {
    model.scale.set(scale, scale * 2, scale)
    model.rotation.y += 0.2
    copyOverlayWorldTransform(opening, overlay)
    overlay.updateWorldMatrix(true, false)
    overlay.matrixWorld.elements.forEach((value, i) => {
      assert.ok(Math.abs(value - opening.matrixWorld.elements[i]!) < 1e-8)
    })
  }
})
