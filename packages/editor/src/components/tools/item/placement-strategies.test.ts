import { describe, expect, test } from 'bun:test'
import type { ItemNode, WallEvent, WallNode } from '@pascal-app/core'
import { Mesh, type Object3D, Vector3 } from 'three'
import { wallStrategy } from './placement-strategies'
import type { PlacementContext, SpatialValidators } from './placement-types'

/**
 * The wall frame the runtime builds in `updateWallGeometry`: origin at
 * `wall.start` lifted to the supporting slab's elevation, yawed by the wall
 * angle. Wall-local Y is therefore measured from the slab, NOT from world zero
 * — which is exactly why snapping the world hit and the wall-local hit
 * separately used to put the preview box and the item on different points.
 */
function makeWallFrame(wall: WallNode, slabElevation: number): Mesh {
  const wallMesh = new Mesh()
  wallMesh.position.set(wall.start[0], slabElevation, wall.start[1])
  wallMesh.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const collisionMesh = new Mesh()
  wallMesh.add(collisionMesh)
  wallMesh.updateMatrixWorld(true)
  return collisionMesh
}

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    id: 'wall_test',
    type: 'wall',
    parentId: 'level_test',
    children: [],
    start: [2.3, 1.7],
    end: [8.3, 1.7],
    thickness: 0.2,
    ...overrides,
  } as WallNode
}

function makeDraft(): ItemNode {
  return {
    id: 'item_draft',
    type: 'item',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    children: [],
    asset: {
      id: 'asset_hold',
      category: 'sport',
      name: 'Climbing hold',
      thumbnail: '',
      source: 'library',
      src: '',
      dimensions: [0.65, 0.33, 0.63],
      attachTo: 'wall-side',
      offset: [0, 0.165, 0.1],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  } as unknown as ItemNode
}

/** Front face of the wall: wall-local +Z. */
const FRONT_NORMAL: [number, number, number] = [0, 0, 1]

function makeWallEvent(wall: WallNode, collisionMesh: Object3D, localHit: Vector3): WallEvent {
  const world = collisionMesh.localToWorld(localHit.clone())
  return {
    node: wall,
    position: [world.x, world.y, world.z],
    localPosition: [localHit.x, localHit.y, localHit.z],
    normal: FRONT_NORMAL,
    object: collisionMesh,
    stopPropagation: () => undefined,
  } as unknown as WallEvent
}

const validators: SpatialValidators = {
  canPlaceOnFloor: () => ({ valid: true }),
  canPlaceOnWall: () => ({ valid: true }),
  canPlaceOnCeiling: () => ({ valid: true }),
}

function makeContext(draft: ItemNode): PlacementContext {
  return {
    asset: draft.asset,
    levelId: 'level_test',
    draftItem: draft,
    gridPosition: new Vector3(),
    state: {
      surface: 'wall',
      wallId: 'wall_test',
      roofSegmentId: null,
      ceilingId: null,
      surfaceItemId: null,
      shelfId: null,
    },
    currentCursorRotationY: 0,
  } as unknown as PlacementContext
}

describe('wallStrategy.move', () => {
  /**
   * The preview wireframe (`cursorPosition`, world) and the committed node
   * (`gridPosition`, wall-local) must describe ONE point. Snapping them
   * independently drifted the box off the item by the slab elevation plus up to
   * a grid step, and the commit then landed where the box was not.
   */
  test.each([
    ['axis-aligned wall on an elevated slab', makeWall(), 0.4],
    [
      'diagonal wall off the world grid',
      makeWall({ start: [1.15, 0.35], end: [5.15, 4.35] } as Partial<WallNode>),
      0.15,
    ],
  ])('keeps the preview box on the committed point — %s', (_label, wall, slabElevation) => {
    const collisionMesh = makeWallFrame(wall, slabElevation)
    const draft = makeDraft()
    const event = makeWallEvent(wall, collisionMesh, new Vector3(2.42, 1.38, 0.1))

    const result = wallStrategy.move(makeContext(draft), event, validators)
    if (!result) throw new Error('expected a placement result')

    const cursorFromNode = collisionMesh.localToWorld(new Vector3(...result.gridPosition))
    expect(cursorFromNode.x).toBeCloseTo(result.cursorPosition[0], 6)
    expect(cursorFromNode.y).toBeCloseTo(result.cursorPosition[1], 6)
    expect(cursorFromNode.z).toBeCloseTo(result.cursorPosition[2], 6)
  })

  test('mounts the wall-side preview on the hit face, not through the wall', () => {
    const wall = makeWall()
    const collisionMesh = makeWallFrame(wall, 0.4)
    const draft = makeDraft()
    const event = makeWallEvent(wall, collisionMesh, new Vector3(2.42, 1.38, 0.1))

    const result = wallStrategy.move(makeContext(draft), event, validators)
    if (!result) throw new Error('expected a placement result')

    // Front face → wall-local +thickness/2, matching ItemSystem's per-frame push.
    expect(result.gridPosition[2]).toBeCloseTo(0.1, 6)
    // The cursor frame IS the item frame, so the box's +Z (its depth) points out
    // of the same face the item body extends from.
    const outward = new Vector3(0, 0, 1).applyAxisAngle(
      new Vector3(0, 1, 0),
      result.cursorRotationY,
    )
    const wallNormal = new Vector3(0, 0, 1).applyAxisAngle(
      new Vector3(0, 1, 0),
      collisionMesh.parent!.rotation.y,
    )
    expect(outward.dot(wallNormal)).toBeCloseTo(1, 6)
  })

  test('carries the wall auto-adjusted Y into the preview box', () => {
    const wall = makeWall()
    const collisionMesh = makeWallFrame(wall, 0.4)
    const draft = makeDraft()
    const event = makeWallEvent(wall, collisionMesh, new Vector3(2.42, 1.38, 0.1))

    const result = wallStrategy.move(makeContext(draft), event, {
      ...validators,
      canPlaceOnWall: () => ({ valid: true, adjustedY: 0.05, wasAdjusted: true }),
    })
    if (!result) throw new Error('expected a placement result')

    expect(result.gridPosition[1]).toBeCloseTo(0.05, 6)
    expect(result.cursorPosition[1]).toBeCloseTo(0.4 + 0.05, 6)
  })
})
