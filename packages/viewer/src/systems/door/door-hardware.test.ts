import { expect, test } from 'bun:test'
import { DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { disposeObject3DResources } from '../../lib/dispose-object3d'
import { hingeBarrel, leverOnRose, roller, roundedBox } from '../../lib/hardware-geometry'
import { buildDoorPreviewMesh, DoorSystem, poseDoorMovingParts } from './door-system'

function swingLeaves(mesh: THREE.Object3D) {
  return mesh.children.filter((child) => child.userData.pascalSwingLeaf)
}

function handles(leaf: THREE.Object3D) {
  return leaf.children.filter(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === leverOnRose(),
  )
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
              const grip = handle.localToWorld(new THREE.Vector3(0.125, 0, 0.054))
              const spindle = handle.localToWorld(new THREE.Vector3(0, 0, 0.054))
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
    const box = new THREE.Box3().setFromObject(swingLeaves(mesh)[0]!)
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

test('rebuilding a sibling keeps shared hardware usable and undisposed', async () => {
  const previous = useScene.getState()
  const firstNode = DoorNode.parse({ id: 'door_shared_first' })
  const siblingNode = DoorNode.parse({ id: 'door_shared_sibling' })
  const first = buildDoorPreviewMesh(firstNode)
  const sibling = buildDoorPreviewMesh(siblingNode)
  const geometries = [leverOnRose(), hingeBarrel()]
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
    const ray = new THREE.Raycaster(new THREE.Vector3(-0.4, -0.8, 1), new THREE.Vector3(0, 0, -1))
    expect(
      ray
        .intersectObject(sibling, true)
        .some((hit) => hit.object instanceof THREE.Mesh && hit.object.geometry === hingeBarrel()),
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
        for (const part of hardware)
          expect(part.geometry).toBe(roundedBox(0.02, 0.12, 0.006, 0.003))
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
