import { expect, test } from 'bun:test'
import { DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { disposeObject3DResources } from '../../lib/dispose-object3d'
import {
  flushPull,
  hingeJambPart,
  hingeLeafPart,
  knobOnRose,
  leverOnPlate,
  leverOnRose,
  leverOnRoseCurved,
  pullBar,
  roller,
  roundedBox,
  sphere,
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
              const grip = handle.localToWorld(new THREE.Vector3(0.125, 0, 0.047))
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
  test(`${openingShape}: closed leaf bounds include the edge clearance and bevelled field`, () => {
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
    expectVector(box.min, new THREE.Vector3(-0.397, -1.047, -0.02))
    expectVector(box.max, new THREE.Vector3(0.397, 0.997, 0.02))
  })
}

test('roses seat on the carved segment at the handle height, on both faces', () => {
  const segment = DoorNode.parse({}).segments[0]!
  const node = DoorNode.parse({
    handleHeight: 0.5,
    contentPadding: [0, 0],
    segments: [
      { ...segment, heightRatio: 1, panelDepth: 0.005 },
      { ...segment, heightRatio: 1, panelDepth: 0.035 },
    ],
  })
  const mesh = buildDoorPreviewMesh(node)
  mesh.updateMatrixWorld(true)
  const panels: THREE.Mesh[] = []
  mesh.traverse((part) => {
    if (part instanceof THREE.Mesh && part.userData.slotId === 'panel') panels.push(part)
  })
  for (const handle of handles(swingLeaves(mesh)[0]!)) {
    const position = handle.getWorldPosition(new THREE.Vector3())
    const face = Math.sign(position.z)
    const surface = new THREE.Raycaster(
      new THREE.Vector3(position.x, position.y, face),
      new THREE.Vector3(0, 0, -face),
    ).intersectObjects(panels)[0]!
    expect(position.z).toBeCloseTo(surface.point.z, 6)
    expect(Math.abs(position.z)).toBeLessThan(0.02)
    expect(position.y).toBeCloseTo(node.handleHeight - node.height / 2)
    expect(position.x).toBeCloseTo((node.width - 2 * node.frameThickness) / 2 - 0.06)
  }
})

for (const doorType of ['hinged', 'double', 'french'] as const) {
  for (const hingesSide of ['left', 'right'] as const) {
    for (const swingDirection of ['inward', 'outward'] as const) {
      for (const panicBarStyle of ['crossbar', 'touchbar'] as const) {
        for (const panicBarRods of [false, true]) {
          test(`${doorType} ${hingesSide} ${swingDirection} ${panicBarStyle} rods=${panicBarRods}: panic device seats on the swing face and follows the leaf`, () => {
            const node = DoorNode.parse({
              doorType,
              hingesSide,
              swingDirection,
              panicBar: true,
              panicBarStyle,
              panicBarRods,
              panicBarHeight: 0.95,
            })
            for (const swingAngle of [0, Math.PI / 4, Math.PI / 2]) {
              const mesh = buildDoorPreviewMesh({ ...node, swingAngle })
              mesh.updateMatrixWorld(true)
              const face = swingDirection === 'inward' ? 1 : -1
              for (const leaf of swingLeaves(mesh)) {
                const leafWidth =
                  (node.width - 2 * node.frameThickness) / (doorType === 'hinged' ? 1 : 2)
                const latchSign = leaf.position.x < 0 ? 1 : -1
                const centerX = (latchSign * leafWidth) / 2
                const latchX = centerX + latchSign * (leafWidth / 2 - 0.055)
                const hingeX = centerX - latchSign * (leafWidth / 2 - 0.04)
                const barLength = Math.abs(latchX - hingeX)
                const barY = node.panicBarHeight - node.height / 2
                const hardware = leaf.children.filter(
                  (part): part is THREE.Mesh =>
                    part instanceof THREE.Mesh && part.userData.slotId === 'hardware',
                )
                const touch = panicBarStyle === 'touchbar'
                const find = (geometry: THREE.BufferGeometry) =>
                  hardware.filter((part) => part.geometry === geometry)
                const bar = find(
                  touch ? roundedBox(barLength, 0.06, 0.03) : tube(0.0125, barLength),
                )[0]!
                expect(bar).toBeDefined()
                expect(bar.position.x).toBeCloseTo((latchX + hingeX) / 2)
                expect(bar.position.y).toBeCloseTo(barY)
                expect(bar.position.z).toBeCloseTo(face * (touch ? 0.035 : 0.045))
                const latch = find(
                  roundedBox(touch ? 0.09 : 0.075, touch ? 0.1 : 0.07, touch ? 0.055 : 0.06),
                )[0]!
                const cap = find(roundedBox(touch ? 0.035 : 0.04, 0.07, 0.05))[0]!
                for (const [part, x, depth] of [
                  [latch, latchX, touch ? 0.055 : 0.06],
                  [cap, hingeX, 0.05],
                ] as const) {
                  expect(part.position.x).toBeCloseTo(x)
                  expect(part.position.y).toBeCloseTo(barY)
                  expect(face * part.position.z - depth / 2).toBeCloseTo(0)
                }
                for (const x of [latchX, hingeX]) {
                  const end = new THREE.Vector3(x - bar.position.x, 0, 0).applyQuaternion(
                    bar.quaternion.clone().invert(),
                  )
                  const worldEnd = bar.localToWorld(end)
                  const mount = x === latchX ? latch : cap
                  const localEnd = mount.worldToLocal(worldEnd)
                  mount.geometry.computeBoundingBox()
                  expect(mount.geometry.boundingBox!.distanceToPoint(localEnd)).toBeLessThan(0.001)
                }
                const latches = find(roundedBox(0.035, 0.06, 0.04))
                const clips = find(roundedBox(0.03, 0.02, 0.03))
                expect(latches).toHaveLength(panicBarRods ? 2 : 0)
                expect(clips).toHaveLength(panicBarRods ? 2 : 0)
                if (panicBarRods) {
                  const leafTop = node.height / 2 - node.frameThickness
                  const leafBottom = -node.height / 2
                  for (const end of [-1, 1]) {
                    const latchY = end > 0 ? leafTop - 0.05 : leafBottom + 0.05
                    const startY = barY + (end * (touch ? 0.1 : 0.07)) / 2
                    const endY = latchY - end * 0.03
                    const rod = find(tube(0.006, Math.abs(endY - startY)))[0]!
                    expect(rod).toBeDefined()
                    expect(rod.position.x).toBeCloseTo(latchX)
                    expect(rod.position.y).toBeCloseTo((startY + endY) / 2)
                    expect(rod.position.z).toBeCloseTo(face * 0.025)
                    expect(latches.some((part) => Math.abs(part.position.y - latchY) < 1e-6)).toBe(
                      true,
                    )
                    expect(
                      clips.some(
                        (part) =>
                          Math.abs(part.position.y - rod.position.y) < 1e-6 &&
                          Math.abs(part.position.x - latchX) < 1e-6,
                      ),
                    ).toBe(true)
                  }
                }
                for (const part of [bar, latch, cap, ...latches, ...clips]) {
                  expect(part.geometry.userData.shared).toBe(true)
                  expect(part.matrixWorld.determinant()).toBeGreaterThan(0)
                }
              }
            }
          })
        }
      }
    }
  }
}

function armEnds(arm: THREE.Mesh<THREE.CylinderGeometry>) {
  const half = arm.geometry.parameters.height / 2
  return [
    arm.localToWorld(new THREE.Vector3(0, -half, 0)),
    arm.localToWorld(new THREE.Vector3(0, half, 0)),
  ] as const
}

for (const doorType of ['hinged', 'double', 'french'] as const) {
  for (const frameDepth of [0.1, 0.24]) {
    for (const hingesSide of ['left', 'right'] as const) {
      for (const swingDirection of ['inward', 'outward'] as const) {
        test(`${doorType} ${frameDepth} ${hingesSide} ${swingDirection}: pull-face closer clears the head and meets its moving pivot, elbow and fixed shoe at 0/45/90°`, () => {
          const node = DoorNode.parse({
            doorType,
            doorCloser: true,
            frameDepth,
            hingesSide,
            swingDirection,
          })
          let closedLengths: number[] | undefined
          let shoePosition: THREE.Vector3 | undefined
          let previousDistance = 0
          let previousBend = Math.PI
          for (const swingAngle of [0, Math.PI / 4, Math.PI / 2]) {
            const mesh = buildDoorPreviewMesh({ ...node, swingAngle })
            mesh.updateMatrixWorld(true)
            const leaf = swingLeaves(mesh)[0]!
            const body = leaf.children.find(
              (part): part is THREE.Mesh =>
                part instanceof THREE.Mesh && part.geometry === roundedBox(0.28, 0.055, 0.055),
            )!
            const cylinders = (parent: THREE.Object3D, radius: number) =>
              parent.children.find(
                (part): part is THREE.Mesh<THREE.CylinderGeometry> =>
                  part instanceof THREE.Mesh &&
                  part.geometry instanceof THREE.CylinderGeometry &&
                  part.geometry.parameters.radiusTop === radius,
              )!
            const main = cylinders(leaf, 0.0075)
            const forearm = cylinders(mesh, 0.006)
            const knuckle = mesh.children.find(
              (part): part is THREE.Mesh =>
                part instanceof THREE.Mesh && part.geometry === sphere(0.009),
            )!
            const shoe = mesh.children.find(
              (part): part is THREE.Mesh =>
                part instanceof THREE.Mesh && part.geometry === roundedBox(0.09, 0.025, 0.03),
            )!
            const latchSign = leaf.position.x < 0 ? 1 : -1
            const leafWidth =
              (node.width - 2 * node.frameThickness) / (doorType === 'hinged' ? 1 : 2)
            const pivot = body.localToWorld(
              new THREE.Vector3(latchSign * 0.11 * Math.min(1, leafWidth / 0.4), 0.0275, 0),
            )
            const elbow = knuckle.getWorldPosition(new THREE.Vector3())
            if (swingAngle === 0) {
              const face = swingDirection === 'inward' ? -1 : 1
              const closedElbow = new THREE.Vector3(
                leaf.position.x + latchSign * 0.18 * Math.min(1, leafWidth / 0.4),
                node.height / 2 - node.frameThickness - 0.0125,
                face * (frameDepth / 2 + 0.19),
              )
              expect(elbow.distanceTo(closedElbow)).toBeLessThan(0.002)
            }
            const shoeAnchor = shoe.localToWorld(new THREE.Vector3(0, -0.0125, 0))
            const [mainStart, mainEnd] = armEnds(main)
            const [forearmStart, forearmEnd] = armEnds(forearm)
            for (const [actual, expected] of [
              [mainStart, pivot],
              [mainEnd, elbow],
              [forearmStart, shoeAnchor],
              [forearmEnd, elbow],
              [mainEnd, forearmEnd],
            ] as const) {
              expect(actual.distanceTo(expected)).toBeLessThan(0.002)
            }
            const leafTop = node.height / 2 - node.frameThickness
            const head = new THREE.Box3(
              new THREE.Vector3(-node.width / 2, leafTop, -frameDepth / 2),
              new THREE.Vector3(node.width / 2, node.height / 2, frameDepth / 2),
            )
            const pullFace = swingDirection === 'inward' ? -1 : 1
            expect((body.position.z + leaf.position.z) * pullFace).toBeCloseTo(0.05)
            expect(shoe.position.z).toBeCloseTo(pullFace * (frameDepth / 2 + 0.015))
            for (const point of [pivot, mainEnd, forearmStart, forearmEnd, elbow]) {
              // Moving parts stay outside the leaf's pull face even after it rotates.
              const local = leaf.worldToLocal(point.clone())
              expect(pullFace * (local.z + leaf.position.z)).toBeGreaterThanOrEqual(0.02 - 0.002)
            }
            for (const part of [body, main, forearm, knuckle, shoe]) {
              const positions = part.geometry.getAttribute('position')
              for (let vertex = 0; vertex < positions.count; vertex++) {
                const point = new THREE.Vector3().fromBufferAttribute(positions, vertex)
                part.localToWorld(point)
                const local = leaf.worldToLocal(point.clone())
                expect(pullFace * (local.z + leaf.position.z)).toBeGreaterThanOrEqual(0.02 - 0.002)
                mesh.worldToLocal(point)
                expect(head.containsPoint(point)).toBe(false)
              }
            }
            const distance = pivot.distanceTo(shoeAnchor)
            const bend = elbow.clone().sub(pivot).angleTo(shoeAnchor.clone().sub(elbow))
            expect(distance).toBeGreaterThan(previousDistance)
            expect(bend).toBeLessThan(previousBend)
            previousDistance = distance
            previousBend = bend
            expect(mainStart.y).toBeCloseTo(mainEnd.y)
            expect(forearmStart.y).toBeCloseTo(forearmEnd.y)
            const lengths = [main.geometry.parameters.height, forearm.geometry.parameters.height]
            if (!closedLengths) closedLengths = lengths
            expect(lengths).toEqual(closedLengths)
            const fixedPosition = shoe.getWorldPosition(new THREE.Vector3())
            if (!shoePosition) shoePosition = fixedPosition
            expectVector(fixedPosition, shoePosition)
            for (const part of [body, main, forearm, knuckle, shoe]) {
              expect(part.userData.slotId).toBe('hardware')
              expect(part.geometry.userData.shared).toBe(true)
              expect(part.matrixWorld.determinant()).toBeGreaterThan(0)
            }
          }
        })
      }
    }
  }
}

test('unreachable closer anchors clamp to full extension with finite fixed-length geometry', () => {
  const node = DoorNode.parse({ doorCloser: true, frameDepth: 0.01, swingAngle: Math.PI / 2 })
  const mesh = buildDoorPreviewMesh(node)
  const closed = buildDoorPreviewMesh({ ...node, swingAngle: 0 })
  mesh.updateMatrixWorld(true)
  const leaf = swingLeaves(mesh)[0]!
  const main = leaf.children.find(
    (part): part is THREE.Mesh<THREE.CylinderGeometry> =>
      part instanceof THREE.Mesh &&
      part.geometry instanceof THREE.CylinderGeometry &&
      part.geometry.parameters.radiusTop === 0.0075,
  )!
  const forearm = mesh.children.find(
    (part): part is THREE.Mesh<THREE.CylinderGeometry> =>
      part instanceof THREE.Mesh &&
      part.geometry instanceof THREE.CylinderGeometry &&
      part.geometry.parameters.radiusTop === 0.006,
  )!
  const knuckle = mesh.children.find(
    (part): part is THREE.Mesh => part instanceof THREE.Mesh && part.geometry === sphere(0.009),
  )!
  const [pivot, elbow] = armEnds(main)
  const [shoe, forearmEnd] = armEnds(forearm)
  const l1 = main.geometry.parameters.height
  const l2 = forearm.geometry.parameters.height
  expect(pivot.distanceTo(shoe)).toBeGreaterThan(l1 + l2)
  expectVector(elbow, knuckle.getWorldPosition(new THREE.Vector3()))
  const direction = shoe.clone().sub(pivot).normalize()
  expectVector(elbow, pivot.clone().addScaledVector(direction, l1))
  expectVector(forearmEnd, shoe.clone().addScaledVector(direction, -l2))
  const geometries = [main.geometry, forearm.geometry]
  const closedGeometries: THREE.BufferGeometry[] = []
  closed.traverse((part) => {
    if (part instanceof THREE.Mesh) closedGeometries.push(part.geometry)
  })
  for (const geometry of geometries) {
    expect(closedGeometries.includes(geometry)).toBe(true)
    expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
  }
})

test('closer is omitted when disabled or the leaf has no content', () => {
  for (const patch of [
    { doorCloser: false },
    { doorCloser: true, segments: [{ ...DoorNode.parse({}).segments[0], type: 'empty' }] },
  ]) {
    const mesh = buildDoorPreviewMesh(DoorNode.parse(patch))
    expect(
      mesh.children.some(
        (part) => part instanceof THREE.Mesh && part.geometry === roundedBox(0.09, 0.025, 0.03),
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
      expect(
        hardware.filter(
          (part) => part.geometry === (doorType === 'barn' ? pullBar() : flushPull()),
        ),
      ).toHaveLength(2)
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
        for (const part of hardware) expect(part.geometry).toBe(flushPull())
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

test('default hinged door stays within its measured triangle budget with 10 percent headroom', () => {
  const mesh = buildDoorPreviewMesh(DoorNode.parse({}))
  let triangles = 0
  let levers = 0
  let hingeParts = 0
  mesh.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || part.material === mesh.material) return
    triangles += (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3
    if (part.geometry === leverOnRose()) levers++
    else if (part.geometry === hingeLeafPart() || part.geometry === hingeJambPart()) hingeParts++
  })
  expect(levers).toBe(2)
  expect(hingeParts).toBe(6)
  expect(triangles).toBeLessThanOrEqual(Math.ceil(3496 * 1.1))
})

for (const doorType of ['pocket', 'sliding', 'folding'] as const) {
  for (const slideDirection of ['left', 'right'] as const) {
    for (const contentPadding of [
      [0.08, 0.08],
      [0, 0],
    ] as [number, number][]) {
      test(`${doorType} ${slideDirection} padding=${contentPadding}: both flush cups occupy real holes through stile and panel boxes`, () => {
        const segment = {
          ...DoorNode.parse({}).segments[0]!,
          type: 'panel',
          panelInset: 0.01,
          panelDepth: 0.02,
        }
        const mesh = buildDoorPreviewMesh(
          DoorNode.parse({ doorType, slideDirection, contentPadding, segments: [segment] }),
        )
        const group = mesh.getObjectByName(
          { pocket: 'door-pocket-leaf', sliding: 'door-sliding-active', folding: 'door-fold-3' }[
            doorType
          ],
        )!
        mesh.updateMatrixWorld(true)
        const cups = group.children.filter(
          (part): part is THREE.Mesh => part instanceof THREE.Mesh && part.geometry === flushPull(),
        )
        expect(cups).toHaveLength(2)
        const panelParts = group.children.filter(
          (part) => part instanceof THREE.Mesh && part.userData.slotId !== 'hardware',
        )
        for (const cup of cups) {
          for (const [x, y] of [
            [0, 0],
            [0.015, 0.05],
            [-0.015, -0.05],
          ]) {
            const origin = cup.localToWorld(new THREE.Vector3(x, y, 0.1))
            const direction = new THREE.Vector3(0, 0, -1).transformDirection(cup.matrixWorld)
            const ray = new THREE.Raycaster(origin, direction)
            const cupHits = ray.intersectObject(cup)
            expect(cupHits[0]!.distance).toBeCloseTo(0.11, 6)
            const leafHits = ray.intersectObjects(panelParts)
            expect(leafHits.every((hit) => hit.distance >= 0.112 - 1e-6)).toBe(true)
          }
          const origin = cup.localToWorld(new THREE.Vector3(0.0215, 0, 0.1))
          const direction = new THREE.Vector3(0, 0, -1).transformDirection(cup.matrixWorld)
          const rimHits = new THREE.Raycaster(origin, direction).intersectObject(cup)
          expect(rimHits[0]!.distance).toBeCloseTo(0.099, 6)
          expect(cup.userData.slotId).toBe('hardware')
        }
      })
    }
  }
}

test('panic defaults preserve loading legacy doors and match explicit crossbar without rods', () => {
  const legacy = DoorNode.parse({ panicBar: true })
  expect(legacy.panicBarStyle).toBe('crossbar')
  expect(legacy.panicBarRods).toBe(false)
  const mesh = buildDoorPreviewMesh(legacy)
  const explicit = buildDoorPreviewMesh({
    ...legacy,
    panicBarStyle: 'crossbar',
    panicBarRods: false,
  })
  const hardware = (root: THREE.Object3D) => {
    const parts: THREE.Mesh[] = []
    root.traverse((part) => {
      if (part instanceof THREE.Mesh && part.userData.slotId === 'hardware') parts.push(part)
    })
    return parts
  }
  const actual = hardware(mesh)
  const expected = hardware(explicit)
  expect(actual).toHaveLength(expected.length)
  for (const [index, part] of actual.entries()) {
    expect(part.geometry).toBe(expected[index]!.geometry)
    expectVector(part.position, expected[index]!.position)
    expect(part.quaternion.equals(expected[index]!.quaternion)).toBe(true)
  }
})

test('a panic bar leaves the push face without a lever; the pull face keeps it', () => {
  const mesh = buildDoorPreviewMesh(DoorNode.parse({ panicBar: true }))
  const levers = handles(swingLeaves(mesh)[0]!)
  expect(levers).toHaveLength(1)
  expect(levers[0]!.position.z).toBeLessThan(0)
})

for (const [handleStyle, build] of [
  ['lever', leverOnRose],
  ['lever-curved', leverOnRoseCurved],
  ['knob', knobOnRose],
  ['bar', () => pullBar(true)],
  ['plate', leverOnPlate],
] as const) {
  for (const panicBar of [false, true]) {
    test(`${handleStyle} panic=${panicBar}: selected handles occupy both faces except the panic push face`, () => {
      const node = DoorNode.parse({ handleStyle, panicBar, handleHeight: 0.94 })
      const root = buildDoorPreviewMesh(node)
      root.updateMatrixWorld(true)
      const selected: THREE.Mesh[] = []
      root.traverse((part) => {
        if (part instanceof THREE.Mesh && part.geometry === build()) selected.push(part)
      })
      expect(selected).toHaveLength(panicBar ? 1 : 2)
      for (const handle of selected) {
        expect(handle.userData.slotId).toBe('hardware')
        expect(handle.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0.94 - node.height / 2)
        expect(handle.matrixWorld.determinant()).toBeGreaterThan(0)
      }
      let disabledHandles = 0
      buildDoorPreviewMesh({ ...node, handle: false }).traverse((part) => {
        if (part instanceof THREE.Mesh && part.geometry === build()) disabledHandles++
      })
      expect(disabledHandles).toBe(0)
      const pocket = buildDoorPreviewMesh({ ...node, doorType: 'pocket' })
      let cups = 0
      pocket.traverse((part) => {
        if (part instanceof THREE.Mesh && part.geometry === flushPull()) cups++
      })
      expect(cups).toBe(2)
    })
  }
}

test('default handles seat on the broad stile rather than floating above its panel', () => {
  const root = buildDoorPreviewMesh(DoorNode.parse({}))
  root.updateMatrixWorld(true)
  for (const handle of handles(swingLeaves(root)[0]!)) {
    expect(Math.abs(handle.getWorldPosition(new THREE.Vector3()).z)).toBeCloseTo(0.02, 6)
  }
})
