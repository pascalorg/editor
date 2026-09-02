import { describe, expect, test } from 'bun:test'
import { deviceParentFrame } from '../device/frame'
import { resolveServiceParent, serviceParentFrame } from './frame'
import { normalizeServiceAnchors } from './normalize'
import { resolveServicePlacement } from './placement'

/**
 * Gates for the door-style drag frame (movable.parentFrame on bones:service):
 *  - planToLocal / localToPlan round-trip on a wall (projection idempotent,
 *    t clamped 0..1);
 *  - resolveParent precedence (wallId anchor, moved-position nearest wall,
 *    floor types + unusable walls → null);
 *  - commit shape: NO onCommit on either drag frame (the host onCommit
 *    branch's wall patch woke the space-detection sync mid-commit — night-5
 *    D2/D3); the reconcile batch normalizes the committed position into
 *    wallId + wallT + position [0,0,0] instead, which keeps the old "wallT
 *    inert after a gizmo drag" quirk retired;
 *  - the renderer's live-override merge resolves both a position override
 *    (the drag preview) and a wallT override to the right wall spot.
 */

const LEVEL = 'level-1'

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  extra: Record<string, unknown> = {},
) => ({
  id,
  type: 'wall',
  parentId: LEVEL,
  start,
  end,
  thickness: 0.12,
  ...extra,
})

const panel = (extra: Record<string, unknown> = {}) => ({
  id: 'bonesservice-panel',
  type: 'bones:service',
  parentId: LEVEL,
  serviceType: 'panel',
  wallId: 'wall-a',
  wallT: 0.5,
  heightAff: 1.5,
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  ...extra,
})

// Wall A along +X from (2,1) to (8,1); wall B along +Z from (0,0) to (0,6).
const nodes = () => ({
  'wall-a': wall('wall-a', [2, 1], [8, 1]),
  'wall-b': wall('wall-b', [0, 0], [0, 6]),
})

describe('serviceParentFrame plan/local projection', () => {
  const parent = wall('wall-a', [2, 1], [8, 1])

  test('planToLocal projects the plan cursor onto the wall axis', () => {
    // Cursor at (5, 3) — 2m off the wall; projects to (5, 1), t = 0.5.
    const local = serviceParentFrame.planToLocal(parent, 5, 1.5, 3)
    expect(local[0]).toBeCloseTo(5)
    expect(local[1]).toBeCloseTo(1.5) // localY passes through
    expect(local[2]).toBeCloseTo(1)
  })

  test('planToLocal clamps beyond the wall ends (t 0..1)', () => {
    const past = serviceParentFrame.planToLocal(parent, 20, 0, 1)
    expect(past[0]).toBeCloseTo(8) // clamped to end
    expect(past[2]).toBeCloseTo(1)
    const before = serviceParentFrame.planToLocal(parent, -4, 0, 5)
    expect(before[0]).toBeCloseTo(2) // clamped to start
    expect(before[2]).toBeCloseTo(1)
  })

  test('localToPlan/planToLocal round-trip on the wall axis', () => {
    const local = serviceParentFrame.planToLocal(parent, 6.2, 0.4, 2.9)
    const plan = serviceParentFrame.localToPlan(parent, local)
    expect(plan[0]).toBeCloseTo(local[0])
    expect(plan[1]).toBeCloseTo(local[1])
    expect(plan[2]).toBeCloseTo(local[2])
    // And back again — projection is idempotent.
    const local2 = serviceParentFrame.planToLocal(parent, plan[0], plan[1], plan[2])
    expect(local2[0]).toBeCloseTo(local[0])
    expect(local2[2]).toBeCloseTo(local[2])
  })

  test('parentRotationY matches the placement rotation convention', () => {
    // Wall along +X → rotationY 0 (same as resolveServicePlacement's lerp).
    expect(serviceParentFrame.parentRotationY(parent)).toBeCloseTo(0)
    const wallZ = wall('wall-b', [0, 0], [0, 6])
    const placement = resolveServicePlacement(
      { 'wall-b': wallZ },
      panel({ wallId: 'wall-b' }) as never,
    )
    expect(serviceParentFrame.parentRotationY(wallZ)).toBeCloseTo(placement?.rotationY ?? NaN)
  })
})

describe('resolveServiceParent', () => {
  test('wall-anchored panel (default position) resolves its wallId wall', () => {
    const all = nodes()
    expect(resolveServiceParent(panel(), all)).toBe(all['wall-a'])
  })

  test('moved position resolves the NEAREST usable wall (renderer parity)', () => {
    const all = nodes()
    // Near wall B, far from the stored wall-a anchor.
    const moved = panel({ position: [0.3, 0, 4] })
    expect(resolveServiceParent(moved, all)).toBe(all['wall-b'])
  })

  test('floor types get no parent (plain plan move preserved)', () => {
    const all = nodes()
    expect(resolveServiceParent(panel({ serviceType: 'sewer-exit' }), all)).toBeNull()
    expect(resolveServiceParent(panel({ serviceType: 'heat-pump' }), all)).toBeNull()
  })

  test('missing / curved wall anchors get no parent', () => {
    const all = {
      'wall-c': wall('wall-c', [2, 1], [8, 1], { curveOffset: 0.8 }),
    }
    expect(resolveServiceParent(panel({ wallId: 'wall-c' }), all)).toBeNull()
    expect(resolveServiceParent(panel({ wallId: 'wall-gone' }), all)).toBeNull()
  })
})

describe('drag commit — NO onCommit; the reconcile batch normalizes instead', () => {
  test('PIN: neither drag frame declares onCommit (host cascade guard)', () => {
    // Night-5 D2/D3 root cause: the host MoveRegistryNodeTool runs the
    // `parentFrame.onCommit` branch with history RESUMED and follows it with
    // an `updateNode(parentWall, resolveSupportSlabPatch)` no-op patch. That
    // patch flags the WALL as a commit candidate, waking the host's
    // space-detection sync mid-commit — which rewrites unclassified walls'
    // frontSide/backSide + zone defaults, PARTLY TRACKED. Measured on the
    // night-4 QA scene: one outlet drag = THREE undo entries, counts drifting
    // 1255·77 → 1218·79, single Cmd+Z landing a third state (1207·74) with
    // wiring + panel gone. No onCommit ⇒ the whole branch is skipped ⇒ one
    // drag = ONE tracked write; the anchor conversion happens in the
    // history-paused reconcile batch (device/place.ts, service/normalize.ts).
    expect(serviceParentFrame.onCommit).toBeUndefined()
    expect(deviceParentFrame.onCommit).toBeUndefined()
  })

  test('normalizeServiceAnchors converts the committed position to the wall anchor', () => {
    const all = nodes()
    // The tool committed the on-axis point (6.5, 1) into position.
    const committed = panel({ position: [6.5, 0, 1] })
    const updates = normalizeServiceAnchors(
      { ...all, [String(committed.id)]: committed },
      LEVEL,
    )
    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe('bonesservice-panel')
    expect(updates[0]?.data.wallId).toBe('wall-a')
    expect(updates[0]?.data.wallT).toBeCloseTo(0.75) // (6.5-2)/6
    expect(updates[0]?.data.position).toEqual([0, 0, 0])
  })

  test('sliding onto a different wall adopts it as the new anchor', () => {
    const all = nodes()
    const moved = panel({ position: [0.2, 0, 4.2] })
    expect(resolveServiceParent(moved, all)).toBe(all['wall-b'])
    const updates = normalizeServiceAnchors({ ...all, [String(moved.id)]: moved }, LEVEL)
    expect(updates[0]?.data.wallId).toBe('wall-b')
    expect(updates[0]?.data.wallT).toBeCloseTo(0.7) // 4.2 / 6 along wall B
    expect(updates[0]?.data.position).toEqual([0, 0, 0])
  })

  test('floor types and unmoved / wall-less nodes never normalize', () => {
    const all = nodes()
    // Floor-placed: position IS the anchor.
    const sewer = panel({ id: 'svc-sewer', serviceType: 'sewer-exit', position: [1, 0, 2] })
    // Wall-mounted but never moved: default position.
    const idle = panel({ id: 'svc-idle' })
    // Wall-mounted, moved, but no usable wall on the level.
    const island = panel({ id: 'svc-island', position: [3, 0, 3] })
    expect(
      normalizeServiceAnchors({ ...all, 'svc-sewer': sewer, 'svc-idle': idle }, LEVEL),
    ).toEqual([])
    expect(normalizeServiceAnchors({ 'svc-island': island }, LEVEL)).toEqual([])
  })

  test('normalization converges: the normalized node plans nothing', () => {
    const all = nodes()
    const after = panel({ wallT: 0.75, position: [0, 0, 0] })
    expect(normalizeServiceAnchors({ ...all, [String(after.id)]: after }, LEVEL)).toEqual([])
  })
})

describe('renderer live-override resolution (useLiveNodeOverrides merge)', () => {
  // The renderer merges the whole override object into the node
  // (`{ ...rawNode, ...liveOverride }`) and re-resolves placement — these
  // gates run that exact merge headlessly.

  test('a position override (the drag preview) slides the box along the wall', () => {
    const all = nodes()
    const base = panel()
    // Mid-drag override: the parentFrame local position rides the wall axis.
    const override = { position: [6.5, 0, 1] as [number, number, number], rotation: 0 }
    const merged = { ...base, ...override }
    const placement = resolveServicePlacement(all, merged as never)
    expect(placement?.wallMounted).toBe(true)
    expect(placement?.position[0]).toBeCloseTo(6.5)
    expect(placement?.position[1]).toBeCloseTo(1.5) // heightAff preserved
    expect(placement?.position[2]).toBeCloseTo(1) // on the wall axis
    expect(placement?.rotationY).toBeCloseTo(0) // wall A's angle
  })

  test('a wallT override previews the new anchor spot', () => {
    const all = nodes()
    const merged = { ...panel(), ...{ wallT: 0.8 } }
    const placement = resolveServicePlacement(all, merged as never)
    expect(placement?.wallMounted).toBe(true)
    expect(placement?.position[0]).toBeCloseTo(2 + 0.8 * 6) // lerp at t=0.8
    expect(placement?.position[2]).toBeCloseTo(1)
  })

  test('post-commit state (wallT set, position zeroed) resolves to the drop spot', () => {
    const all = nodes()
    const after = panel({ wallT: 0.75, position: [0, 0, 0] })
    const placement = resolveServicePlacement(all, after as never)
    expect(placement?.wallMounted).toBe(true)
    expect(placement?.position[0]).toBeCloseTo(6.5)
    expect(placement?.position[2]).toBeCloseTo(1)
  })
})
