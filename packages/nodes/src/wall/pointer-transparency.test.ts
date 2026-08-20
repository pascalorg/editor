import { describe, expect, test } from 'bun:test'
import { hiddenWallPointerEventsHeld, holdHiddenWallPointerEvents } from '@pascal-app/core'
import {
  extractWallSelectionRay,
  HIDDEN_WALL_SELECTION_EPSILON,
  hiddenWallOutrankedOnRay,
  type WallRayHit,
  type WallRayObjectLike,
  wallPointerEventsSuppressed,
} from './pointer-transparency'
import type { WallRayHitOwnership } from './selection-hit-owner'

// Semantics pinned here (the wall renderer's gated handlers evaluate this
// predicate per pointer event):
// - nearest-first selection over hits that OWN selection semantics: a wall
//   hidden by the wall-mode pass (Bones X-ray 'down' mode) handles hover /
//   selection events when no selectable hit outranks it — mousing over the
//   framing highlights the WALL, not the sofa two meters behind it.
// - passive hits never outrank: the live event raycast recurses through the
//   level/building wrapper groups, so Bones framing InstancedMeshes (and
//   the wall's own render mesh) land in event.intersections at the wall's
//   own depth (QA f2 probe6/probe7). Ranking by distance alone would make
//   the wall yield everywhere its overlay renders.
// - #683 / night-5 D4 stays fixed: the hidden wall yields to its own hosted
//   openings, to selectables at ~equal-or-nearer depth (device boxes at the
//   face), and to wall-mounted gear on walls further down the ray (the
//   receptacle behind an interposed hidden wall).
// - night-6 door-drag (#689): while a door / window move / place tool holds
//   hidden-wall pointer events, hidden walls keep raycasting outright —
//   the tools track the cursor through wall:enter / wall:move / wall:click
//   (#694's own-wall gate then filters those downstream).
// - delete mode keeps events regardless (deleteInvisible hover flow).
// - visible walls never suppress.

const EPS = HIDDEN_WALL_SELECTION_EPSILON

const hit = (
  distance: number,
  ownership: WallRayHitOwnership,
  hostedByThisWall = false,
): WallRayHit => ({ distance, ownership, hostedByThisWall })

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
            hit(7, 'selectable'), // sofa mid-room
            hit(12, 'passive'), // grid / helper far behind
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
          otherHits: [hit(5 + EPS / 2, 'selectable')],
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
          otherHits: [hit(5, 'selectable')],
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
  test('passive hits at the wall depth do NOT outrank (QA f2: Bones framing members)', () => {
    // probe7 session B verbatim shape: framing InstancedMesh hits ride the
    // level wrapper's handlers into the intersection list at d≈4.246–4.422,
    // the wall's own render + collision hits sit at 4.246, the bed at 6.081.
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 4.246,
        otherHits: [
          hit(4.246, 'passive'), // framing stud bucket
          hit(4.246, 'self-wall'), // own render mesh (invisible-variant material)
          hit(4.265, 'passive'),
          hit(4.266, 'passive'),
          hit(4.422, 'passive'),
          hit(6.081, 'selectable'), // Double Bed
          hit(6.271, 'selectable'),
        ],
      }),
    ).toBe(false)
  })

  test("the wall's own render/collision hits are neutral — never self-defeating", () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [hit(5, 'self-wall'), hit(5.01, 'self-wall')],
      }),
    ).toBe(false)
  })

  test('hosted children (doors / windows) outrank at ANY depth gap — grazing angles included', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        // A door panel hit far beyond epsilon along a grazing ray.
        otherHits: [hit(5 + 3 * EPS, 'selectable', true)],
      }),
    ).toBe(true)
  })

  test('selectables nearer than the wall outrank it (plain distance order)', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [hit(3, 'selectable')],
      }),
    ).toBe(true)
  })

  test('wall-mounted gear BEHIND an interposed hidden wall outranks it (D4: receptacle 2m back)', () => {
    expect(
      hiddenWallOutrankedOnRay({
        wallHitDistance: 5,
        otherHits: [
          // The receptacle, sitting at its own wall's face 2m behind this one…
          hit(7, 'selectable'),
          // …anchored by that wall's hit right behind it.
          hit(7 + EPS / 2, 'other-wall'),
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
          hit(7, 'selectable'),
          // The room's far wall, well beyond the sofa.
          hit(10, 'other-wall'),
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
        otherHits: [hit(5.1, 'other-wall')],
      }),
    ).toBe(false)
  })
})

describe('extractWallSelectionRay', () => {
  const chain = (parent: WallRayObjectLike | null, name?: string): WallRayObjectLike => ({
    name,
    parent,
  })

  // Classifier stand-in: ownership by an explicit map, 'passive' otherwise —
  // the real classifier (selection-hit-owner.ts) is tested separately.
  const classifierFor =
    (owners: Map<WallRayObjectLike, WallRayHitOwnership>) => (object: WallRayObjectLike) =>
      owners.get(object) ?? 'passive'

  test('reduces a live event: self excluded, ownership applied, subtree hits marked hosted', () => {
    const wallRoot = chain(null)
    const selfCollision = chain(wallRoot, 'collision-mesh')
    const selfRenderMesh = wallRoot // the outer render mesh IS the registered root
    const hostedDoorMesh = chain(chain(wallRoot)) // door mesh nested under the wall root
    const framingMesh = chain(chain(null))
    const otherWallCollision = chain(chain(null), 'collision-mesh')
    const sofaMesh = chain(chain(null))

    const ray = extractWallSelectionRay(
      {
        distance: 5,
        object: selfCollision,
        intersections: [
          { distance: 5, object: selfCollision },
          { distance: 5, object: selfRenderMesh },
          { distance: 5.01, object: framingMesh },
          { distance: 5.2, object: hostedDoorMesh },
          { distance: 7, object: sofaMesh },
          { distance: 7.1, object: otherWallCollision },
        ],
      },
      wallRoot,
      classifierFor(
        new Map<WallRayObjectLike, WallRayHitOwnership>([
          [selfRenderMesh, 'self-wall'],
          [hostedDoorMesh, 'selectable'],
          [framingMesh, 'passive'],
          [otherWallCollision, 'other-wall'],
          [sofaMesh, 'selectable'],
        ]),
      ),
    )

    expect(ray).toEqual({
      wallHitDistance: 5,
      otherHits: [
        { distance: 5, ownership: 'self-wall', hostedByThisWall: false },
        { distance: 5.01, ownership: 'passive', hostedByThisWall: false },
        { distance: 5.2, ownership: 'selectable', hostedByThisWall: true },
        { distance: 7, ownership: 'selectable', hostedByThisWall: false },
        { distance: 7.1, ownership: 'other-wall', hostedByThisWall: false },
      ],
    })
  })

  test('events without ray data reduce to undefined (→ #683 transparent fallback)', () => {
    const classify = classifierFor(new Map())
    expect(extractWallSelectionRay(undefined, null, classify)).toBeUndefined()
    expect(extractWallSelectionRay({}, null, classify)).toBeUndefined()
    expect(
      extractWallSelectionRay({ distance: 5, object: chain(null) }, null, classify),
    ).toBeUndefined()
    expect(
      extractWallSelectionRay({ object: chain(null), intersections: [] }, null, classify),
    ).toBeUndefined()
  })

  test('a null wall root marks nothing as hosted (wall not registered yet)', () => {
    const self = chain(null, 'collision-mesh')
    const selectable = chain(null)
    const ray = extractWallSelectionRay(
      {
        distance: 5,
        object: self,
        intersections: [
          { distance: 5, object: self },
          { distance: 5.1, object: selectable },
        ],
      },
      null,
      classifierFor(new Map([[selectable, 'selectable' as const]])),
    )
    expect(ray?.otherHits).toEqual([
      { distance: 5.1, ownership: 'selectable', hostedByThisWall: false },
    ])
  })
})
