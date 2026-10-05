// @ts-expect-error — bun:test is provided by the Bun runtime.
import { describe, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  DoorNode,
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import * as THREE from 'three'
import { generateExtrudedWall } from '../wall/wall-system'
import { buildDoorPreviewMesh, DoorSystem } from './door-system'

const WALL_THICKNESS = 0.24

function fixture(patch: Partial<DoorNode> = {}, wallYaw = 0) {
  const wall = WallNode.parse({
    id: 'wall_proxy_test',
    start: [0, 0],
    end: [5, 0],
    height: 3.5,
    thickness: WALL_THICKNESS,
  })
  const node = DoorNode.parse({
    id: 'door_proxy_test',
    parentId: wall.id,
    wallId: wall.id,
    position: [2.5, 1.4, 0],
    width: 1.8,
    height: 2.8,
    frameDepth: 0.16,
    ...patch,
  })
  const previousNodes = useScene.getState().nodes
  useScene.setState({ nodes: { ...previousNodes, [wall.id]: wall } })
  const door = buildDoorPreviewMesh(node)
  useScene.setState({ nodes: previousNodes })
  const host = new THREE.Group()
  host.position.set(4, 2, -3)
  host.rotation.y = wallYaw
  const collision = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, WALL_THICKNESS))
  collision.name = 'wall-collision'
  collision.position.set(2.5, 1.75, 0)
  collision.visible = false
  host.add(collision, door)
  host.updateMatrixWorld(true)
  const proxy = door.getObjectByName('cutout') as THREE.Mesh
  return {
    node,
    wall,
    door,
    host,
    proxy,
    collision,
    hits(side: number, x = node.position[0]) {
      const origin = host.localToWorld(new THREE.Vector3(x, node.position[1], side * 3))
      const direction = new THREE.Vector3(0, 0, -side).transformDirection(host.matrixWorld)
      return new THREE.Raycaster(origin, direction).intersectObjects([collision, door], true)
    },
    dispose() {
      host.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      ;(collision.material as THREE.Material).dispose()
    },
  }
}

function ownsDoorHit(object: THREE.Object3D, door: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === door) return true
  }
  return false
}

function visibleBounds(door: THREE.Mesh) {
  const bounds = new THREE.Box3()
  for (const child of door.children) {
    if (child.name !== 'cutout') bounds.expandByObject(child, true)
  }
  return bounds
}

describe('offset door opening hit proxy', () => {
  for (const openingShape of ['rectangle', 'arch', 'rounded'] as const) {
    for (const offset of [-0.36, 0.31]) {
      for (const flipped of [false, true]) {
        for (const wallYaw of [0, Math.PI / 3]) {
          test(`${openingShape}, offset ${offset}, flipped ${flipped}, wall yaw ${wallYaw}`, () => {
            const f = fixture(
              {
                openingShape,
                openingRadiusMode: 'individual',
                openingTopRadii: [0.35, 0.12],
                position: [2.5, 1.4, offset],
                rotation: [0, flipped ? Math.PI : 0, 0],
                side: flipped ? 'back' : 'front',
              },
              wallYaw,
            )
            try {
              for (const side of [-1, 1]) {
                const hits = f.hits(side)
                expect(hits.some((hit) => hit.object === f.collision)).toBe(true)
                expect(ownsDoorHit(hits[0]!.object, f.door)).toBe(true)
                const edgeHits = f.hits(side, 3.35)
                expect(ownsDoorHit(edgeHits[0]!.object, f.door)).toBe(true)
              }
              const center = f.host.worldToLocal(f.proxy.getWorldPosition(new THREE.Vector3()))
              expect(center.x).toBeCloseTo(2.5, 8)
              expect(center.y).toBeCloseTo(1.4, 8)
              expect(center.z).toBeCloseTo(0, 8)
              f.proxy.geometry.computeBoundingBox()
              const size = f.proxy.geometry.boundingBox!.getSize(new THREE.Vector3())
              expect(size.z).toBeCloseTo(WALL_THICKNESS + 0.08, 6)
              const origin = f.host.localToWorld(new THREE.Vector3(2.5, 5, 0.7))
              const direction = new THREE.Vector3(0, -1, 0).transformDirection(f.host.matrixWorld)
              expect(new THREE.Raycaster(origin, direction).intersectObject(f.proxy)).toHaveLength(
                0,
              )
            } finally {
              f.dispose()
            }
          })
        }
      }
    }
  }

  test('centers the proxy in host coordinates when the door has a compound rotation', () => {
    const f = fixture({ position: [2.5, 1.4, 0.31], rotation: [0.12, 0.28, -0.17] }, -Math.PI / 4)
    try {
      const center = f.host.worldToLocal(f.proxy.getWorldPosition(new THREE.Vector3()))
      expect(center.distanceTo(new THREE.Vector3(2.5, 1.4, 0))).toBeLessThan(1e-8)
      for (const side of [-1, 1]) expect(ownsDoorHit(f.hits(side)[0]!.object, f.door)).toBe(true)
    } finally {
      f.dispose()
    }
  })

  for (const curveOffset of [0, -0.9, 0.9]) {
    for (const justification of ['a', 'b'] as const) {
      for (const flipped of [false, true]) {
        test(`live proxy follows the wall body: curve ${curveOffset}, side ${justification}, flipped ${flipped}`, async () => {
          const wall = WallNode.parse({
            id: 'wall_proxy_curve',
            parentId: 'level_proxy_curve',
            start: [3, -2],
            end: [9, 1],
            height: 3.5,
            thickness: WALL_THICKNESS,
            curveOffset,
            justification,
          })
          const station = 0.23
          const node = DoorNode.parse({
            id: 'door_proxy_curve',
            parentId: wall.id,
            wallId: wall.id,
            position: [getWallCurveLength(wall) * station, 1.4, 0],
            rotation: [0, flipped ? Math.PI : 0, 0],
            openingKind: 'opening',
            width: 0.9,
            height: 2.8,
          })
          const previous = useScene.getState()
          const oldDoorMesh = sceneRegistry.nodes.get(node.id)
          const oldWallMesh = sceneRegistry.nodes.get(wall.id)
          const collision = new THREE.Mesh(
            generateExtrudedWall(wall, [], calculateLevelMiters([wall])),
            new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
          )
          collision.position.set(wall.start[0], 0, wall.start[1])
          collision.rotation.y = -Math.atan2(
            wall.end[1] - wall.start[1],
            wall.end[0] - wall.start[0],
          )
          collision.visible = false
          const door = new THREE.Mesh()
          collision.add(door)
          const world = new THREE.Group()
          world.position.set(-4, 2, 7)
          world.rotation.y = -Math.PI / 5
          world.add(collision)
          sceneRegistry.nodes.set(node.id, door)
          sceneRegistry.nodes.set(wall.id, collision)
          useScene.setState({
            nodes: { ...previous.nodes, [wall.id]: wall, [node.id]: node },
            dirtyNodes: new Set([node.id]),
          })
          let renderer: Awaited<ReturnType<typeof create>> | undefined
          try {
            renderer = await create(createElement(DoorSystem))
            const frame = getWallCurveFrameAt(wall, station)
            const bodyOffset = getWallBodyCenterOffset(wall)
            world.updateMatrixWorld(true)
            const center = world.localToWorld(
              new THREE.Vector3(
                frame.point.x + frame.normal.x * bodyOffset,
                node.position[1],
                frame.point.y + frame.normal.y * bodyOffset,
              ),
            )
            const normal = new THREE.Vector3(frame.normal.x, 0, frame.normal.y).transformDirection(
              world.matrixWorld,
            )
            const tangent = new THREE.Vector3(
              frame.tangent.x,
              0,
              frame.tangent.y,
            ).transformDirection(world.matrixWorld)
            let proxy: THREE.Object3D | undefined
            for (const offset of [-0.36, 0.31, 0]) {
              await act(async () => {
                useScene.setState({
                  nodes: {
                    ...useScene.getState().nodes,
                    [node.id]: { ...node, position: [node.position[0], node.position[1], offset] },
                  },
                  dirtyNodes: new Set([node.id]),
                })
              })
              await renderer.advanceFrames(1, 1 / 60)
              world.updateMatrixWorld(true)
              proxy ??= door.getObjectByName('cutout')!
              expect(door.getObjectByName('cutout')).toBe(proxy)
              for (const side of [-1, 1]) {
                for (const along of [-0.4, 0, 0.4]) {
                  const raycaster = new THREE.Raycaster(
                    center
                      .clone()
                      .addScaledVector(normal, side * 2)
                      .addScaledVector(tangent, along),
                    normal.clone().multiplyScalar(-side),
                  )
                  const hits = raycaster.intersectObject(collision, true)
                  expect(hits.some((hit) => hit.object === collision)).toBe(true)
                  expect(ownsDoorHit(hits[0]!.object, door)).toBe(true)
                }
              }
              expect(proxy.getWorldPosition(new THREE.Vector3()).distanceTo(center)).toBeLessThan(
                1e-8,
              )
              expect(
                door
                  .getWorldPosition(new THREE.Vector3())
                  .distanceTo(center.clone().addScaledVector(normal, offset)),
              ).toBeLessThan(1e-8)
            }
          } finally {
            await renderer?.unmount()
            useScene.setState({ nodes: previous.nodes, dirtyNodes: previous.dirtyNodes })
            if (oldDoorMesh) sceneRegistry.nodes.set(node.id, oldDoorMesh)
            else sceneRegistry.nodes.delete(node.id)
            if (oldWallMesh) sceneRegistry.nodes.set(wall.id, oldWallMesh)
            else sceneRegistry.nodes.delete(wall.id)
            collision.traverse((object) => {
              if (object instanceof THREE.Mesh) object.geometry.dispose()
            })
            collision.material.dispose()
          }
        })
      }
    }
  }

  test('reuses and recenters the live proxy through offset changes and host removal', async () => {
    const f = fixture({ position: [2.5, 1.4, -0.36], rotation: [0, Math.PI, 0] }, Math.PI / 3)
    const previous = useScene.getState()
    const oldMesh = sceneRegistry.nodes.get(f.node.id)
    sceneRegistry.nodes.set(f.node.id, f.door)
    useScene.setState({
      nodes: { ...previous.nodes, [f.wall.id]: f.wall, [f.node.id]: f.node },
      dirtyNodes: new Set([f.node.id]),
    })
    const renderer = await create(createElement(DoorSystem))
    try {
      for (const offset of [-0.36, 0.31, 0]) {
        const node = { ...f.node, position: [2.5, 1.4, offset] as [number, number, number] }
        await act(async () => {
          useScene.setState({
            nodes: { ...useScene.getState().nodes, [node.id]: node },
            dirtyNodes: new Set([node.id]),
          })
        })
        await renderer.advanceFrames(1, 1 / 60)
        f.host.updateMatrixWorld(true)
        expect(f.door.getObjectByName('cutout')).toBe(f.proxy)
        expect(f.proxy.visible).toBe(false)
        const center = f.host.worldToLocal(f.proxy.getWorldPosition(new THREE.Vector3()))
        expect(center.distanceTo(new THREE.Vector3(2.5, 1.4, 0))).toBeLessThan(1e-8)
        for (const side of [-1, 1]) expect(ownsDoorHit(f.hits(side)[0]!.object, f.door)).toBe(true)
      }
      await act(async () => {
        useScene.setState({
          nodes: {
            ...useScene.getState().nodes,
            [f.node.id]: {
              ...f.node,
              parentId: null,
              wallId: undefined,
              position: [2.5, 1.4, -0.36],
            },
          },
          dirtyNodes: new Set([f.node.id]),
        })
      })
      await renderer.advanceFrames(1, 1 / 60)
      expect(f.door.getObjectByName('cutout')).toBe(f.proxy)
      expect(f.proxy.position.length()).toBe(0)
    } finally {
      await renderer.unmount()
      useScene.setState({ nodes: previous.nodes, dirtyNodes: previous.dirtyNodes })
      if (oldMesh) sceneRegistry.nodes.set(f.node.id, oldMesh)
      else sceneRegistry.nodes.delete(f.node.id)
      f.dispose()
    }
  })

  test('keeps an unhosted door proxy with the door instead of moving it to a wall plane', () => {
    const f = fixture({ parentId: undefined, wallId: undefined, position: [2.5, 1.4, 2] })
    try {
      expect(f.proxy.position.length()).toBe(0)
      expect(
        f.proxy
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(f.door.getWorldPosition(new THREE.Vector3())),
      ).toBeLessThan(1e-8)
    } finally {
      f.dispose()
    }
  })

  test('keeps an offset slider frame and panels on their authored plane', () => {
    const centered = fixture({ doorType: 'sliding' })
    const offset = fixture({ doorType: 'sliding', position: [2.5, 1.4, -0.36] })
    try {
      const original = visibleBounds(centered.door)
      const moved = visibleBounds(offset.door)
      expect(moved.min.x).toBeCloseTo(original.min.x, 8)
      expect(moved.max.x).toBeCloseTo(original.max.x, 8)
      expect(moved.min.y).toBeCloseTo(original.min.y, 8)
      expect(moved.max.y).toBeCloseTo(original.max.y, 8)
      expect(moved.min.z).toBeCloseTo(original.min.z - 0.36, 8)
      expect(moved.max.z).toBeCloseTo(original.max.z - 0.36, 8)
      expect(centered.proxy.position.length()).toBe(0)
    } finally {
      centered.dispose()
      offset.dispose()
    }
  })
})
