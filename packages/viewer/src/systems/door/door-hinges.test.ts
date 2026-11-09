// @ts-expect-error — bun:test is provided by the Bun runtime.
import { expect, test } from 'bun:test'
import { DoorNode } from '@pascal-app/core'
import { Mesh } from 'three'
import { buildDoorPreviewMesh } from './door-system'

function hingePositions(patch: Partial<DoorNode>) {
  const mesh = buildDoorPreviewMesh(DoorNode.parse(patch))
  const positions = mesh.children
    .filter((child) => child instanceof Mesh && child.userData.slotId === 'hardware')
    .map((child) => [Math.sign(child.position.x), Number(child.position.y.toFixed(3))])
  mesh.traverse((child) => {
    if (child instanceof Mesh) child.geometry.dispose()
  })
  return positions
}

for (const hingesSide of ['left', 'right'] as const) {
  test(`${hingesSide} upper hinge disappears when rounding reaches it and returns below that radius`, () => {
    const sign = hingesSide === 'left' ? -1 : 1
    const door = { hingesSide, openingShape: 'rounded' as const }
    expect(hingePositions({ ...door, cornerRadius: 0.3 })).toEqual([
      [sign, -0.8],
      [sign, -0.025],
    ])
    expect(hingePositions({ ...door, cornerRadius: 0.2 })).toEqual([
      [sign, -0.8],
      [sign, -0.025],
      [sign, 0.75],
    ])
  })
}

test('individual rounding only removes hinges on the affected leaf of double doors', () => {
  expect(
    hingePositions({
      doorType: 'double',
      openingShape: 'rounded',
      openingRadiusMode: 'individual',
      openingTopRadii: [0.3, 0],
    }),
  ).toEqual([
    [-1, -0.8],
    [-1, -0.025],
    [1, -0.8],
    [1, -0.025],
    [1, 0.75],
  ])
})
