// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  OPENING_CASING_PROUD,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { buildDoorPreviewMesh } from '../door/door-system'
import { buildWindowPreviewMesh } from '../window/window-system'
import { OPENING_CASING_MESH_NAME } from './opening-casing-geometry'
import { generateExtrudedWall } from './wall-system'

const INCH = 0.0254
const CASING = 2 * INCH
const THICKNESS = 0.2

const wall = WallNode.parse({
  id: 'wall_casing',
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  thickness: THICKNESS,
})

/** A preview mesh built with the wall in the scene, as the systems build it. */
function built<T extends THREE.Mesh>(build: () => T): T {
  const previous = useScene.getState().nodes
  useScene.setState({ nodes: { ...previous, [wall.id]: wall } })
  try {
    return build()
  } finally {
    useScene.setState({ nodes: previous })
  }
}

/** The casing's boxes in the unit's own frame. */
function casingBounds(unit: THREE.Mesh): THREE.Box3[] {
  return unit.children
    .filter((child) => child.name === OPENING_CASING_MESH_NAME)
    .map((child) => {
      const geometry = (child as THREE.Mesh).geometry
      geometry.computeBoundingBox()
      return geometry.boundingBox!.clone()
    })
}

const window = (values: Partial<WindowNode> = {}) =>
  WindowNode.parse({
    id: 'window_casing',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.2, 0],
    width: 1.2,
    height: 1,
    sill: false,
    ...values,
  })

const door = (values: Partial<DoorNode> = {}) =>
  DoorNode.parse({
    id: 'door_casing',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
    ...values,
  })

describe('opening casing', () => {
  test('the wall is cut to the unit itself, never to its casing', () => {
    const wallMesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, wallMesh)
    const unit = window()
    try {
      const geometry = generateExtrudedWall(wall, [unit], calculateLevelMiters([wall]))
      const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
      const solid = (x: number, y: number) =>
        new THREE.Raycaster(
          new THREE.Vector3(x, y, 1),
          new THREE.Vector3(0, 0, -1),
        ).intersectObject(body).length > 0
      const [left, right] = [unit.position[0] - unit.width / 2, unit.position[0] + unit.width / 2]
      const [bottom, top] = [unit.position[1] - unit.height / 2, unit.position[1] + unit.height / 2]
      // Open right up to the unit's edges…
      expect(solid(unit.position[0], unit.position[1])).toBe(false)
      expect(solid(right - 0.005, unit.position[1])).toBe(false)
      expect(solid(unit.position[0], top - 0.005)).toBe(false)
      // …and solid wall behind every board of the casing.
      expect(solid(left - CASING / 2, unit.position[1])).toBe(true)
      expect(solid(right + CASING / 2, unit.position[1])).toBe(true)
      expect(solid(unit.position[0], top + CASING / 2)).toBe(true)
      expect(solid(unit.position[0], bottom - CASING / 2)).toBe(true)
      geometry.dispose()
    } finally {
      sceneRegistry.nodes.delete(wall.id)
    }
  })

  test('the hit proxy stays the unit size', () => {
    const mesh = built(() => buildWindowPreviewMesh(window()))
    const proxy = mesh.getObjectByName('cutout') as THREE.Mesh
    proxy.geometry.computeBoundingBox()
    const size = proxy.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(1.2, 6)
    expect(size.y).toBeCloseTo(1, 6)
  })

  test('a window is framed on both wall faces, the boards outside the faces and the opening', () => {
    const unit = window()
    const boxes = casingBounds(built(() => buildWindowPreviewMesh(unit)))
    // Head, two legs and bottom on each face.
    expect(boxes).toHaveLength(8)
    for (const box of boxes) {
      const onA = box.min.z >= THICKNESS / 2 - 1e-6
      const onB = box.max.z <= -THICKNESS / 2 + 1e-6
      expect(onA || onB).toBe(true)
      expect(box.max.z - box.min.z).toBeCloseTo(OPENING_CASING_PROUD, 6)
      const besideOpening =
        box.min.x >= unit.width / 2 - 1e-6 || box.max.x <= -unit.width / 2 + 1e-6
      const aboveOrBelow =
        box.min.y >= unit.height / 2 - 1e-6 || box.max.y <= -unit.height / 2 + 1e-6
      expect(besideOpening || aboveOrBelow).toBe(true)
    }
    const all = boxes.reduce((sum, box) => sum.union(box), new THREE.Box3())
    expect(all.min.x).toBeCloseTo(-unit.width / 2 - CASING, 6)
    expect(all.max.y).toBeCloseTo(unit.height / 2 + CASING, 6)
    expect(all.min.y).toBeCloseTo(-unit.height / 2 - CASING, 6)
    expect(all.max.z).toBeCloseTo(THICKNESS / 2 + OPENING_CASING_PROUD, 6)
  })

  test('turning a face off takes its boards away, wherever the unit faces', () => {
    for (const rotationY of [0, Math.PI]) {
      const boxes = casingBounds(
        built(() =>
          buildWindowPreviewMesh(window({ casingFaceB: false, rotation: [0, rotationY, 0] })),
        ),
      )
      expect(boxes).toHaveLength(4)
      // Face a is the wall's +z; a unit turned half round sees it at its own -z.
      const sign = rotationY === 0 ? 1 : -1
      for (const box of boxes)
        expect(box.getCenter(new THREE.Vector3()).z * sign).toBeGreaterThan(0)
    }
    const none = built(() =>
      buildWindowPreviewMesh(window({ casingFaceA: false, casingFaceB: false })),
    )
    expect(casingBounds(none)).toHaveLength(0)
  })

  test('a sill drops the bottom board under it on its own face only', () => {
    const unit = window({ sill: true, sillThickness: 0.03 })
    const boxes = casingBounds(built(() => buildWindowPreviewMesh(unit)))
    // The bottom boards span the opening; the legs carry on down to the one under the sill.
    const bottoms = boxes.filter((box) => box.max.x - box.min.x > unit.width && box.max.y < 0)
    const front = bottoms.find((box) => box.min.z > 0)
    const back = bottoms.find((box) => box.max.z < 0)
    expect(front?.max.y).toBeCloseTo(-unit.height / 2 - 0.03, 6)
    expect(back?.max.y).toBeCloseTo(-unit.height / 2, 6)
    const frontLegs = boxes.filter((box) => box.min.z > 0 && box.max.x - box.min.x < unit.width)
    expect(Math.min(...frontLegs.map((box) => box.min.y))).toBeCloseTo(-unit.height / 2 - 0.03, 6)
  })

  test('a door is cased at its head and legs, never across the floor', () => {
    const unit = door()
    const boxes = casingBounds(built(() => buildDoorPreviewMesh(unit)))
    expect(boxes).toHaveLength(6)
    for (const box of boxes) expect(box.min.y).toBeGreaterThanOrEqual(-unit.height / 2 - 1e-6)
    const all = boxes.reduce((sum, box) => sum.union(box), new THREE.Box3())
    expect(all.max.y).toBeCloseTo(unit.height / 2 + CASING, 6)
    expect(all.max.x).toBeCloseTo(unit.width / 2 + CASING, 6)
  })

  test('an arched door is cased with a band that follows its arch, clear of the opening', () => {
    const unit = door({ openingShape: 'arch', archHeight: 0.45 })
    const mesh = built(() => buildDoorPreviewMesh(unit))
    const casing = mesh.children.filter((child) => child.name === OPENING_CASING_MESH_NAME)
    expect(casing).toHaveLength(2)
    mesh.updateMatrixWorld(true)
    const hitsCasing = (x: number, y: number) =>
      new THREE.Raycaster(
        mesh.localToWorld(new THREE.Vector3(x, y, 1)),
        new THREE.Vector3(0, 0, -1),
      ).intersectObjects(casing).length
    // Over the crown and beside the legs: through both faces' bands.
    expect(hitsCasing(0, unit.height / 2 + CASING / 2)).toBeGreaterThan(0)
    expect(hitsCasing(unit.width / 2 + CASING / 2, 0)).toBeGreaterThan(0)
    // Under the crown and just inside a jamb, the opening stays clear of boards.
    expect(hitsCasing(0, unit.height / 2 - 0.01)).toBe(0)
    expect(hitsCasing(unit.width / 2 - 0.01, unit.height / 2 - 0.45 - 0.05)).toBe(0)
  })
})
