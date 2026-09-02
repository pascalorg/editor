import { expect, test } from 'bun:test'
import type { Mesh, Object3D } from 'three'
import { Box3 } from 'three'
import { buildCabinetGeometry } from '../geometry'
import { CabinetModuleNode } from '../schema'
import {
  DISHWASHER_STANDARD_HEIGHT,
  DISHWASHER_STANDARD_WIDTH,
  removeCabinetCompartmentStack,
} from '../stack'

function findMesh(root: Object3D, name: string): Mesh {
  const mesh = root.getObjectByName(name) as Mesh | undefined
  if (!mesh?.isMesh) throw new Error(`Mesh not found: ${name}`)
  return mesh
}

test('a dishwasher fills the full cabinet face after its last sibling is deleted', () => {
  const initialNode = CabinetModuleNode.parse({
    width: DISHWASHER_STANDARD_WIDTH,
    carcassHeight: 0.8,
    stack: [
      { id: 'drawer', type: 'drawer', drawerCount: 1 },
      {
        id: 'dishwasher',
        type: 'dishwasher',
        height: DISHWASHER_STANDARD_HEIGHT,
      },
    ],
  })
  const removed = removeCabinetCompartmentStack(initialNode, 0)
  const node = CabinetModuleNode.parse({ ...initialNode, ...removed })

  const group = buildCabinetGeometry(node, undefined, 'rendered', false)
  group.updateMatrixWorld(true)
  const door = new Box3().setFromObject(findMesh(group, 'cabinet-dishwasher-0-door-panel'))

  expect(door.max.x - door.min.x).toBeCloseTo(node.width - node.frontGap * 2, 3)
  expect(door.min.y).toBeCloseTo(node.plinthHeight + node.frontGap / 2, 3)
  expect(door.max.y).toBeCloseTo(node.plinthHeight + node.carcassHeight - node.frontGap / 2, 3)
})
