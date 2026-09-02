import { describe, expect, test } from 'bun:test'
import { resolveServicePlacement, SERVICE_BODY } from './placement'
import { SERVICE_TYPES, ServiceNode } from './schema'

describe('ServiceNode schema', () => {
  test('parses a wall-mounted panel point', () => {
    const node = ServiceNode.parse({
      serviceType: 'panel',
      wallId: 'wall_1',
      wallT: 0.5,
      heightAff: 1.52,
    })
    expect(node.type).toBe('bones:service')
    expect(node.id.startsWith('bonesservice')).toBe(true)
    expect(node.serviceType).toBe('panel')
    expect(node.position).toEqual([0, 0, 0])
  })

  test('parses a floor-placed sewer exit with position only', () => {
    const node = ServiceNode.parse({ serviceType: 'sewer-exit', position: [3, 0, -2] })
    expect(node.wallId).toBeUndefined()
    expect(node.position).toEqual([3, 0, -2])
  })

  test('rejects unknown service types and out-of-range wallT', () => {
    expect(() => ServiceNode.parse({ serviceType: 'hvac-unit' })).toThrow()
    expect(() => ServiceNode.parse({ serviceType: 'panel', wallT: 1.5 })).toThrow()
    expect(() => ServiceNode.parse({ serviceType: 'panel', wallT: -0.1 })).toThrow()
  })

  test('every service type has a body + sign spec', () => {
    for (const t of SERVICE_TYPES) {
      expect(SERVICE_BODY[t].dims.length).toBe(3)
      expect(SERVICE_BODY[t].sign.length).toBeGreaterThan(0)
    }
  })

  test('yawOverride (HP polish item 4): additive + nullable — number, null, absent all parse; junk rejected', () => {
    // absent: legacy nodes never re-parse — the field must be optional
    const absent = ServiceNode.parse({ serviceType: 'heat-pump', position: [3, 0, -2] })
    expect(absent.yawOverride).toBeUndefined()
    // set: the host rotate gestures write a plain radians number
    const spun = ServiceNode.parse({
      serviceType: 'heat-pump',
      position: [3, 0, -2],
      yawOverride: -1.25,
    })
    expect(spun.yawOverride).toBe(-1.25)
    // null: an explicit clear (back to wall-square) without deleting the node
    const cleared = ServiceNode.parse({
      serviceType: 'heat-pump',
      position: [3, 0, -2],
      yawOverride: null,
    })
    expect(cleared.yawOverride).toBeNull()
    // junk stays out
    expect(() =>
      ServiceNode.parse({ serviceType: 'heat-pump', yawOverride: 'east' }),
    ).toThrow()
  })
})

describe('resolveServicePlacement', () => {
  const scene = {
    wall_1: { id: 'wall_1', type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.12 },
  } as Record<string, Record<string, unknown>>

  test('wall-anchored: lerps start→end at wallT, height from heightAff', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'panel',
      wallId: 'wall_1',
      wallT: 0.25,
      heightAff: 1.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p).not.toBeNull()
    expect(p?.wallMounted).toBe(true)
    expect(p?.position[0]).toBeCloseTo(1, 6)
    expect(p?.position[1]).toBeCloseTo(1.5, 6)
    expect(p?.position[2]).toBeCloseTo(0, 6)
    expect(p?.wallThickness).toBeCloseTo(0.12, 6)
    // +X wall → normal [0, 1] → yaw 0 maps local +Z onto the normal
    expect(p?.rotationY).toBeCloseTo(0, 6)
  })

  test('moved position on a floor type wins over a dead wall anchor', () => {
    const p = resolveServicePlacement({}, {
      serviceType: 'sewer-exit',
      wallId: 'wall_gone',
      wallT: 0.5,
      position: [3, 0, -2],
      rotation: [0, 1.2, 0],
    })
    expect(p?.wallMounted).toBe(false)
    expect(p?.position[0]).toBe(3)
    expect(p?.position[2]).toBe(-2)
    // floor default height for the sewer stub center
    expect(p?.position[1]).toBeCloseTo(0.15, 6)
    expect(p?.rotationY).toBeCloseTo(1.2, 6)
  })

  test('clamps wallT into the wall segment', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'water-entry',
      wallId: 'wall_1',
      wallT: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p?.position[0]).toBeCloseTo(4, 6)
  })

  // GATE (gizmo precedence): a position moved off the schema default OUTRANKS
  // the wall anchor — otherwise host gizmo drags write `position` and nothing
  // moves. Wall types snap back to the NEAREST wall; floor types stand free.
  test('gizmo-moved position outranks a live wall anchor (wall type snaps to nearest wall)', () => {
    const twoWalls = {
      ...scene,
      wall_2: { id: 'wall_2', type: 'wall', start: [0, 3], end: [4, 3], thickness: 0.2 },
    } as Record<string, Record<string, unknown>>
    const p = resolveServicePlacement(twoWalls, {
      serviceType: 'panel',
      wallId: 'wall_1', // anchored to wall_1 at z=0…
      wallT: 0.25,
      heightAff: 1.5,
      position: [3, 0, 2.6], // …but dragged next to wall_2 at z=3
      rotation: [0, 0, 0],
    })
    expect(p).not.toBeNull()
    expect(p?.wallMounted).toBe(true)
    expect(p?.position[0]).toBeCloseTo(3, 6)
    expect(p?.position[2]).toBeCloseTo(3, 6) // snapped onto wall_2
    expect(p?.position[1]).toBeCloseTo(1.5, 6)
    expect(p?.wallThickness).toBeCloseTo(0.2, 6)
  })

  test('gizmo-moved position on a floor type stays free even with a live wall anchor', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'sewer-exit',
      wallId: 'wall_1',
      wallT: 0.5,
      position: [2, 0, 1.5],
      rotation: [0, 0, 0],
    })
    expect(p?.wallMounted).toBe(false)
    expect(p?.position[0]).toBeCloseTo(2, 6)
    expect(p?.position[2]).toBeCloseTo(1.5, 6)
  })

  test('default position with a live wall anchor still follows the wall (drag round-trip)', () => {
    // The schema default [0,0,0] means "never moved" — the wall rule holds.
    const p = resolveServicePlacement(scene, {
      serviceType: 'panel',
      wallId: 'wall_1',
      wallT: 0.75,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p?.wallMounted).toBe(true)
    expect(p?.position[0]).toBeCloseTo(3, 6)
  })

  // GATE (dead anchors): missing/curved/foreign wallId + never-moved position
  // is NOT a placement — null, so the engines auto-place and the renderer
  // shows only the selectable stub (no teleport to the origin-nearest wall).
  test('missing wall + default position → null (no placement)', () => {
    const p = resolveServicePlacement({}, {
      serviceType: 'panel',
      wallId: 'wall_gone',
      wallT: 0.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p).toBeNull()
  })

  test('curved wall + default position → null (the lerp would be a chord)', () => {
    const curvedScene = {
      wall_c: {
        id: 'wall_c',
        type: 'wall',
        start: [0, 0],
        end: [4, 0],
        curveOffset: 0.5,
        thickness: 0.12,
      },
    } as Record<string, Record<string, unknown>>
    const p = resolveServicePlacement(curvedScene, {
      serviceType: 'panel',
      wallId: 'wall_c',
      wallT: 0.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p).toBeNull()
  })

  // GATE (NaN guards): hostile numbers must never leak into the placement —
  // NaN wallT → wall midpoint, NaN position components → treated as
  // never-moved, NaN heightAff → the type default. No NaN in ANY output.
  test('NaN wallT falls back to the wall midpoint, not a NaN lerp', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'panel',
      wallId: 'wall_1',
      wallT: Number.NaN,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p?.wallMounted).toBe(true)
    expect(p?.position[0]).toBeCloseTo(2, 6) // midpoint of [0,0]→[4,0]
    for (const v of p?.position ?? []) expect(Number.isFinite(v)).toBe(true)
  })

  test('NaN position components count as never-moved: the wall anchor holds', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'panel',
      wallId: 'wall_1',
      wallT: 0.25,
      position: [Number.NaN, 0, Number.NaN],
      rotation: [0, 0, 0],
    })
    expect(p?.wallMounted).toBe(true)
    expect(p?.position[0]).toBeCloseTo(1, 6)
    for (const v of p?.position ?? []) expect(Number.isFinite(v)).toBe(true)
  })

  test('NaN position + missing wall → null (never a NaN-positioned node)', () => {
    const p = resolveServicePlacement({}, {
      serviceType: 'sewer-exit',
      position: [Number.NaN, Number.NaN, Number.NaN],
      rotation: [0, 0, 0],
    })
    expect(p).toBeNull()
  })

  test('NaN heightAff and NaN rotation fall back to defaults', () => {
    const p = resolveServicePlacement(scene, {
      serviceType: 'water-entry',
      wallId: 'wall_1',
      wallT: 0.5,
      heightAff: Number.NaN,
      position: [0, 0, 0],
      rotation: [0, Number.NaN, 0],
    })
    expect(p?.position[1]).toBeCloseTo(SERVICE_BODY['water-entry'].defaultAff, 6)
    const free = resolveServicePlacement({}, {
      serviceType: 'sewer-exit',
      heightAff: Number.NaN,
      position: [2, 0, 2],
      rotation: [0, Number.NaN, 0],
    })
    expect(free?.position[1]).toBeCloseTo(SERVICE_BODY['sewer-exit'].defaultAff, 6)
    expect(free?.rotationY).toBe(0)
    for (const v of [...(p?.position ?? []), p?.rotationY ?? 0, free?.rotationY ?? 0]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  test('foreign-level wall + default position → null (positions are level-local)', () => {
    const twoLevels = {
      wall_up: {
        id: 'wall_up',
        type: 'wall',
        parentId: 'level_2',
        start: [0, 0],
        end: [4, 0],
        thickness: 0.12,
      },
    } as Record<string, Record<string, unknown>>
    const p = resolveServicePlacement(twoLevels, {
      serviceType: 'panel',
      parentId: 'level_1',
      wallId: 'wall_up',
      wallT: 0.5,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    })
    expect(p).toBeNull()
  })
})
