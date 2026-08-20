import { describe, expect, test } from 'bun:test'
import { hiddenWallPointerEventsHeld, holdHiddenWallPointerEvents } from '@pascal-app/core'
import {
  extractWallSelectionRay,
  HIDDEN_WALL_SELECTION_EPSILON,
  hiddenWallOutrankedOnRay,
  WALL_COLLISION_MESH_NAME,
  type WallRayObjectLike,
  wallPointerEventsSuppressed,
} from './pointer-transparency'

// Semantics pinned here (the wall renderer's gated handlers evaluate this
// predicate per pointer event):
// - nearest-first selection: a wall hidden by the wall-mode pass (Bones
//   X-ray 'down' mode) handles hover / selection events when it is the
//   closest thing on the ray — mousing over the framing highlights the
//   WALL, not the sofa two meters behind it.
// - #683 / night-5 D4 stays fixed: the hidden wall yields to its own hosted
//   openings, to anything at ~equal-or-nearer depth (device boxes at the
//   face), and to wall-mounted gear on walls further down the ray (the
//   receptacle behind an interposed hidden wall).
// - night-6 door-drag (#689): while a door / window move / place tool holds
//   hidden-wall pointer events, hidden walls keep raycasting outright —
//   the tools track the cursor through wall:enter / wall:move / wall:click
//   (#694's own-wall gate then filters those downstream).
// - delete mode keeps events regardless (deleteInvisible hover flow).
// - visible walls never suppress.

const EPS = HIDDEN_WALL_SELECTION_EPSILON

describe('wallPointerEventsSuppressed', () => {
  const base = {
    wallHidden: true,
    hoverHighlightMode: 'default' as string | null | undefined,
    hiddenWallHoldActive: false,
  }

  test('hidden wall, no ray data: pointer-transparent (#683 fallback)', () => {
    expect(wallPointerEventsSuppressed(base)).toBe(true)
  })

  test('hidden wall, nothing else on the ray: events flow (nearest-first)', () => {
    expect(
      wallPointerEventsSuppressed({
        ...base,
        selectionRay: { wallHitDistance: 5, otherHits: [] },
      }),
    ).toBe(false)
  })

  test('hidden wall in front of free-standing furniture: the WALL wins (the reported bug)', () => {
    expect(
      wallPointerEventsSuppressed({
        ...base,
        selectionRay: {
          wallHitDistance: 5,
          otherHits: [
            { distance: 7, isWallCollision: false, hostedByThisWall: false }, // sofa mid-room
            { distance: 12, isWallCollision: false, hostedByThisWall: false }, // grid / far slab
          ],
        },
      }),
    ).toBe(false)
  })

  test('hidden wall vs device box at the face: the device wins (D4 epsilon tie-break)', () => {
    expect(
      wallPointerEventsSuppressed({
        ...base,
        selectionRay: {
          wallHitDistance: 5,
          otherHits: [{ distance: 5 + EPS / 2, isWallCollision: false, hostedByThisWall: false }],
        },
      }),
    ).toBe(true)
  })

  test('hidden wall, opening tool hold: events flow regardless of the ray (#689/#694)', () => {
    expect(
      wallPointerEventsSuppressed({
        ...base,
        hiddenWallHoldActive: true,
        // Even a ray that would yield in select mode flows during a hold —
        // the MOVE tools' own-wall gate handles interposed walls downstream.
        selectionRay: {
          wallHitDistance: 5,
          otherHits: [{ distance: 5, isWallCollision: false, hostedByThisWall: false }],
        },
      }),
    ).toBe(false)
  })

  test('hidden wall, delete mode: events flow (deleteInvisible hover)', () => {
    expect(wallPointerEventsSuppressed({ ...base, hoverHighlightMode: 'delete' })).toBe(false)
  })

  test('visible wall: never suppressed, in any mode', () => {
    for (const hoverHighlightMode of ['default', 'delete', null, undefined]) {
      for (const hiddenWallHoldActive of [false, true]) {
        expect(
          wallPointerEventsSuppressed({
            wallHidden: false,
            hoverHighlightMode,
            hiddenWallHoldActive,
          }),
        ).toBe(false)
      }
    }
  })

  test('composes with the real core hold lifecycle', () => {
    const suppressedNow = () =>
      wallPointerEventsSuppressed({ ...base, hiddenWallHoldActive: hiddenWallPointerEventsHeld() })
    expect(suppressedNow()).toBe(true)
    const release = holdHiddenWallPointerEvents()
    expect(suppressedNow()).toBe(false)
    release()
    expect(suppressedNow()).toBe(true)
  })
})

describe('hiddenWallOutrankedOnRay', () => {
  test('hosted children (doors / windows) outrank at ANY depth gap — grazing angles included', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        // A door panel hit far beyond epsilon along a grazing ray.
        otherHits: [{ distance: 5 + 3 * EPS, isWallCollision: false, hostedByThisWall: true }],
      }),
    ).toBe(true)
  })

  test('hits nearer than the wall outrank it (plain distance order)', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [{ distance: 3, isWallCollision: false, hostedByThisWall: false }],
      }),
    ).toBe(true)
  })

  test('wall-mounted gear BEHIND an interposed hidden wall outranks it (D4: receptacle 2m back)', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [
          // The receptacle, sitting at its own wall's face 2m behind this one…
          { distance: 7, isWallCollision: false, hostedByThisWall: false },
          // …anchored by that wall's collision hit right behind it.
          { distance: 7 + EPS / 2, isWallCollision: true, hostedByThisWall: false },
        ],
      }),
    ).toBe(true)
  })

  test('free-standing furniture behind the wall does NOT outrank it, even with a far wall beyond', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [
          // Sofa mid-room: not near ANY wall hit on the ray.
          { distance: 7, isWallCollision: false, hostedByThisWall: false },
          // The room's far wall, well beyond the sofa.
          { distance: 10, isWallCollision: true, hostedByThisWall: false },
        ],
      }),
    ).toBe(false)
  })

  test('other walls never compete directly — the nearest hidden wall keeps the event', () => {
    // Double-wall assembly: if parallel hidden walls counted as competitors,
    // BOTH would yield and the event would fall through to the room behind.
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [{ distance: 5.1, isWallCollision: true, hostedByThisWall: false }],
      }),
    ).toBe(false)
  })
})

describe('extractWallSelectionRay', () => {
  const chain = (parent: WallRayObjectLike | null, name?: string): WallRayObjectLike => ({
    name,
    parent,
  })

  test('reduces a live event: self excluded, wall collisions flagged, subtree hits marked hosted', () => {
    const wallRoot = chain(null)
    const selfCollision = chain(wallRoot, WALL_COLLISION_MESH_NAME)
    const hostedDoorMesh = chain(chain(wallRoot)) // door mesh nested under the wall root
    const otherWallCollision = chain(chain(null), WALL_COLLISION_MESH_NAME)
    const sofaMesh = chain(chain(null))

    const ray = extractWallSelectionRay(
      {
        distance: 5,
        object: selfCollision,
        intersections: [
          { distance: 5, object: selfCollision },
          { distance: 5.2, object: hostedDoorMesh },
          { distance: 7, object: sofaMesh },
          { distance: 7.1, object: otherWallCollision },
        ],
      },
      wallRoot,
    )

    expect(ray).toEqual({
      wallHitDistance: 5,
      otherHits: [
        { distance: 5.2, isWallCollision: false, hostedByThisWall: true },
        { distance: 7, isWallCollision: false, hostedByThisWall: false },
        { distance: 7.1, isWallCollision: true, hostedByThisWall: false },
      ],
    })
  })

  test('events without ray data reduce to undefined (→ #683 transparent fallback)', () => {
    expect(extractWallSelectionRay(undefined, null)).toBeUndefined()
    expect(extractWallSelectionRay({}, null)).toBeUndefined()
    expect(extractWallSelectionRay({ distance: 5, object: chain(null) }, null)).toBeUndefined()
    expect(
      extractWallSelectionRay({ object: chain(null), intersections: [] }, null),
    ).toBeUndefined()
  })

  test('a null wall root marks nothing as hosted (wall not registered yet)', () => {
    const self = chain(null, WALL_COLLISION_MESH_NAME)
    const ray = extractWallSelectionRay(
      {
        distance: 5,
        object: self,
        intersections: [
          { distance: 5, object: self },
          { distance: 5.1, object: chain(null) },
        ],
      },
      null,
    )
    expect(ray?.otherHits).toEqual([
      { distance: 5.1, isWallCollision: false, hostedByThisWall: false },
    ])
  })
})
