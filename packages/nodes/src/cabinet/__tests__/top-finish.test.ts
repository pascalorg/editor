import { expect, test } from 'bun:test'
import { CabinetModuleNode } from '@pascal-app/core'
import type { Mesh } from 'three'
import { Vector3 } from 'three'
import { buildCabinetGeometry } from '../geometry'

function cabinetDoorLeaf(
  geometry: ReturnType<typeof buildCabinetGeometry>,
  side: 'left' | 'right',
  row: 'bottom' | 'top',
): Mesh {
  const matches: Mesh[] = []
  geometry.updateMatrixWorld(true)
  geometry.traverse((object) => {
    if (object.isMesh && new RegExp(`^cabinet-door-${side}-[\\d.]+$`).test(object.name)) {
      matches.push(object as Mesh)
    }
  })
  matches.sort((a, b) => a.getWorldPosition(new Vector3()).y - b.getWorldPosition(new Vector3()).y)
  const result = row === 'top' ? matches.at(-1) : matches[0]
  if (!result) throw new Error(`${row} ${side} door was not generated`)
  return result
}

function doorLeafWidth(mesh: Mesh) {
  mesh.geometry.computeBoundingBox()
  const bounds = mesh.geometry.boundingBox
  if (!bounds) throw new Error('Door leaf has no bounds')
  return bounds.max.x - bounds.min.x
}

test('cabinet modules do not add a ceiling finish by default', () => {
  const geometry = buildCabinetGeometry(CabinetModuleNode.parse({}))
  expect(geometry.getObjectByName('cabinet-top-cabinet-top')).toBeUndefined()
  geometry.clear()
})

test('top cabinet finish adds a framed storage box above the module', () => {
  const geometry = buildCabinetGeometry(
    CabinetModuleNode.parse({
      topFinish: 'top-cabinet',
      topFinishHeight: 0.36,
      topFinishDepth: 0.32,
    }),
  )
  expect(geometry.getObjectByName('cabinet-top-cabinet-top')).not.toBeNull()
  expect(geometry.getObjectByName('cabinet-top-cabinet-back')).not.toBeNull()
  geometry.clear()
})

test('trim finish adds a solid ceiling closure', () => {
  const geometry = buildCabinetGeometry(
    CabinetModuleNode.parse({ topFinish: 'trim', topFinishHeight: 0.12 }),
  )
  expect(geometry.getObjectByName('cabinet-top-trim')).not.toBeNull()
  geometry.clear()
})

test('top cabinet doors reuse the parent overlay and inset reveal rules', () => {
  const overlayNode = CabinetModuleNode.parse({
    width: 0.6,
    topFinish: 'top-cabinet',
    topFinishHeight: 0.36,
    topFinishDepth: 0.32,
    frontOverlay: 'full',
  })
  const overlayGeometry = buildCabinetGeometry(overlayNode)
  const insetGeometry = buildCabinetGeometry({ ...overlayNode, frontOverlay: 'inset' })

  const overlayLeafWidth = doorLeafWidth(cabinetDoorLeaf(overlayGeometry, 'left', 'top'))
  const insetLeafWidth = doorLeafWidth(cabinetDoorLeaf(insetGeometry, 'left', 'top'))
  const overlayOpening = overlayNode.width - overlayNode.frontGap
  const insetOpening = overlayNode.width - overlayNode.boardThickness * 2

  expect(overlayLeafWidth).toBeCloseTo(
    doorLeafWidth(cabinetDoorLeaf(overlayGeometry, 'left', 'bottom')),
    5,
  )
  expect(overlayLeafWidth).toBeCloseTo((overlayOpening - 3 * overlayNode.frontGap) / 2, 5)
  expect(insetLeafWidth).toBeCloseTo((insetOpening - 3 * overlayNode.frontGap) / 2, 5)
  expect(insetLeafWidth).toBeLessThan(overlayLeafWidth)
  overlayGeometry.clear()
  insetGeometry.clear()
})

test('top cabinet doors reuse the parent door type and front style', () => {
  const slabGeometry = buildCabinetGeometry(
    CabinetModuleNode.parse({
      width: 0.5,
      topFinish: 'top-cabinet',
      topFinishHeight: 0.36,
      topFinishDepth: 0.32,
      stack: [{ id: 'top-door', type: 'door', doorType: 'double', shelfCount: 1 }],
    }),
  )
  const raisedArchGeometry = buildCabinetGeometry(
    CabinetModuleNode.parse({
      width: 0.5,
      topFinish: 'top-cabinet',
      topFinishHeight: 0.36,
      topFinishDepth: 0.32,
      frontStyle: 'raised-arch',
      stack: [{ id: 'top-door', type: 'door', doorType: 'double', shelfCount: 1 }],
    }),
  )

  const slabDoor = cabinetDoorLeaf(slabGeometry, 'left', 'top')
  const raisedArchDoor = cabinetDoorLeaf(raisedArchGeometry, 'left', 'top')
  expect(cabinetDoorLeaf(slabGeometry, 'right', 'top')).toBeDefined()
  expect(raisedArchDoor.geometry.getAttribute('position').count).toBeGreaterThan(
    slabDoor.geometry.getAttribute('position').count,
  )
  slabGeometry.clear()
  raisedArchGeometry.clear()
})

test('top cabinet doors retain the normal open animation pose', () => {
  const geometry = buildCabinetGeometry(
    CabinetModuleNode.parse({
      width: 0.6,
      topFinish: 'top-cabinet',
      topFinishHeight: 0.36,
      topFinishDepth: 0.32,
      operationState: 1,
    }),
  )
  const hingeRotation = cabinetDoorLeaf(geometry, 'left', 'top').parent?.rotation.y

  expect(hingeRotation).toBeCloseTo(-Math.PI / 2)
  geometry.clear()
})
