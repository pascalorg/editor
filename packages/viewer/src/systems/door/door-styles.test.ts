import { describe, expect, test } from 'bun:test'
import { DoorNode, useScene, WallNode } from '@pascal-app/core'
import { DOOR_STYLES, doorStyleLook } from '@pascal-app/core/building'
import * as THREE from 'three'
import { buildDoorPreviewMesh } from './door-system'

/**
 * A front door, style "modern" ("flat slab"), rendered its frame and no leaf, so
 * the porch read as an open passage. A door style is a leaf look: whatever the style, the closed
 * leaf covers its opening.
 */
/** The boxes of a door's leaf meshes (its panels and glass), as the preview builds them. */
function leafBoxes(style: (typeof DOOR_STYLES)[number], slots = ['panel', 'glass']) {
  const wall = WallNode.parse({
    id: 'wall_style_test',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.25,
  })
  const door = DoorNode.parse({
    id: 'door_style_test',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.15, 0],
    width: 1,
    height: 2.3,
    ...doorStyleLook(style),
  })
  const previous = useScene.getState().nodes
  useScene.setState({ nodes: { ...previous, [wall.id]: wall } })
  const mesh = buildDoorPreviewMesh(door)
  useScene.setState({ nodes: previous })
  mesh.updateMatrixWorld(true)
  const leaves: THREE.Box3[] = []
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child === mesh || !child.visible) return
    if (!slots.includes(child.userData.slotId)) return
    leaves.push(new THREE.Box3().setFromObject(child))
  })
  return { door, leaves }
}

function leafCoverage(style: (typeof DOOR_STYLES)[number]) {
  const { door, leaves } = leafBoxes(style)
  const [cx, cy] = [door.position[0], door.position[1]]
  const misses: string[] = []
  for (let i = 1; i < 10; i++)
    for (let j = 1; j < 10; j++) {
      const point = new THREE.Vector3(cx - 0.5 + (i / 10) * 1, cy - 1.15 + (j / 10) * 2.3, 0)
      const covered = leaves.some(
        (box) =>
          point.x >= box.min.x &&
          point.x <= box.max.x &&
          point.y >= box.min.y &&
          point.y <= box.max.y,
      )
      if (!covered) misses.push(`(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`)
    }
  return misses
}

describe('door styles', () => {
  for (const style of DOOR_STYLES)
    test(`a ${style} door's leaf covers its opening`, () => {
      expect(leafCoverage(style)).toEqual([])
    })
})

/**
 * The raised inner panels of a panelled leaf are on both of its faces: seen from the street or
 * from the hall, a six-panel door shows its six panels (the user, 2026-10-06, on :3102).
 */
function panelFaces(style: (typeof DOOR_STYLES)[number]) {
  const centres = leafBoxes(style, ['panel']).leaves.map((box) => (box.min.z + box.max.z) / 2)
  return { front: centres.some((z) => z > 0.001), back: centres.some((z) => z < -0.001) }
}

describe('panelled door styles', () => {
  for (const style of ['six-panel', 'shaker', 'half-louvered'] as const)
    test(`a ${style} door shows its panels on both faces`, () => {
      expect(panelFaces(style)).toEqual({ front: true, back: true })
    })
})
