import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Group } from 'three'
import { isWallMeshHidden, shouldIgnoreWallEventForOpeningMove } from './opening-move-wall-gate'

// Semantics pinned here (the door / window MOVE tools evaluate this predicate
// on every wall:enter / wall:move / wall:click before resolving a target):
// - #689 / night-6: while an opening tool is active, hidden walls stay ray
//   targets (the pointer hold) — but nearest-hit-wins let a hidden wall
//   INTERPOSED between the camera and the dragged opening's own wall capture
//   the drag, and the commit silently re-parented the opening onto a wall the
//   user cannot see (QA: window wall_pgmay5kic2q0umkz → wall_n2u7vn4nfimt2bom).
// - The MOVE tools therefore ignore hidden walls that are not the node's own
//   (grab wall or current mid-drag host). Ignored events do not stop
//   propagation, so the ray falls through to the own wall behind.
// - VISIBLE walls always pass: cross-wall re-parenting stays possible, but
//   only onto an explicit target the user can see.
// - PLACE (fresh openings, incl. `metadata.isNew` duplicates) skips the gate:
//   placing onto any wall — hidden ones included — is the X-ray experience.

describe('shouldIgnoreWallEventForOpeningMove', () => {
  const OWN_WALL = 'wall_own'
  const OTHER_WALL = 'wall_interposed'

  test('interposed HIDDEN wall: ignored (the wrong-wall capture fix)', () => {
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: OTHER_WALL,
        eventWallHidden: true,
        ownWallIds: [OWN_WALL, OWN_WALL],
      }),
    ).toBe(true)
  })

  test("the node's OWN hidden wall: never ignored (X-ray drags keep sliding, #689)", () => {
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: OWN_WALL,
        eventWallHidden: true,
        ownWallIds: [OWN_WALL, null],
      }),
    ).toBe(false)
  })

  test('current mid-drag host counts as an own wall even when hidden', () => {
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: OTHER_WALL,
        eventWallHidden: true,
        // Grabbed from OWN_WALL, legitimately re-parented to OTHER_WALL while
        // it was visible; it may keep the drag if the camera later hides it.
        ownWallIds: [OWN_WALL, OTHER_WALL],
      }),
    ).toBe(false)
  })

  test('VISIBLE walls always pass — explicit cross-wall re-parenting stays possible', () => {
    for (const ownWallIds of [
      [OWN_WALL, OWN_WALL],
      [OWN_WALL, null],
      [undefined, null],
    ]) {
      expect(
        shouldIgnoreWallEventForOpeningMove({
          eventWallId: OTHER_WALL,
          eventWallHidden: false,
          ownWallIds,
        }),
      ).toBe(false)
    }
  })

  test('free-follow host (a level id) and empty own ids never match a wall event', () => {
    // Mid-drag over open floor the opening parents to the LEVEL; the level id
    // must not accidentally whitelist a hidden wall.
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: OTHER_WALL,
        eventWallHidden: true,
        ownWallIds: [OWN_WALL, 'level_ground'],
      }),
    ).toBe(true)
    // Roof-hosted openings have no wallId at grab; every hidden wall is then
    // a non-own wall until an explicit visible re-parent.
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: OTHER_WALL,
        eventWallHidden: true,
        ownWallIds: [undefined, 'roofseg_a'],
      }),
    ).toBe(true)
  })
})

describe('isWallMeshHidden', () => {
  afterEach(() => {
    sceneRegistry.nodes.delete('wall_gate_test')
  })

  test('reads the WallCutout wallHidden stamp off the registered mesh', () => {
    const mesh = new Group()
    sceneRegistry.nodes.set('wall_gate_test', mesh)

    expect(isWallMeshHidden('wall_gate_test')).toBe(false)

    mesh.userData.wallHidden = true
    expect(isWallMeshHidden('wall_gate_test')).toBe(true)

    mesh.userData.wallHidden = false
    expect(isWallMeshHidden('wall_gate_test')).toBe(false)
  })

  test('unregistered walls count as visible (nothing behind to fall through to)', () => {
    expect(isWallMeshHidden('wall_never_registered')).toBe(false)
  })

  test('composes with the pure gate the way the move tools call it', () => {
    const mesh = new Group()
    mesh.userData.wallHidden = true
    sceneRegistry.nodes.set('wall_gate_test', mesh)

    const ignored = (eventWallId: string) =>
      shouldIgnoreWallEventForOpeningMove({
        eventWallId,
        eventWallHidden: isWallMeshHidden(eventWallId),
        ownWallIds: ['wall_own', null],
      })

    // Hidden + not own → ignored; the same wall as own → allowed.
    expect(ignored('wall_gate_test')).toBe(true)
    expect(
      shouldIgnoreWallEventForOpeningMove({
        eventWallId: 'wall_gate_test',
        eventWallHidden: isWallMeshHidden('wall_gate_test'),
        ownWallIds: ['wall_gate_test', null],
      }),
    ).toBe(false)
  })
})
