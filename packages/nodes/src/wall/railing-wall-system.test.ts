import { afterEach, expect, test } from 'bun:test'
import {
  DoorNode,
  LevelNode,
  nodeRegistry,
  railingWallDefaults,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { buildDoorPreviewMesh, runWallBuildFrame } from '@pascal-app/viewer'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { curtainWallGeometryAdapter } from './curtain-wall-adapter'
import { wallDefinition } from './definition'
import { withRailingWalls } from './railing-wall-adapter'
import { RAILING_FRAME_MATERIAL_INDEX } from './railing-wall-geometry'

const adapter = withRailingWalls(curtainWallGeometryAdapter)
const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.clear()
  useScene.setState(initial)
})

test('the wall system builds a railing as its guard, open at its door, and follows the door live', () => {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [6, 0],
    ...railingWallDefaults(),
  })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 0.457, 0],
    width: 0.9,
    height: 0.9144,
    openingKind: 'opening',
  })
  wall.children = [door.id]
  level.children = [wall.id]
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall, [door.id]: door },
    dirtyNodes: new Set([wall.id]),
  })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(undefined, [material, material, material])
  sceneRegistry.nodes.set(wall.id, mesh)
  sceneRegistry.byType.wall!.add(wall.id)
  // Rays across the railing from its face a side (+z, the wall's frame).
  const hit = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(mesh, false)
  try {
    runWallBuildFrame(adapter)
    // The bottom rail beside the gap, the gap itself, and the air over the guard.
    expect(hit(1, 0.13)[0]?.face?.materialIndex).toBe(RAILING_FRAME_MATERIAL_INDEX)
    expect(hit(3, 0.13)).toHaveLength(0)
    expect(hit(3, 0.5)).toHaveLength(0)
    expect(hit(1, 1.2)).toHaveLength(0)
    // The door dragged along the railing takes its gap with it.
    useLiveNodeOverrides.getState().set(door.id, { position: [1, 0.457, 0] })
    useScene.getState().markDirty(wall.id)
    runWallBuildFrame(adapter)
    expect(hit(1, 0.13)).toHaveLength(0)
    expect(hit(3, 0.13)[0]?.face?.materialIndex).toBe(RAILING_FRAME_MATERIAL_INDEX)
    expect(useScene.getState().nodes[door.id]).toBe(door)
  } finally {
    mesh.geometry.dispose()
    material.dispose()
  }
})

test('hosted doors render only their gap on railings and keep their content on solid walls', () => {
  const restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  nodeRegistry._register(wallDefinition)
  try {
    for (const wallType of ['railing', 'standard'] as const) {
      const wall = WallNode.parse({ wallType, start: [0, 0], end: [6, 0] })
      const door = DoorNode.parse({ parentId: wall.id, wallId: wall.id, openingKind: 'door' })
      useScene.setState({ nodes: { [wall.id]: wall, [door.id]: door } })
      const mesh = buildDoorPreviewMesh(door)
      try {
        expect(mesh.getObjectByName('cutout')).toBeDefined()
        const content = mesh.children.filter((child) => child.name !== 'cutout')
        if (wallType === 'railing') expect(content).toHaveLength(0)
        else expect(content.length).toBeGreaterThan(0)
      } finally {
        mesh.traverse((object) => {
          if (object instanceof Mesh) object.geometry.dispose()
        })
      }
    }
  } finally {
    restore()
  }
})
