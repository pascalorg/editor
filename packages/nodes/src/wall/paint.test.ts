import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry, useScene, type WallNode, ZoneNode } from '@pascal-app/core'
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Ray, Vector3 } from 'three'
import {
  parseWallPaintRole,
  resolveWallRole,
  wallPaint,
  wallRegionRole,
  wallRoomFaceRole,
  wallRoomFinishRole,
} from './paint'

const baseWall: WallNode = {
  object: 'node',
  id: 'wall_test',
  type: 'wall',
  parentId: 'level_test',
  visible: true,
  metadata: {},
  children: [],
  start: [0, 0],
  end: [4, 0],
  height: 2.5,
  thickness: 0.1,
  frontSide: 'unknown',
  backSide: 'unknown',
}

// A room on side a of the wall (z > 0 is left of start → end).
const room = ZoneNode.parse({
  id: 'zone_room',
  parentId: 'level_test',
  name: 'Room',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  boundaryWallIds: ['wall_test'],
  wallMaterial: 'library:room',
})

function scene(wall: WallNode, zones: ZoneNode[] = []): Record<string, AnyNode> {
  return Object.fromEntries(
    [
      {
        object: 'node',
        id: 'level_test',
        type: 'level',
        parentId: null,
        visible: true,
        metadata: {},
        children: [wall.id, ...zones.map((zone) => zone.id)],
        level: 0,
      } as unknown as AnyNode,
      wall,
      ...zones,
    ].map((node) => [node.id, node]),
  )
}

const hitA = { materialIndex: null, normal: [0, 0, 1] as const }
const hitB = { materialIndex: null, normal: [0, 0, -1] as const }

const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})
afterEach(() => {
  useScene.setState({ nodes: {}, materials: {} } as never)
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

describe('resolveWallRole', () => {
  test('a face hit paints the face it lies on, whatever material index it drew with', () => {
    // Index 2 is face b's chain, but a region on face a may draw with that same finish.
    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 2,
        normal: [0, 0, 1],
        localPosition: [1, 1, 0.05],
        nodes: {},
      }),
    ).toBe('a')
    expect(
      resolveWallRole({ node: baseWall, ...hitB, localPosition: [1, 1, -0.05], nodes: {} }),
    ).toBe('b')
    // Without a hit point there is no face to name.
    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 1,
        normal: undefined,
        localPosition: undefined,
      }),
    ).toBeNull()
    // A justified body sits off the reference line; the side is read from its centre.
    const justified = { ...baseWall, justification: 'a' as const }
    expect(
      resolveWallRole({ node: justified, ...hitA, localPosition: [1, 1, 0.1], nodes: {} }),
    ).toBe('a')
    expect(resolveWallRole({ node: justified, ...hitB, localPosition: [1, 1, 0], nodes: {} })).toBe(
      'b',
    )
    // End caps and near-grazing hits pick no face.
    expect(
      resolveWallRole({
        node: baseWall,
        materialIndex: 0,
        normal: [1, 0, 0],
        localPosition: [4, 1, 0],
        nodes: {},
      }),
    ).toBeNull()
  })

  test('curved walls judge the face against the arc, not the chord', () => {
    // Sagitta 1 on a 4 m chord: radius 2.5 about (2, 1.5); the arc bulges to local -z
    // and its left face (a) looks at the centre.
    const arc = { ...baseWall, curveOffset: 1 }
    const onFaceA = [2, 1, -0.95] as const
    expect(resolveWallRole({ node: arc, ...hitA, localPosition: onFaceA, nodes: {} })).toBe('a')
    const onFaceB = [2, 1, -1.05] as const
    expect(resolveWallRole({ node: arc, ...hitB, localPosition: onFaceB, nodes: {} })).toBe('b')
    // Near an end the chord-local side flips while the face does not.
    const angle = Math.atan2(-1.5, -2) + 0.15
    const point = [2 + Math.cos(angle) * 2.45, 1.5 + Math.sin(angle) * 2.45] as const
    const inward = [-Math.cos(angle), 0, -Math.sin(angle)] as const
    expect(
      resolveWallRole({
        node: arc,
        materialIndex: null,
        normal: inward,
        localPosition: [point[0], 1, point[1]],
        nodes: {},
      }),
    ).toBe('a')
  })

  test('a hit inside a paint region paints the region; outside it, the face', () => {
    const wall = {
      ...baseWall,
      faceRegions: [{ id: 'wainscot', face: 'a' as const, v1: 0.9, finish: 'library:wood' }],
    }
    const nodes = scene(wall)
    expect(resolveWallRole({ node: wall, ...hitA, localPosition: [1, 0.5, 0.05], nodes })).toBe(
      wallRegionRole('wainscot'),
    )
    expect(resolveWallRole({ node: wall, ...hitA, localPosition: [1, 1.5, 0.05], nodes })).toBe('a')
    expect(resolveWallRole({ node: wall, ...hitB, localPosition: [1, 0.5, -0.05], nodes })).toBe(
      'b',
    )
  })

  test('a face carrying its room finish paints this wall face inside that room', () => {
    const nodes = scene(baseWall, [room])
    expect(resolveWallRole({ node: baseWall, ...hitA, localPosition: [1, 1, 0.05], nodes })).toBe(
      wallRoomFaceRole('zone_room', 'a'),
    )
    // The outside face belongs to no room.
    expect(resolveWallRole({ node: baseWall, ...hitB, localPosition: [1, 1, -0.05], nodes })).toBe(
      'b',
    )
  })

  test('direct trim slot hits win and expose trim default materials', () => {
    expect(
      resolveWallRole({
        node: baseWall,
        hitObject: { userData: { slotId: 'aCrown' } },
        materialIndex: null,
        normal: undefined,
        localPosition: undefined,
      }),
    ).toBe('aCrown')

    expect(
      wallPaint.getEffectiveMaterial?.({
        materials: useScene.getState().materials,
        node: baseWall,
        role: 'aCrown',
        nodes: { [baseWall.id]: baseWall },
      }),
    ).toEqual({ material: undefined, materialPreset: 'library:preset-white' })
  })

  test('prefers trim child ray hits over the broad wall face role', () => {
    const root = new Object3D()
    const trim = new Mesh(new BoxGeometry(1, 1, 0.08), new MeshBasicMaterial())
    trim.userData.slotId = 'bSkirting'
    root.add(trim)
    root.updateMatrixWorld(true)
    sceneRegistry.nodes.set(baseWall.id, root)

    try {
      expect(
        resolveWallRole({
          node: baseWall,
          hitObject: { userData: {} },
          materialIndex: 1,
          normal: [0, 0, 1],
          localPosition: [0, 1, 0.05],
          ray: new Ray(new Vector3(0, 0, 1), new Vector3(0, 0, -1)),
        }),
      ).toBe('bSkirting')
    } finally {
      sceneRegistry.nodes.delete(baseWall.id)
      trim.geometry.dispose()
      ;(trim.material as MeshBasicMaterial).dispose()
    }
  })
})

describe('wall paint roles', () => {
  test('parse every role the wall resolves or offers', () => {
    expect(parseWallPaintRole('a')).toEqual({ kind: 'slot', slotId: 'a' })
    expect(parseWallPaintRole('bChairRail')).toEqual({ kind: 'slot', slotId: 'bChairRail' })
    expect(parseWallPaintRole('region:r1')).toEqual({ kind: 'region', regionId: 'r1' })
    expect(parseWallPaintRole(wallRoomFinishRole('zone_x'))).toEqual({
      kind: 'room',
      zoneId: 'zone_x',
    })
    expect(parseWallPaintRole(wallRoomFaceRole('zone_x', 'b'))).toEqual({
      kind: 'room-face',
      zoneId: 'zone_x',
      face: 'b',
    })
    for (const retired of ['interior', 'lowerInterior', 'room:', 'room:z/c', 'region:'])
      expect(parseWallPaintRole(retired)).toBeNull()
  })

  test('commits land on the face slot, the region, the room override and the room', () => {
    const wall = {
      ...baseWall,
      faceRegions: [{ id: 'wainscot', face: 'a' as const, v1: 0.9, finish: 'library:wood' }],
    }
    useScene.setState({ nodes: scene(wall, [room]), materials: {} } as never)
    const commit = (role: string, materialPreset: string | undefined) =>
      wallPaint.commit!({
        node: useScene.getState().nodes[wall.id]!,
        role,
        material: undefined,
        materialPreset,
      })
    const nodes = () => useScene.getState().nodes as Record<string, any>

    commit('a', 'library:face')
    expect(nodes()[wall.id].slots).toEqual({ a: 'library:face' })

    commit(wallRegionRole('wainscot'), 'library:tile')
    expect(nodes()[wall.id].faceRegions[0].finish).toBe('library:tile')

    commit(wallRoomFaceRole('zone_room', 'a'), 'library:accent')
    expect(nodes().zone_room.wallOverrides).toEqual([
      { wallId: wall.id, face: 'a', finish: 'library:accent' },
    ])
    expect(
      wallPaint.getEffectiveMaterial?.({
        materials: useScene.getState().materials,
        node: nodes()[wall.id],
        role: wallRoomFaceRole('zone_room', 'a'),
        nodes: nodes(),
      }),
    ).toEqual({ material: undefined, materialPreset: 'library:accent' })

    // Painting the room: every face turned to it takes the finish, so the
    // room's overrides give way.
    commit(wallRoomFinishRole('zone_room'), 'library:new-room')
    expect(nodes().zone_room.wallMaterial).toBe('library:new-room')
    expect('wallOverrides' in nodes().zone_room).toBe(false)

    // Erasing a face inside the room clears everything on it — its own paint
    // and its painted parts — and holds it to its own look against the room's.
    commit(wallRoomFaceRole('zone_room', 'a'), undefined)
    expect(nodes()[wall.id].slots?.a).toBeUndefined()
    expect(nodes()[wall.id].faceRegions).toBeUndefined()
    expect(nodes().zone_room.wallOverrides).toEqual([
      { wallId: wall.id, face: 'a', finish: 'library:concrete-drywall' },
    ])
    expect(nodes().zone_room.wallMaterial).toBe('library:new-room')
    expect(
      wallPaint.buildPatch({
        node: wall,
        role: 'region:wainscot',
        material: undefined,
        materialPreset: 'x',
      }),
    ).toEqual({})
  })

  test('the face picker reads migrated legacy finishes', () => {
    const wall = {
      ...baseWall,
      legacyFaceMaterials: { b: { materialPreset: 'library:legacy-b' } },
      materialPreset: 'library:legacy-wall',
    }
    const effective = (role: string) =>
      wallPaint.getEffectiveMaterial?.({
        materials: useScene.getState().materials,
        node: wall,
        role,
        nodes: { [wall.id]: wall },
      })
    expect(effective('b')).toEqual({ material: undefined, materialPreset: 'library:legacy-b' })
    expect(effective('a')).toEqual({ material: undefined, materialPreset: 'library:legacy-wall' })
    expect(wallPaint.roleLabel?.(wall, wallRoomFinishRole('zone_room'))).toBe('Room')
  })
})
