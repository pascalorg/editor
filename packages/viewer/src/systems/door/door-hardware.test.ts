import { expect, test } from 'bun:test'
import { DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { disposeObject3DResources } from '../../lib/dispose-object3d'
import {
  hingeJambPart,
  hingeLeafPart,
  leverOnRose,
  pullBar,
  roller,
  roundedBox,
  tube,
} from '../../lib/hardware-geometry'
import { buildDoorPreviewMesh, DoorSystem, poseDoorMovingParts } from './door-system'

function swingLeaves(mesh: THREE.Object3D) {
  return mesh.children.filter((child) => child.userData.pascalSwingLeaf)
}

function handles(leaf: THREE.Object3D) {
  return leaf.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === leverOnRose(),
  )
}

function movingHinges(leaf: THREE.Object3D) {
  const hinges: THREE.Mesh[] = []
  leaf.traverse((part) => {
    if (part instanceof THREE.Mesh && part.geometry === hingeLeafPart()) hinges.push(part)
  })
  return hinges
}

function expectVector(actual: THREE.Vector3, expected: THREE.Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
}

for (const doorType of ['hinged', 'double', 'french'] as const) {
  for (const hingesSide of ['left', 'right'] as const) {
    for (const swingDirection of ['inward', 'outward'] as const) {
      test(`${doorType} ${hingesSide} ${swingDirection}: both handle faces follow the knuckle pivot at 0/45/90°`, () => {
        const node = DoorNode.parse({
          doorType,
          hingesSide,
          swingDirection,
          position: [3, 2, -4],
          rotation: [0, 0.7, 0],
          handleHeight: 0.9,
        })
        const closed = buildDoorPreviewMesh(node)
        const closedLeaves = swingLeaves(closed)
        const saved = JSON.stringify(node)
        for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
          const mesh = buildDoorPreviewMesh({ ...node, swingAngle: angle })
          mesh.updateMatrixWorld(true)
          for (const [i, leaf] of swingLeaves(mesh).entries()) {
            const hingeSign = Math.sign(leaf.position.x)
            const face = swingDirection === 'inward' ? 1 : -1
            expect(leaf.position.z).toBeCloseTo(face * 0.02)
            const leafHinges = movingHinges(leaf)
            const jambHinges = mesh.children.filter(
              (part): part is THREE.Mesh =>
                part instanceof THREE.Mesh &&
                part.geometry === hingeJambPart() &&
                Math.abs(part.position.x - leaf.position.x) < 1e-6,
            )
            expect(leafHinges).toHaveLength(3)
            expect(jambHinges).toHaveLength(3)
            for (const [index, moving] of leafHinges.entries()) {
              const fixed = jambHinges[index]!
              expectVector(
                moving.getWorldPosition(new THREE.Vector3()),
                fixed.getWorldPosition(new THREE.Vector3()),
              )
              expectVector(
                fixed.position,
                new THREE.Vector3(leaf.position.x, moving.position.y, leaf.position.z),
              )
              expect(moving.userData.slotId).toBe('hardware')
              expect(fixed.userData.slotId).toBe('hardware')
              expect(moving.matrixWorld.determinant()).toBeGreaterThan(0)
              expect(fixed.matrixWorld.determinant()).toBeGreaterThan(0)
              const fixedPlate = fixed.localToWorld(new THREE.Vector3(-0.00125, 0, -0.014))
              const movingPlate = moving.localToWorld(new THREE.Vector3(0.00125, 0, -0.014))
              if (angle === 0) {
                const localFixed = mesh.worldToLocal(fixedPlate.clone())
                const localMoving = mesh.worldToLocal(movingPlate.clone())
                expect(localMoving.x - leaf.position.x).toBeCloseTo(-hingeSign * 0.00125)
                expect(localFixed.x - leaf.position.x).toBeCloseTo(hingeSign * 0.00125)
                expect(localMoving.z).toBeCloseTo(face * 0.006)
                expect(localFixed.z).toBeCloseTo(face * 0.006)
              } else {
                const rest = movingHinges(closedLeaves[i]!)[index]!
                const closedPlate = new THREE.Vector3(0.00125, 0, -0.014)
                  .applyQuaternion(rest.quaternion)
                  .add(moving.position)
                  .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * face * hingeSign)
                  .add(leaf.position)
                  .applyMatrix4(mesh.matrixWorld)
                expectVector(movingPlate, closedPlate)
              }
            }
            const leafHandles = handles(leaf)
            expect(leafHandles).toHaveLength(2)
            for (const [j, handle] of leafHandles.entries()) {
              const restHandle = handles(closedLeaves[i]!)[j]!
              const expected = restHandle.position
                .clone()
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * face * hingeSign)
                .add(leaf.position)
                .applyMatrix4(mesh.matrixWorld)
              expectVector(handle.getWorldPosition(new THREE.Vector3()), expected)
              const grip = handle.localToWorld(new THREE.Vector3(0.125, -0.012, 0.047))
              const spindle = handle.localToWorld(new THREE.Vector3(0, 0, 0.047))
              const hingeDirection = new THREE.Vector3(hingeSign, 0, 0).applyQuaternion(
                leaf.getWorldQuaternion(new THREE.Quaternion()),
              )
              expect(grip.sub(spindle).dot(hingeDirection)).toBeCloseTo(0.125)
              expect(handle.matrixWorld.determinant()).toBeGreaterThan(0)
              expect(handle.userData.slotId).toBe('hardware')
            }
          }
        }
        expect(JSON.stringify(node)).toBe(saved)
      })
    }
  }
}

for (const openingShape of ['rectangle', 'rounded', 'arch'] as const) {
  test(`${openingShape}: closed leaf bounds match the pre-pivot geometry`, () => {
    const mesh = buildDoorPreviewMesh(
      DoorNode.parse({ openingShape, handle: false, swingAngle: 0 }),
    )
    const leaf = swingLeaves(mesh)[0]!
    const box = new THREE.Box3()
    leaf.updateWorldMatrix(true, true)
    leaf.traverse((part) => {
      if (part instanceof THREE.Mesh && part.userData.slotId !== 'hardware') {
        part.geometry.computeBoundingBox()
        box.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld))
      }
    })
    // Captured on origin/main before moving the pivot; hardware changes have their own bounds.
    const depth = openingShape === 'rectangle' ? 0.03 : 0.02
    expectVector(box.min, new THREE.Vector3(-0.4, -1.05, -depth))
    expectVector(box.max, new THREE.Vector3(0.4, 1, depth))
  })
}

test('roses seat on the raised segment at the handle height, on both faces', () => {
  const segment = DoorNode.parse({}).segments[0]!
  const node = DoorNode.parse({
    handleHeight: 0.5,
    segments: [
      { ...segment, heightRatio: 1, panelDepth: 0.005 },
      { ...segment, heightRatio: 1, panelDepth: 0.035 },
    ],
  })
  const mesh = buildDoorPreviewMesh(node)
  mesh.updateMatrixWorld(true)
  for (const handle of handles(swingLeaves(mesh)[0]!)) {
    const position = handle.getWorldPosition(new THREE.Vector3())
    expect(Math.abs(position.z)).toBeCloseTo(0.055)
    expect(position.y).toBeCloseTo(node.handleHeight - node.height / 2)
    expect(position.x).toBeCloseTo((node.width - 2 * node.frameThickness) / 2 - 0.06)
  }
})

test('panic bar ends sit in leaf-mounted brackets that reach the leaf face', () => {
  for (const swingAngle of [0, Math.PI / 4, Math.PI / 2]) {
    const node = DoorNode.parse({ panicBar: true, swingAngle })
    const mesh = buildDoorPreviewMesh(node)
    mesh.updateMatrixWorld(true)
    const leaf = swingLeaves(mesh)[0]!
    const barLength = (node.width - 2 * node.frameThickness) * 0.72
    const bar = leaf.children.find(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry === tube(0.02, barLength),
    )!
    const brackets = leaf.children.filter(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry === roundedBox(0.045, 0.07, 0.04),
    )
    expect(brackets).toHaveLength(2)
    for (const [index, bracket] of brackets.entries()) {
      expect(bracket.userData.slotId).toBe('hardware')
      expect(bar.userData.slotId).toBe('hardware')
      const bounds = new THREE.Box3().setFromBufferAttribute(
        bracket.geometry.getAttribute('position') as THREE.BufferAttribute,
      )
      const end = bar.localToWorld(
        new THREE.Vector3(0, ((index === 0 ? 1 : -1) * barLength) / 2, 0),
      )
      const localEnd = bracket.worldToLocal(end)
      expect(bounds.containsPoint(localEnd)).toBe(true)
      expect(localEnd.z).toBeGreaterThan(0)
      expect(bracket.position.z + bounds.min.z + leaf.position.z).toBeCloseTo(0.02)
    }
    expect(
      leaf.children.some(
        (part) => part instanceof THREE.Mesh && part.geometry === roller(0.02, 0.006),
      ),
    ).toBe(false)
  }
})

test('closer arm joins its leaf body to a fixed bracket on the head jamb when closed', () => {
  for (const frameDepth of [0.1, 0.24]) {
    const node = DoorNode.parse({ doorCloser: true, frameDepth })
    const mesh = buildDoorPreviewMesh(node)
    mesh.updateMatrixWorld(true)
    const leaf = swingLeaves(mesh)[0]!
    const body = leaf.children.find(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry === roundedBox(0.28, 0.055, 0.055),
    )!
    const arm = leaf.children.find(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry.type === 'CylinderGeometry',
    )!
    const bracket = mesh.children.find(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry === roundedBox(0.06, 0.03, 0.03),
    )!
    expect(bracket.userData.slotId).toBe('hardware')
    expect(arm.userData.slotId).toBe('hardware')
    const bracketBounds = new THREE.Box3().setFromObject(bracket)
    expect(bracketBounds.min.z).toBeCloseTo(frameDepth / 2)
    expect(bracketBounds.min.y).toBeGreaterThan(node.height / 2 - node.frameThickness)
    expect(bracketBounds.max.y).toBeLessThanOrEqual(node.height / 2 + 1e-6)
    arm.geometry.computeBoundingBox()
    const length = arm.geometry.boundingBox!.getSize(new THREE.Vector3()).y
    const start = arm.localToWorld(new THREE.Vector3(0, -length / 2, 0))
    const end = arm.localToWorld(new THREE.Vector3(0, length / 2, 0))
    const bodyTop = body.localToWorld(new THREE.Vector3(0.14 - 0.02, 0.0275, 0))
    const bracketUnderside = bracket.localToWorld(new THREE.Vector3(0, -0.015, 0))
    expect(start.distanceTo(bodyTop)).toBeLessThanOrEqual(0.008)
    expect(end.distanceTo(bracketUnderside)).toBeLessThanOrEqual(0.008)
    expect(start.distanceTo(end)).toBeGreaterThanOrEqual(0.1)
    expect(new THREE.Box3().setFromObject(body).containsPoint(start)).toBe(true)
    expect(bracketBounds.containsPoint(end)).toBe(true)
    const bracketPosition = bracket.getWorldPosition(new THREE.Vector3())
    const localArmPosition = arm.position.clone()
    const localArmQuaternion = arm.quaternion.clone()
    leaf.rotation.y = leaf.userData.pascalSwingLeaf.openRotationY
    mesh.updateMatrixWorld(true)
    expectVector(bracket.getWorldPosition(new THREE.Vector3()), bracketPosition)
    expectVector(arm.position, localArmPosition)
    expect(arm.quaternion.equals(localArmQuaternion)).toBe(true)
    expect(arm.localToWorld(new THREE.Vector3(0, length / 2, 0)).distanceTo(end)).toBeGreaterThan(
      0.01,
    )
  }
  for (const patch of [
    { doorCloser: false },
    { doorCloser: true, segments: [{ ...DoorNode.parse({}).segments[0], type: 'empty' }] },
  ]) {
    const mesh = buildDoorPreviewMesh(DoorNode.parse(patch))
    expect(
      mesh.children.some(
        (part) => part instanceof THREE.Mesh && part.geometry === roundedBox(0.06, 0.03, 0.03),
      ),
    ).toBe(false)
  }
})

test('barn rail stops are rollers centred on the two fixed rail ends', () => {
  for (const slideDirection of ['left', 'right'] as const) {
    const node = DoorNode.parse({ doorType: 'barn', slideDirection })
    const mesh = buildDoorPreviewMesh(node)
    const rail = mesh.children.find(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry.type === 'RoundedBoxGeometry',
    )!
    const stops = mesh.children.filter(
      (part): part is THREE.Mesh =>
        part instanceof THREE.Mesh && part.geometry === roller(0.02, 0.03),
    )
    expect(stops).toHaveLength(2)
    rail.geometry.computeBoundingBox()
    const length = rail.geometry.boundingBox!.getSize(new THREE.Vector3()).x
    for (const [index, stop] of stops.entries()) {
      expect(stop.userData.slotId).toBe('hardware')
      expectVector(
        stop.position,
        rail.position.clone().add(new THREE.Vector3(((index === 0 ? -1 : 1) * length) / 2, 0, 0)),
      )
      expectVector(
        new THREE.Vector3(0, 0, 1).applyQuaternion(stop.quaternion),
        new THREE.Vector3(0, 0, 1),
      )
    }
  }
})

test('rebuilding a sibling keeps shared hardware usable and undisposed', async () => {
  const previous = useScene.getState()
  const firstNode = DoorNode.parse({ id: 'door_shared_first' })
  const siblingNode = DoorNode.parse({ id: 'door_shared_sibling' })
  const first = buildDoorPreviewMesh(firstNode)
  const sibling = buildDoorPreviewMesh(siblingNode)
  const geometries = [leverOnRose(), hingeJambPart(), hingeLeafPart(), pullBar()]
  let sharedDisposals = 0
  let ownedDisposals = 0
  const onDispose = () => sharedDisposals++
  for (const geometry of geometries) geometry.addEventListener('dispose', onDispose)
  const panel = swingLeaves(first)[0]!.children.find(
    (child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.userData.slotId === 'panel',
  )!
  panel.geometry.addEventListener('dispose', () => ownedDisposals++)
  sceneRegistry.nodes.set(firstNode.id, first)
  sceneRegistry.nodes.set(siblingNode.id, sibling)
  useScene.setState({
    nodes: { ...previous.nodes, [firstNode.id]: firstNode },
    dirtyNodes: new Set([firstNode.id]),
  })
  const renderer = await create(createElement(DoorSystem))
  try {
    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60)
    })
    expect(ownedDisposals).toBe(1)
    expect(handles(swingLeaves(first)[0]!)[0]!.geometry).toBe(
      handles(swingLeaves(sibling)[0]!)[0]!.geometry,
    )
    disposeObject3DResources(first)
    expect(sharedDisposals).toBe(0)
    for (const geometry of geometries) {
      expect(geometry.userData.shared).toBe(true)
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.isEmpty()).toBe(false)
    }
    sibling.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.4, -0.818, 1), new THREE.Vector3(0, 0, -1))
    expect(
      ray
        .intersectObject(sibling, true)
        .some((hit) => hit.object instanceof THREE.Mesh && hit.object.geometry === hingeJambPart()),
    ).toBe(true)
  } finally {
    for (const geometry of geometries) geometry.removeEventListener('dispose', onDispose)
    await renderer.unmount()
    sceneRegistry.nodes.delete(firstNode.id)
    sceneRegistry.nodes.delete(siblingNode.id)
    useScene.setState(previous)
  }
})

for (const doorType of ['pocket', 'sliding', 'folding', 'barn'] as const) {
  for (const slideDirection of ['left', 'right'] as const) {
    test(`${doorType} ${slideDirection}: pulls stay on the moving panel`, () => {
      const node = DoorNode.parse({ doorType, slideDirection })
      const mesh = buildDoorPreviewMesh(node)
      const group = mesh.getObjectByName(
        {
          pocket: 'door-pocket-leaf',
          sliding: 'door-sliding-active',
          folding: 'door-fold-3',
          barn: 'door-barn-leaf',
        }[doorType],
      )!
      const hardware = group.children.filter(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.userData.slotId === 'hardware',
      )
      expect(hardware.length).toBeGreaterThanOrEqual(2)
      expect(hardware.filter((part) => part.geometry === pullBar())).toHaveLength(2)
      const localPositions = hardware.map((part) => part.position.clone())
      mesh.updateMatrixWorld(true)
      const closed = hardware.map((part) => part.getWorldPosition(new THREE.Vector3()))
      for (const amount of [0.5, 1, 0]) {
        poseDoorMovingParts(node, mesh, amount)
        mesh.updateMatrixWorld(true)
        for (const [index, part] of hardware.entries()) {
          expectVector(part.position, localPositions[index]!)
          const position = part.getWorldPosition(new THREE.Vector3())
          if (amount > 0) expect(position.distanceTo(closed[index]!)).toBeGreaterThan(0.01)
          else expectVector(position, closed[index]!)
          expect(part.geometry.userData.shared).toBe(true)
          expect(part.matrixWorld.determinant()).toBeGreaterThan(0)
        }
      }
      if (doorType === 'barn') {
        expect(hardware.filter((part) => part.geometry === roller(0.0425, 0.02))).toHaveLength(2)
      } else {
        for (const part of hardware) expect(part.geometry).toBe(pullBar())
      }
    })
  }
}

for (const doorType of ['garage-sectional', 'garage-tiltup', 'garage-rollup'] as const) {
  test(`${doorType}: tracks use rounded shared geometry`, () => {
    const mesh = buildDoorPreviewMesh(DoorNode.parse({ doorType }))
    const tracks = mesh.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.userData.slotId === 'hardware',
    )
    expect(tracks.length).toBeGreaterThan(0)
    for (const track of tracks) {
      expect(track.geometry.type).toBe('RoundedBoxGeometry')
      expect(track.geometry.userData.shared).toBe(true)
    }
  })
}

test('passages and empty swing leaves gain no hardware', () => {
  for (const patch of [
    { openingKind: 'opening' },
    { segments: [{ ...DoorNode.parse({}).segments[0], type: 'empty' }] },
  ]) {
    const mesh = buildDoorPreviewMesh(DoorNode.parse(patch))
    let count = 0
    mesh.traverse((part) => {
      if (part.userData.slotId === 'hardware') count++
    })
    expect(count).toBe(0)
  }
})

test('shaped openings omit the matching leaf and jamb hinge together', () => {
  for (const patch of [
    { openingShape: 'rounded', cornerRadius: 0.3 },
    { openingShape: 'rounded', cornerRadius: 0.2, hingesSide: 'right' },
    { openingShape: 'arch', archHeight: 0.45 },
    {
      doorType: 'double',
      openingShape: 'rounded',
      openingRadiusMode: 'individual',
      openingTopRadii: [0.3, 0],
    },
  ]) {
    const mesh = buildDoorPreviewMesh(DoorNode.parse(patch))
    for (const leaf of swingLeaves(mesh)) {
      const fixed = mesh.children.filter(
        (part) =>
          part instanceof THREE.Mesh &&
          part.geometry === hingeJambPart() &&
          Math.abs(part.position.x - leaf.position.x) < 1e-6,
      )
      const moving = movingHinges(leaf)
      expect(moving.map((part) => part.position.y)).toEqual(fixed.map((part) => part.position.y))
    }
  }
})

test('default hinged hardware preserves the measured tessellation with 10 percent headroom', () => {
  const mesh = buildDoorPreviewMesh(DoorNode.parse({}))
  let triangles = 0
  let levers = 0
  let hingeParts = 0
  mesh.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || part.userData.slotId !== 'hardware') return
    triangles += (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3
    if (part.geometry === leverOnRose()) levers++
    else if (part.geometry === hingeLeafPart() || part.geometry === hingeJambPart()) hingeParts++
  })
  expect(levers).toBe(2)
  expect(hingeParts).toBe(6)
  // The specified segment counts exceed 4,000; retain the requested surface quality.
  expect(triangles).toBe(7032)
  expect(triangles).toBeLessThanOrEqual(7736)
})
