import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  buildWallFinishLayout,
  clearSceneHistory,
  getWallLevelZones,
  resolveWallFinish,
  sceneRegistry,
  useScene,
  type WallNode,
  wallRoomFaceRole,
  wallRoomFinishRole,
  ZoneNode,
} from '@pascal-app/core'
import { BoxGeometry, type Material, Mesh, MeshBasicMaterial } from 'three'
import { regroupWallFaces, wallPaint } from './paint'

// One wall between two rooms: `zone_room` on side a, `zone_other` on side b.
// Room-scope painting previews exactly what it commits on every wall of the
// room; erasing clears every paint source on the room's side and nothing across.

const WALL_ID = 'wall_plan'
const wall: WallNode = {
  object: 'node',
  id: WALL_ID,
  type: 'wall',
  parentId: 'level_plan',
  visible: true,
  metadata: {},
  children: [],
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  thickness: 0.1,
  frontSide: 'unknown',
  backSide: 'unknown',
  slots: { a: 'library:face-a', b: 'library:face-b' },
  faceRegions: [
    { id: 'stripe_a', face: 'a', u0: 1, u1: 2, finish: 'library:stripe-a' },
    { id: 'stripe_b', face: 'b', u0: 1, u1: 2, finish: 'library:stripe-b' },
  ],
} as WallNode
const room = ZoneNode.parse({
  id: 'zone_room',
  parentId: 'level_plan',
  name: 'Room',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  boundaryWallIds: [WALL_ID],
  wallMaterial: 'library:room',
  wallOverrides: [{ wallId: WALL_ID, face: 'a', finish: 'library:accent-a' }],
})
const other = ZoneNode.parse({
  id: 'zone_other',
  parentId: 'level_plan',
  name: 'Other',
  polygon: [
    [0, -3],
    [4, -3],
    [4, 0],
    [0, 0],
  ],
  boundaryWallIds: [WALL_ID],
  wallMaterial: 'library:other',
  wallOverrides: [{ wallId: WALL_ID, face: 'b', finish: 'library:accent-b' }],
})
const level = {
  object: 'node',
  id: 'level_plan',
  type: 'level',
  parentId: null,
  visible: true,
  metadata: {},
  children: [WALL_ID, room.id, other.id],
  level: 0,
} as unknown as AnyNode

const nodes = () => useScene.getState().nodes as Record<string, any>
const commit = (role: string, materialPreset: string | undefined) =>
  wallPaint.commit!({
    node: nodes()[WALL_ID],
    role,
    material: undefined,
    materialPreset,
  })

/** A wall mesh in wall-local space: face a (+z) draws index 1, face b index 2, the rest 0. */
function wallMesh(materials: Material[]) {
  const geometry = new BoxGeometry(4, 2.5, 0.1, 8, 1, 1).translate(2, 1.25, 0)
  for (const group of geometry.groups)
    group.materialIndex = group.materialIndex === 4 ? 1 : group.materialIndex === 5 ? 2 : 0
  return new Mesh(geometry, materials)
}

const originalRaf = globalThis.requestAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  useScene.setState({
    nodes: Object.fromEntries([level, wall, room, other].map((node) => [node.id, node])),
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
})
afterEach(() => {
  sceneRegistry.nodes.delete(WALL_ID)
  useScene.setState({ nodes: {}, materials: {} } as never)
  globalThis.requestAnimationFrame = originalRaf
})

describe('wall paint plan', () => {
  test('erasing a room clears every paint source on its side, and nothing across', () => {
    commit(wallRoomFinishRole(room.id), undefined)
    const after = nodes()
    expect(after[room.id].wallMaterial).toBeUndefined()
    expect(after[room.id].wallOverrides).toBeUndefined()
    expect(after[WALL_ID].slots).toEqual({ b: 'library:face-b' })
    expect(after[WALL_ID].faceRegions.map((region: { id: string }) => region.id)).toEqual([
      'stripe_b',
    ])
    // The room across the wall keeps everything.
    expect(after[other.id]).toEqual(other)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('erasing a face clears that face in its room and holds it to its own look', () => {
    commit(wallRoomFaceRole(room.id, 'a'), undefined)
    const after = nodes()
    expect(after[WALL_ID].slots).toEqual({ b: 'library:face-b' })
    expect(after[WALL_ID].faceRegions.map((region: { id: string }) => region.id)).toEqual([
      'stripe_b',
    ])
    expect(after[room.id].wallOverrides).toEqual([
      { wallId: WALL_ID, face: 'a', finish: 'library:concrete-drywall' },
    ])
    expect(after[room.id].wallMaterial).toBe('library:room')
    expect(after[other.id]).toEqual(other)
  })

  test('the room scope previews exactly the triangles its commit repaints', () => {
    const base = [0, 1, 2, 3].map(() => new MeshBasicMaterial())
    const mesh = wallMesh(base)
    sceneRegistry.nodes.set(WALL_ID, mesh)
    const originalGroups = mesh.geometry.groups.map((group) => ({ ...group }))
    const restore = wallPaint.applyPreview({
      node: nodes()[WALL_ID],
      role: wallRoomFinishRole(room.id),
      material: undefined,
      materialPreset: 'library:preset-tomato',
      root: mesh,
    })
    const previewMaterials = mesh.material as Material[]
    const paintIndex = previewMaterials.length - 1
    const previewGroups = mesh.geometry.groups.map((group) => ({ ...group }))

    // Which triangles the committed scene draws with the new finish.
    commit(wallRoomFinishRole(room.id), 'library:preset-tomato')
    const committed = nodes()
    const layout = buildWallFinishLayout(
      committed[WALL_ID],
      getWallLevelZones(committed[WALL_ID], committed),
    )
    const expected = regroupWallFaces(mesh.geometry, committed[WALL_ID], (face, u, v) => {
      const hit = resolveWallFinish(layout, face, u, v)
      return hit.source !== 'slot' && hit.ref === 'library:preset-tomato' ? paintIndex : -1
    })
    const painted = (groups: typeof previewGroups) =>
      groups
        .filter((group) => group.materialIndex === paintIndex)
        .map((group) => [group.start, group.count])
    expect(painted(previewGroups).length).toBeGreaterThan(0)
    expect(painted(previewGroups)).toEqual(painted(expected!))
    // The painted part of face a (the stripe) stays; face b never takes it.
    expect(previewGroups.some((group) => group.materialIndex === 2)).toBe(true)

    restore?.()
    expect(mesh.material).toBe(base)
    expect(mesh.geometry.groups).toEqual(originalGroups)
  })

  test('the erase preview shows the room side as it looks once erased', () => {
    const base = [0, 1, 2, 3, 4, 5, 6].map(() => new MeshBasicMaterial())
    const mesh = wallMesh(base)
    sceneRegistry.nodes.set(WALL_ID, mesh)
    const restore = wallPaint.applyPreview({
      node: nodes()[WALL_ID],
      role: wallRoomFinishRole(room.id),
      material: undefined,
      materialPreset: undefined,
      root: mesh,
    })
    const groups = mesh.geometry.groups
    // Face a's triangles now draw the face's default look (a material added
    // after the palette); face b keeps its own indices.
    const aFace = groups.filter((group) => group.materialIndex! >= base.length)
    expect(aFace.length).toBeGreaterThan(0)
    expect(groups.some((group) => group.materialIndex === 2)).toBe(true)
    restore?.()
  })
})
