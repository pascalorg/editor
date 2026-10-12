import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SlabNode,
  WallFeatureNode,
  WallNode,
} from '@pascal-app/core'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import {
  planWallFeaturePlacement,
  resolveWallFeaturePlacement,
  validateWallFeatures,
  WALL_FEATURE_MIN_BACKING,
} from '@pascal-app/core/building'

function scene(patch: Partial<WallNode> = {}) {
  const level = LevelNode.parse({ id: 'level_features', level: 0, height: 3 })
  const wall = WallNode.parse({
    id: 'wall_features',
    parentId: level.id,
    start: [2, 4],
    end: [6, 4],
    thickness: 0.2,
    ...patch,
  })
  const nodes: Record<string, AnyNode> = { [level.id]: level, [wall.id]: wall }
  return { nodes, wall, level }
}

function feature(patch: Partial<WallFeatureNode> = {}) {
  return WallFeatureNode.parse({ parentId: 'wall_features', face: 'a', u: 2, ...patch })
}

function bumpWithNiche() {
  const bump = feature({ mode: 'bump', bottom: 0, width: 1.2, height: 2, depth: 0.3 })
  const niche = feature({ parentId: bump.id, face: undefined, u: 0.6, bottom: 1, depth: 0.35 })
  const { nodes, wall } = scene()
  nodes[bump.id] = bump
  nodes[niche.id] = niche
  return { nodes, wall, bump, niche }
}

function refusal(action: () => unknown, code: string) {
  try {
    action()
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    expect(error.code).toBe(code)
    expect(error.message.length).toBeGreaterThan(0)
    return error
  }
  throw new Error(`Expected refusal ${code}`)
}

describe('wall feature frames and host fit', () => {
  test('resolves both physical faces using wall justification and the directed reference', () => {
    for (const justification of [undefined, 'a', 'b'] as const) {
      const { nodes } = scene({ justification })
      const expectedA = justification === 'a' ? 0.2 : justification === 'b' ? 0 : 0.1
      const expectedB = justification === 'a' ? 0 : justification === 'b' ? -0.2 : -0.1
      for (const face of ['a', 'b'] as const) {
        const placed = planWallFeaturePlacement(nodes, feature({ face }))
        const offset = face === 'a' ? expectedA : expectedB
        expect(placed.position[0]).toBeCloseTo(4)
        expect(placed.position[1]).toBeCloseTo(1.175)
        expect(placed.position[2]).toBeCloseTo(4 + offset)
        expect(placed.mountOffset).toBeCloseTo(offset)
        expect(placed.surfaceOffset).toBeCloseTo(offset + (face === 'a' ? -0.1 : 0.1))
        expect(placed.normal[2]).toBe(face === 'a' ? 1 : -1)
        expect(placed.u).toBe(2)
        expect(placed.wallTop).toBe(3)
      }
    }
  })

  test('resolves a rotated wall in the level frame', () => {
    const { nodes } = scene({ start: [1, 2], end: [1, 6] })
    const placed = resolveWallFeaturePlacement(nodes, feature({ face: 'a' }))
    expect(placed.position[0]).toBeCloseTo(0.9)
    expect(placed.position[2]).toBeCloseTo(4)
    expect(placed.tangent).toEqual([0, 0, 1])
    expect(placed.normal).toEqual([-1, 0, 0])
  })

  test('accepts edge contact and rejects width or height beyond the host', () => {
    const { nodes } = scene()
    const exact = feature({ u: 2, width: 4, bottom: 0, height: 3 })
    expect(planWallFeaturePlacement(nodes, exact).hostWidth).toBe(4)
    for (const patch of [{ u: 0.2 }, { width: 4.01 }, { bottom: 2.8 }]) {
      refusal(() => planWallFeaturePlacement(nodes, feature(patch)), 'wall_feature_out_of_bounds')
    }
  })

  test('checks finite data at the shared planning interface', () => {
    const { nodes } = scene()
    for (const patch of [{ width: 0 }, { depth: -1 }, { u: Number.NaN }, { bottom: -0.1 }]) {
      refusal(
        () => planWallFeaturePlacement(nodes, { ...feature(), ...patch }),
        'wall_feature_invalid_data',
      )
    }
    const largeBump = feature({ mode: 'bump', depth: 5 })
    expect(planWallFeaturePlacement(nodes, largeBump).maxDepth).toBeNull()
  })

  test('refuses missing, unbound, curved, curtain, and degenerate hosts', () => {
    const { nodes } = scene()
    refusal(
      () => planWallFeaturePlacement(nodes, feature({ parentId: null })),
      'wall_feature_host_required',
    )
    refusal(
      () => planWallFeaturePlacement(nodes, feature({ parentId: 'wall_missing' })),
      'wall_feature_host_missing',
    )
    for (const patch of [{ curveOffset: 0.5 }, { wallType: 'curtain' as const }]) {
      refusal(
        () => planWallFeaturePlacement(scene(patch).nodes, feature()),
        'wall_feature_unsupported_wall',
      )
    }
    for (const patch of [{ thickness: 0 }, { end: [2, 4] as [number, number] }]) {
      refusal(
        () => planWallFeaturePlacement(scene(patch).nodes, feature()),
        'wall_feature_invalid_wall',
      )
    }
  })

  test('uses the raised mounting face and keeps the plane-bound top fixed', () => {
    const { nodes, level } = scene()
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.6,
      polygon: [
        [1, 3],
        [7, 3],
        [7, 5],
        [1, 5],
      ],
    })
    nodes[slab.id] = slab
    const placed = planWallFeaturePlacement(nodes, feature({ bottom: 0.2 }))
    expect(placed.wallBase).toBeCloseTo(0.6)
    expect(placed.bottom).toBeCloseTo(0.8)
    expect(placed.wallTop).toBe(3)
    expect(placed.hostHeight).toBeCloseTo(2.4)
    refusal(
      () => planWallFeaturePlacement(nodes, feature({ bottom: 2.2 })),
      'wall_feature_out_of_bounds',
    )
  })

  test('uses an explicit wall height above its elected support', () => {
    const { nodes } = scene({ height: 1.8, supportSlabId: 'ground', supportOffset: 0.4 })
    const placed = planWallFeaturePlacement(nodes, feature({ bottom: 0 }))
    expect(placed.wallBase).toBeCloseTo(0.4)
    expect(placed.wallTop).toBeCloseTo(2.2)
    expect(placed.bottom).toBeCloseTo(0.4)
    expect(placed.hostHeight).toBeCloseTo(1.8)
  })

  test("uses each face's own floor datum and compares opposing niches in the same elevation frame", () => {
    const { nodes, level } = scene()
    const high = SlabNode.parse({
      parentId: level.id,
      elevation: 0.6,
      polygon: [
        [1, 4],
        [7, 4],
        [7, 6],
        [1, 6],
      ],
    })
    const low = SlabNode.parse({
      parentId: level.id,
      elevation: 0.1,
      polygon: [
        [1, 2],
        [7, 2],
        [7, 4],
        [1, 4],
      ],
    })
    nodes[high.id] = high
    nodes[low.id] = low
    const a = feature({ face: 'a', bottom: 0, depth: 0.18 })
    const b = feature({ face: 'b', bottom: 0, depth: 0.18 })
    const placedA = planWallFeaturePlacement(nodes, a)
    const placedB = planWallFeaturePlacement(nodes, b)
    expect(placedA.bottom).toBeCloseTo(0.6)
    expect(placedB.bottom).toBeCloseTo(0.1)
    expect(placedA.hostHeight).toBeCloseTo(2.4)
    expect(placedB.hostHeight).toBeCloseTo(2.9)
    nodes[a.id] = a
    expect(planWallFeaturePlacement(nodes, b).bottom).toBeCloseTo(0.1)
    refusal(() => planWallFeaturePlacement(nodes, { ...b, bottom: 0.5 }), 'wall_feature_backing')
  })

  test('honors the covering slab underside when resolving wall tops', () => {
    const { nodes, level } = scene()
    const building = BuildingNode.parse({ children: [level.id] })
    nodes[building.id] = building
    nodes[level.id] = { ...level, parentId: building.id }
    const above = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
    const slab = SlabNode.parse({
      parentId: above.id,
      elevation: 0,
      thickness: 0.2,
      polygon: [
        [1, 3],
        [7, 3],
        [7, 5],
        [1, 5],
      ],
    })
    nodes[above.id] = { ...above, children: [slab.id] }
    nodes[slab.id] = slab
    expect(planWallFeaturePlacement(nodes, feature()).wallTop).toBeCloseTo(2.8)
    refusal(
      () => planWallFeaturePlacement(nodes, feature({ bottom: 2.5 })),
      'wall_feature_out_of_bounds',
    )
  })

  test('rejects a feature extending below a higher floor along part of its width', () => {
    const { nodes, level } = scene()
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.6,
      polygon: [
        [4.5, 3],
        [7, 3],
        [7, 5],
        [4.5, 5],
      ],
    })
    nodes[slab.id] = slab
    const spanning = feature({ u: 2, width: 2, bottom: 0 })
    refusal(() => planWallFeaturePlacement(nodes, spanning), 'wall_feature_out_of_bounds')
    expect(planWallFeaturePlacement(nodes, { ...spanning, bottom: 0.6 }).bottom).toBeCloseTo(0.6)
  })
})

describe('nested feature placement and parent edits', () => {
  test('resolves a niche relative to its bump and gains the bump depth', () => {
    const { nodes, niche, bump } = bumpWithNiche()
    const before = JSON.stringify(nodes)
    const placed = planWallFeaturePlacement(nodes, niche)
    expect(placed.u).toBeCloseTo(2)
    expect(placed.bottom).toBeCloseTo(1)
    expect(placed.mountOffset).toBeCloseTo(0.4)
    expect(placed.surfaceOffset).toBeCloseTo(0.05)
    expect(placed.maxDepth).toBeCloseTo(0.48)
    expect(placed.node.face).toBeUndefined()
    expect(validateWallFeatures(nodes, placed.wall.id).map((p) => p.node.id)).toEqual([
      bump.id,
      niche.id,
    ])
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('checks the child against its parent rectangle', () => {
    const { nodes, niche } = bumpWithNiche()
    for (const patch of [{ u: 0.2 }, { bottom: 1.8 }]) {
      refusal(
        () => planWallFeaturePlacement(nodes, { ...niche, ...patch }),
        'wall_feature_out_of_bounds',
      )
    }
  })

  test('refuses parent resizes, depth edits, or conversions that invalidate its niche', () => {
    const { nodes, bump } = bumpWithNiche()
    const before = JSON.stringify(nodes)
    for (const patch of [{ width: 0.8 }, { height: 1.1 }]) {
      refusal(
        () => planWallFeaturePlacement(nodes, { ...bump, ...patch }),
        'wall_feature_out_of_bounds',
      )
    }
    refusal(() => planWallFeaturePlacement(nodes, { ...bump, depth: 0.1 }), 'wall_feature_backing')
    refusal(
      () => planWallFeaturePlacement(nodes, { ...bump, mode: 'niche', depth: 0.1 }),
      'wall_feature_invalid_nesting',
    )
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('carries nested coordinates when a parent moves or changes face', () => {
    const { nodes, bump, niche, wall } = bumpWithNiche()
    const moved = { ...nodes, [bump.id]: { ...bump, u: 2.5, bottom: 0.5, face: 'b' as const } }
    const placed = validateWallFeatures(moved, wall.id).find((p) => p.node.id === niche.id)!
    expect(placed.u).toBeCloseTo(2.5)
    expect(placed.bottom).toBeCloseTo(1.5)
    expect(placed.face).toBe('b')
    expect(placed.mountOffset).toBeCloseTo(-0.4)
    expect(placed.surfaceOffset).toBeCloseTo(-0.05)
  })

  test('refuses unsupported nested bumps and ownership cycles', () => {
    const { nodes, bump, niche } = bumpWithNiche()
    refusal(
      () => planWallFeaturePlacement(nodes, { ...niche, mode: 'bump' }),
      'wall_feature_invalid_nesting',
    )
    const cyclicBump = { ...bump, parentId: niche.id, face: undefined }
    const cyclic = { ...nodes, [bump.id]: cyclicBump }
    refusal(() => planWallFeaturePlacement(cyclic, niche), 'wall_feature_host_cycle')
  })

  test('validates existing features against proposed wall changes', () => {
    const { nodes, wall } = scene()
    const niche = feature()
    nodes[niche.id] = niche
    for (const patch of [
      { thickness: 0.1 },
      { height: 1.1 },
      { end: [3, 4] as [number, number] },
    ]) {
      const proposed = { ...nodes, [wall.id]: { ...wall, ...patch } }
      refusal(
        () => validateWallFeatures(proposed, wall.id),
        patch.thickness ? 'wall_feature_backing' : 'wall_feature_out_of_bounds',
      )
    }
  })
})

describe('feature overlaps and backing thickness', () => {
  test('retains the required backing and accepts the exact depth limit', () => {
    const { nodes } = scene()
    const placed = planWallFeaturePlacement(nodes, feature({ depth: 0.18 }))
    expect(placed.maxDepth).toBeCloseTo(0.2 - WALL_FEATURE_MIN_BACKING)
    refusal(
      () => planWallFeaturePlacement(nodes, feature({ depth: 0.181 })),
      'wall_feature_backing',
    )
  })

  test('rejects unrelated same-face overlap and permits touching edges', () => {
    const { nodes } = scene()
    const first = feature({ mode: 'bump', width: 1 })
    nodes[first.id] = first
    refusal(() => planWallFeaturePlacement(nodes, feature()), 'wall_feature_overlap')
    expect(planWallFeaturePlacement(nodes, feature({ u: 3, width: 1 })).u).toBe(3)
  })

  test('rejects overlapping sibling niches within the same bump', () => {
    const { nodes, niche, bump } = bumpWithNiche()
    const sibling = feature({ parentId: bump.id, face: undefined, u: niche.u, depth: 0.1 })
    refusal(() => planWallFeaturePlacement(nodes, sibling), 'wall_feature_overlap')
  })

  test('accounts for both recess depths where opposite faces overlap', () => {
    const { nodes } = scene()
    const first = feature({ depth: 0.1 })
    nodes[first.id] = first
    const opposite = feature({ face: 'b', depth: 0.08 })
    expect(planWallFeaturePlacement(nodes, opposite).surfaceOffset).toBeCloseTo(-0.02)
    const error = refusal(
      () => planWallFeaturePlacement(nodes, { ...opposite, depth: 0.09 }),
      'wall_feature_backing',
    )
    expect(error.details.remainingBacking).toBeCloseTo(0.01)
    expect(planWallFeaturePlacement(nodes, { ...opposite, u: 3, depth: 0.18 }).u).toBe(3)
  })

  test('opposite recess budgets include nested niches and ignore added bump solids', () => {
    const { nodes, niche } = bumpWithNiche()
    const opposite = feature({ face: 'b', depth: 0.1 })
    expect(planWallFeaturePlacement(nodes, opposite).maxDepth).toBeCloseTo(0.18)
    refusal(
      () => planWallFeaturePlacement(nodes, { ...opposite, depth: 0.14 }),
      'wall_feature_backing',
    )
    nodes[niche.id] = { ...niche, depth: 0.1 }
    expect(planWallFeaturePlacement(nodes, { ...opposite, depth: 0.18 }).node.depth).toBe(0.18)
  })

  test('keeps placement independent of unrelated walls and graph insertion order', () => {
    const { nodes, wall } = scene()
    const first = feature()
    const second = feature({ u: 3 })
    const unrelated = WallNode.parse({ ...wall, id: 'wall_other', start: [2, 8], end: [6, 8] })
    const elsewhere = feature({ parentId: unrelated.id })
    nodes[first.id] = first
    nodes[second.id] = second
    nodes[unrelated.id] = unrelated
    nodes[elsewhere.id] = elsewhere
    const reversed = Object.fromEntries(Object.entries(nodes).reverse())
    expect(planWallFeaturePlacement(nodes, first).bounds).toEqual(
      planWallFeaturePlacement(reversed, first).bounds,
    )
    expect(validateWallFeatures(nodes, wall.id)).toHaveLength(2)
  })
})
