import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  calculateLevelMiters,
  getWallPlanFootprint,
  LevelNode,
  sceneRegistry,
  useScene,
  WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { planCornerWindow } from '@pascal-app/core/building'
import * as THREE from 'three'
import { generateExtrudedWall } from '../wall/wall-system'
import { buildWindowPreviewMesh } from './window-system'

/**
 * L65: a corner window opens the corner between its two walls, the glass fused there (`none`) or
 * meeting at the corner jambs (`post`), at any angle. What goes wrong, written first: the walls'
 * corner left solid (a stub post the user did not ask for); a fused corner still drawing its jamb;
 * the glass stopping short of the corner; a bay's 135° or an acute 60° cut as if square.
 */

const LEVEL = 'level_cw'
const previous = useScene.getState().nodes
const WALL_IDS = ['wall_cwa', 'wall_cwb']
afterEach(() => {
  useScene.setState({ nodes: previous })
  for (const id of WALL_IDS) sceneRegistry.nodes.delete(id)
})

function scene(degrees: number, post: 'none' | 'post', paired = true) {
  const rad = (degrees * Math.PI) / 180
  const a = WallNode.parse({
    id: 'wall_cwa',
    parentId: LEVEL,
    start: [4, 0],
    end: [0, 0],
    thickness: 0.2,
    height: 2.5,
  })
  const b = WallNode.parse({
    id: 'wall_cwb',
    parentId: LEVEL,
    start: [0, 0],
    end: [4 * Math.cos(rad), 4 * Math.sin(rad)],
    thickness: 0.2,
    height: 2.5,
  })
  // A wall's cutters are collected only once its mesh is registered, as the renderer has it.
  for (const wall of [a, b]) sceneRegistry.nodes.set(wall.id, new THREE.Mesh())
  const level = LevelNode.parse({ id: LEVEL, children: [a.id, b.id] })
  const base: Record<string, AnyNode> = Object.fromEntries([level, a, b].map((n) => [n.id, n]))
  const { windows } = planCornerWindow(base, { corner: [0, 0], width: 1.2, post })
  const placed = windows.map((window) => {
    if (paired) return window
    const { corner: _corner, ...plain } = window
    return plain as WindowNode
  })
  const nodes = { ...base, ...Object.fromEntries(placed.map((w) => [w.id, w])) }
  useScene.setState({ nodes: { ...previous, ...nodes } })
  return { walls: [a, b], windows: placed }
}

/** Whether a world point (x, y, z) lies inside the wall's solid, by ray parity. */
function insideWall(wall: WallNode, geometry: THREE.BufferGeometry, [x, y, z]: number[]) {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const [dx, dz] = [x! - wall.start[0], z! - wall.start[1]]
  const local = new THREE.Vector3(
    dx * Math.cos(angle) + dz * Math.sin(angle),
    y!,
    -dx * Math.sin(angle) + dz * Math.cos(angle),
  )
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const hits = new THREE.Raycaster(local, new THREE.Vector3(0, 1, 0)).intersectObject(mesh)
  return hits.length % 2 === 1
}

/**
 * A point inside the wall's own part of the corner, past its window's edge: the middle of the
 * triangle between the junction, the miter point beyond the wall's end and the wall's face there,
 * in world plan coordinates. Only the corner window's cut can open it.
 */
function cornerPoint(wall: WallNode, walls: WallNode[]) {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const atEnd = Math.hypot(wall.end[0], wall.end[1]) < 1e-6
  const toLocal = (x: number, z: number) => {
    const [dx, dz] = [x - wall.start[0], z - wall.start[1]]
    return [dx * c + dz * s, -dx * s + dz * c] as const
  }
  const footprint = getWallPlanFootprint(wall, calculateLevelMiters(walls)).map((p) =>
    toLocal(p.x, p.y),
  )
  const edge = atEnd ? length : 0
  const beyond = footprint.find(([x]) => (atEnd ? x > edge + 1e-6 : x < edge - 1e-6))!
  const [lx, lz] = [(edge + beyond[0] + edge) / 3, (2 * beyond[1]) / 3]
  return [wall.start[0] + lx * c - lz * s, 0, wall.start[1] + lx * s + lz * c]
}

for (const degrees of [90, 135, 60])
  describe(`a corner window at ${degrees}°`, () => {
    for (const post of ['none', 'post'] as const)
      test(`with ${post}, both walls are open at the corner, mid-window`, () => {
        const { walls, windows } = scene(degrees, post)
        const miters = calculateLevelMiters(walls)
        for (const [i, wall] of walls.entries()) {
          const geometry = generateExtrudedWall(wall, [windows[i]!], miters)
          const [x, , z] = cornerPoint(wall, walls)
          const midY = windows[i]!.position[1]
          expect(insideWall(wall, geometry, [x!, midY, z!])).toBe(false)
          // Under the sill the corner stays wall.
          expect(insideWall(wall, geometry, [x!, 0.3, z!])).toBe(true)
        }
      })

    test('two plain windows ending there leave the corner solid (the control)', () => {
      const { walls, windows } = scene(degrees, 'none', false)
      const miters = calculateLevelMiters(walls)
      const geometry = generateExtrudedWall(walls[0]!, [windows[0]!], miters)
      const [x, , z] = cornerPoint(walls[0]!, walls)
      expect(insideWall(walls[0]!, geometry, [x!, windows[0]!.position[1], z!])).toBe(true)
    })

    test('fused, the glass runs to the corner and no jamb stands there; with a post, it does', () => {
      for (const post of ['none', 'post'] as const) {
        const { windows } = scene(degrees, post)
        const onA = windows.find((w) => w.parentId === 'wall_cwa')!
        const mesh = buildWindowPreviewMesh(onA)
        mesh.updateMatrixWorld(true)
        const boxes = (slot: string) => {
          const found: THREE.Box3[] = []
          mesh.traverse((child) => {
            if (child instanceof THREE.Mesh && child !== mesh && child.userData.slotId === slot)
              found.push(new THREE.Box3().setFromObject(child))
          })
          return found
        }
        // Wall A ends at the corner, so its corner edge is the window's +x side (it faces front).
        const toCorner = (box: THREE.Box3) => box.max.x - onA.position[0]
        const glassReach = Math.max(...boxes('glass').map(toCorner))
        // A jamb: tall and narrow, at the corner edge (the rails run along the head and foot).
        const jambAtCorner = boxes('frame').some(
          (box) =>
            toCorner(box) > onA.width / 2 - 1e-6 &&
            box.max.y - box.min.y > onA.height / 2 &&
            box.max.x - box.min.x < onA.width / 2,
        )
        if (post === 'none') {
          expect(glassReach).toBeCloseTo(onA.width / 2, 6)
          expect(jambAtCorner).toBe(false)
        } else {
          expect(glassReach).toBeCloseTo(onA.width / 2 - onA.frameThickness, 6)
          expect(jambAtCorner).toBe(true)
        }
      }
    })
  })
