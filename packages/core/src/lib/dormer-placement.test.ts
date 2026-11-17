import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DormerNode,
  getDormerWindowExposure,
  LevelNode,
  planDormerCreation,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
  validateDormerPlacement,
  WindowNode,
} from '../index'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  type SceneSnapshot,
} from '../runtime'
import { withIdAllocator } from '../schema/base'

// Native saved defaults and analytic geometry are the oracles, not planner output.
// These public-seam checks tolerate different triangulations and validation algorithms.
function fixture(overrides: Partial<RoofSegmentNode> = {}) {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    roofType: 'shed',
    width: 8,
    depth: 6,
    pitch: 30,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.1,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: [],
    ...overrides,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment].map((node) => [node.id, node]),
  )
  return { nodes, building, level, roof, segment }
}

function candidate(segment: RoofSegmentNode, overrides: Partial<DormerNode> = {}) {
  return DormerNode.parse({
    id: 'dormer_candidate',
    parentId: segment.id,
    roofSegmentId: segment.id,
    width: 1,
    depth: 1,
    position: [0, 9, 0],
    rotation: 0,
    children: [],
    ...overrides,
  })
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function check(f: ReturnType<typeof fixture>, dormer: DormerNode) {
  const before = structuredClone({ nodes: f.nodes, dormer })
  const input = freeze(structuredClone(before))
  const allocated: string[] = []
  const result = withIdAllocator(
    (prefix) => {
      allocated.push(prefix)
      return `${prefix}_unexpected`
    },
    () =>
      validateDormerPlacement(
        input.nodes,
        input.nodes[f.segment.id] as RoofSegmentNode,
        input.dormer,
      ),
  )
  expect(allocated).toEqual([])
  expect(input).toEqual(before)
  expect({ nodes: f.nodes, dormer }).toEqual(before)
  return result
}

function addDormer(f: ReturnType<typeof fixture>, node: DormerNode) {
  f.nodes[node.id] = node
  const host = f.nodes[f.segment.id] as RoofSegmentNode
  f.nodes[host.id] = { ...host, children: [...host.children, node.id] }
}

function expectFootprint(actual: [number, number][], expected: [number, number][]) {
  expect(actual).toHaveLength(4)
  for (const [x, z] of expected) {
    expect(actual.some(([a, b]) => Math.abs(a - x) < 1e-8 && Math.abs(b - z) < 1e-8)).toBe(true)
  }
  // Matching corners is insufficient if the perimeter is self-crossing.
  const turns = actual.map((a, i) => {
    const b = actual[(i + 1) % 4]!
    const c = actual[(i + 2) % 4]!
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
  })
  expect(turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0)).toBe(true)
}

describe('shared dormer whole-footprint validation', () => {
  test('returns oriented native corners without reseating, rotating, writing or allocating', () => {
    const f = fixture()
    const dormer = candidate(f.segment, {
      width: 2,
      depth: 1,
      rotation: Math.PI / 2,
      position: [1, 9, 0],
    })
    const result = check(f, dormer)
    if (!result.ok) throw new Error(result.message)
    expect(result.value).toMatchObject({ roofId: f.roof.id, segmentId: f.segment.id })
    expectFootprint(result.value.localFootprint, [
      [0.5, -1],
      [1.5, -1],
      [1.5, 1],
      [0.5, 1],
    ])
    expect(dormer.position[1]).toBe(9)
    expect(dormer.rotation).toBe(Math.PI / 2)
  })

  for (const [gradient, accepted] of [
    [0, false],
    [0.079, false],
    [0.08, true],
    [0.081, true],
  ] as const) {
    test(`centre gradient ${gradient} is ${accepted ? 'accepted' : 'refused'}`, () => {
      const f = fixture({ pitch: (Math.atan(gradient) * 180) / Math.PI })
      const result = check(f, candidate(f.segment))
      expect(result.ok).toBe(accepted)
      if (result.ok) expect(result.value.gradient).toBeCloseTo(gradient, 9)
    })
  }

  test('a small unsupported corner is not excused by an area allowance', () => {
    const full = fixture()
    const edge = candidate(full.segment, { position: [3.5, 9, 2.5] })
    expect(check(full, edge).ok).toBe(true)
    const trimmed = fixture({
      trim: { ...full.segment.trim, frontRightX: 0.03, frontRightZ: 0.03 },
    })
    // The missing .03-by-.03 triangle is only .00045 m²; the centre still hits.
    expect(check(trimmed, edge)).toMatchObject({ ok: false, code: 'too_wide' })
  })

  test('an interior gap cannot be bridged even when centre and corners are supported', () => {
    const f = fixture({
      shedFootprintPieces: [
        [
          [-4, -3],
          [0.1, -3],
          [0.1, 3],
          [-4, 3],
        ],
        [
          [0.2, -3],
          [4, -3],
          [4, 3],
          [0.2, 3],
        ],
      ],
    })
    expect(check(f, candidate(f.segment))).toMatchObject({ ok: false, code: 'too_wide' })
  })

  test('coplanar pieces are one slope, not a source-index barrier', () => {
    const f = fixture({
      shedFootprintPieces: [
        [
          [-4, -3],
          [0, -3],
          [0, 3],
          [-4, 3],
        ],
        [
          [0, -3],
          [4, -3],
          [4, 3],
          [0, 3],
        ],
      ],
    })
    expect(check(f, candidate(f.segment)).ok).toBe(true)
  })

  test('a finite accessory cut inside the footprint is not erased with the edited self', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    const dormer = candidate(f.segment, { width: 2, depth: 2, position: [0, 4, 2] })
    addDormer(f, dormer)
    expect(check(f, dormer).ok).toBe(true)
    const skylight = SkylightNode.parse({
      id: 'skylight_cut',
      parentId: f.segment.id,
      roofSegmentId: f.segment.id,
      position: [0.5, 4, 2],
      width: 0.2,
      height: 0.2,
    })
    f.nodes[skylight.id] = skylight
    const host = f.nodes[f.segment.id] as RoofSegmentNode
    f.nodes[host.id] = { ...host, children: [...host.children, skylight.id] }
    expect(check(f, dormer).ok).toBe(false)
  })

  test('a true gable ridge crossing refuses despite a supported, qualifying centre', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    const dormer = candidate(f.segment, { position: [0, 9, 0.2] })
    expect(check(f, dormer)).toMatchObject({ ok: false, reason: 'architectural-break' })
    expect(check(f, { ...dormer, position: [0, 9, 2] }).ok).toBe(true)
  })

  test('a real hip diagonal is a break, unlike coplanar construction triangles', () => {
    const f = fixture({ roofType: 'hip', width: 8, depth: 8, pitch: 45 })
    // h=6-max(|x|,|z|): the square straddles x=z, not the centre ridge.
    expect(check(f, candidate(f.segment, { position: [1, 9, 1.2] }))).toMatchObject({
      ok: false,
      reason: 'architectural-break',
    })
    expect(check(f, candidate(f.segment, { position: [0, 9, 2] })).ok).toBe(true)
  })

  for (const [roofType, breakZ] of [
    ['gambrel', 2],
    ['mansard', 2.8],
    ['dutch', 2],
  ] as const) {
    test(`${roofType} preserves an actual profile break`, () => {
      const f = fixture({
        roofType,
        width: 8,
        depth: 8,
        pitch: 45,
        gambrelLowerWidthRatio: 0.5,
        gambrelLowerHeightRatio: 0.6,
        mansardSteepWidthRatio: 0.15,
        mansardSteepHeightRatio: 0.7,
        dutchHipWidthRatio: 0.25,
        dutchHipHeightRatio: 0.6,
      })
      // Native run ratios locate the boundaries at 2, 4-.15*8, 4-.25*8.
      // The non-equal rise ratios make these genuine changes of slope.
      expect(check(f, candidate(f.segment, { position: [0, 9, breakZ + 0.1] }))).toMatchObject({
        ok: false,
        reason: 'architectural-break',
      })
      expect(check(f, candidate(f.segment, { position: [0, 9, 3.5], depth: 0.5 })).ok).toBe(true)
    })
  }

  for (const angle of [0, 0.37]) {
    test(`positive overlap refuses but exact contact stays valid at yaw ${angle}`, () => {
      for (const [distance, overlapping] of [
        [0.995, true],
        [1, false],
      ] as const) {
        const f = fixture()
        const other = candidate(f.segment, {
          id: 'dormer_other',
          rotation: angle,
          position: [distance * Math.cos(angle), 9, -distance * Math.sin(angle)],
        })
        addDormer(f, other)
        // Unit squares: penetration .005 gives .005 m² overlap, not harmless contact.
        const result = check(f, candidate(f.segment, { rotation: angle }))
        expect(result.ok).toBe(!overlapping)
        if (!result.ok) {
          expect(result.code).toBe('overlaps_dormer')
          expect(result.nodeIds).toContain(other.id)
        }
      }
    })
  }

  test('only the edited self is excluded; a duplicate still collides with its source', () => {
    const f = fixture()
    const existing = candidate(f.segment)
    addDormer(f, existing)
    expect(check(f, existing).ok).toBe(true)
    const refused = check(f, { ...existing, id: 'dormer_duplicate' })
    expect(refused).toMatchObject({ ok: false, code: 'overlaps_dormer' })
    if (!refused.ok) expect(refused.nodeIds).toContain(existing.id)
    expect(check(f, { ...existing, position: [1.25, 9, 0] }).ok).toBe(true)
  })

  for (const read of ['placement', 'exposure'] as const) {
    test(`existing dormer ${read} plan conflicts when host geometry changes after reading through its own cut`, () => {
      const f = fixture()
      const dormer = candidate(f.segment, { position: [3, 9, 0], children: ['window_existing'] })
      addDormer(f, dormer)
      const window = WindowNode.parse({
        id: 'window_existing',
        parentId: dormer.id,
        dormerId: dormer.id,
        dormerFace: 'front',
        position: [0, -0.2, 0],
      })
      f.nodes[window.id] = window
      const base: SceneSnapshot = {
        nodes: f.nodes,
        rootNodeIds: [f.building.id],
        collections: {},
        materials: {},
        installedPlugins: [],
      }
      const scene = openDetachedScene(base, {
        base: { kind: 'authority', seq: 1 },
        context: {
          activeLevelId: f.level.id,
          selection: [],
          units: 'metric',
          catalogVersion: 'test',
          registryVersions: captureRegistryVersions(),
        },
        ids: effectIds(`dormer-${read}`),
      })
      try {
        const nodes = scene.reader().nodes
        const host = nodes[f.segment.id] as RoofSegmentNode
        const proposedDormer = { ...dormer, width: 0.9 }
        const proposedWindow = { ...window, position: [0, -0.1, 0] as [number, number, number] }
        if (read === 'placement') {
          expect(validateDormerPlacement(nodes, host, proposedDormer).ok).toBe(true)
        } else {
          expect(getDormerWindowExposure(dormer, proposedWindow, host, { nodes }).status).toBe(
            'exposed',
          )
        }
        // Capture the read itself, before any edit/reconciliation can accidentally
        // supply a missing dependency. The write and diff use the real detached runtime.
        const dependencies = scene.dependencies()
        scene.run(() => {
          scene.store
            .getState()
            .updateNode(
              read === 'placement' ? dormer.id : window.id,
              read === 'placement' ? { width: 0.9 } : { position: proposedWindow.position },
            )
        })
        const patch = scene.patch()
        expect(applyPatchWithDependencies(base, patch, dependencies, base).ok).toBe(true)
        const current = structuredClone(base)
        const storedHost = current.nodes[f.segment.id] as RoofSegmentNode
        const changedHost = {
          ...storedHost,
          ...(read === 'placement' ? { width: 4 } : { deckThickness: 10 }),
        }
        // Do not accidentally remove the existing dormer's child link: that
        // independently tracked change would mask a missing geometry dependency.
        expect(changedHost.children).toEqual([dormer.id])
        expect(
          (Object.keys(changedHost) as (keyof RoofSegmentNode)[]).filter(
            (key) => JSON.stringify(changedHost[key]) !== JSON.stringify(storedHost[key]),
          ),
        ).toEqual([read === 'placement' ? 'width' : 'deckThickness'])
        current.nodes[f.segment.id] = changedHost
        // Geometric controls: width4 no longer contains x3±.45; a ten-metre
        // covering buries the previously clear centre. Neither is a harmless edit.
        if (read === 'placement') {
          expect(validateDormerPlacement(current.nodes, changedHost, proposedDormer).ok).toBe(false)
        } else {
          expect(
            getDormerWindowExposure(dormer, proposedWindow, changedHost, { nodes: current.nodes })
              .status,
          ).toBe('buried')
        }
        const beforeApply = structuredClone(current)
        const applied = applyPatchWithDependencies(current, patch, dependencies, base)
        expect(applied.ok).toBe(false)
        expect(!applied.ok && applied.changed).toContainEqual(
          expect.objectContaining({ id: f.segment.id, reason: 'dependency' }),
        )
        expect(current).toEqual(beforeApply)
      } finally {
        scene.dispose()
      }
    })
  }

  test('native own-conical body cannot escape support through a narrow nominal width', () => {
    const f = fixture()
    // Existing cone body has diameter DEPTH in both axes. Width .5 fits at x3,
    // but depth3 gives a body extremum x4.5 outside the host's x4 edge.
    const dormer = candidate(f.segment, {
      roofType: 'conical',
      width: 0.5,
      depth: 3,
      position: [3, 9, 0],
    })
    expect(check(f, dormer).ok).toBe(false)
    expect(check(f, { ...dormer, position: [0, 9, 0] }).ok).toBe(true)
  })

  test('invalid ownership and nonphysical dimensions fail closed without writes or IDs', () => {
    const f = fixture()
    expect(check(f, candidate(f.segment, { parentId: 'rseg_foreign' })).ok).toBe(false)
    expect(check(f, candidate(f.segment, { roofSegmentId: 'rseg_foreign' })).ok).toBe(false)
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(check(f, { ...candidate(f.segment), width }).ok).toBe(false)
    }
    const orphan = fixture()
    orphan.nodes[orphan.roof.id] = { ...orphan.roof, children: [] }
    expect(check(orphan, candidate(orphan.segment)).ok).toBe(false)
  })
})

describe('shared native dormer creation plan', () => {
  test('creates the complete native pair at bare shell datum without writing the scene', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45, deckThickness: 0.2 })
    const before = structuredClone(f.nodes)
    const result = planDormerCreation(freeze(f.nodes), f.segment, [0, 2])
    expect(f.nodes).toEqual(before)
    if (!result.ok) throw new Error(result.message)
    const { dormer, window, exposure } = result.value
    expect(dormer).toMatchObject({
      parentId: f.segment.id,
      roofSegmentId: f.segment.id,
      width: 1.21,
      depth: 1.55,
      height: 0,
      roofType: 'gable',
      roofHeight: 0.49,
      wallSkirtHeight: 2.73,
      name: 'Dormer 1',
      children: [window.id],
    })
    // Native 45° gable: y=2+4-|z|. Neither deck top nor deck underside is the seat.
    expect(dormer.position[0]).toBe(0)
    expect(dormer.position[1]).toBeCloseTo(4, 9)
    expect(dormer.position[2]).toBe(2)
    expect(dormer.rotation).toBeCloseTo(0, 9)
    expect(window).toMatchObject({
      parentId: dormer.id,
      dormerId: dormer.id,
      dormerFace: 'front',
      width: 0.76,
      height: 0.68,
      columnRatios: [1, 1, 1],
      rowRatios: [1, 1, 1],
    })
    window.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0.02, -0.375, 0][i]!, 9)
    })
    expect(exposure.status).toBe('exposed')
    expect(dormer.id).not.toBe(window.id)
  })

  test('downhill yaw reverses across the ridge and is local to transformed roof parents', () => {
    const f = fixture({
      roofType: 'gable',
      depth: 8,
      pitch: 45,
      position: [3, 5, 7],
      rotation: Math.PI / 2,
    })
    f.nodes[f.roof.id] = { ...f.roof, position: [10, 11, 20], rotation: Math.PI / 2 }
    const result = planDormerCreation(f.nodes, f.segment, [0, -2])
    if (!result.ok) throw new Error(result.message)
    expect(result.value.dormer.position[1]).toBeCloseTo(4, 9)
    expect(Math.cos(result.value.dormer.rotation)).toBeCloseTo(-1, 9)
    expect(Math.sin(result.value.dormer.rotation)).toBeCloseTo(0, 9)
    expect(result.value.exposure.status).toBe('exposed')
  })

  test('keeps smallest unused native name, explicit manual yaw and own-roof options', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    for (const [n, x] of [
      [1, -3],
      [3, 3],
    ] as const) {
      addDormer(
        f,
        candidate(f.segment, { id: `dormer_${n}`, name: `Dormer ${n}`, position: [x, 4, 2] }),
      )
    }
    const result = planDormerCreation(f.nodes, f.segment, [0, 2], {
      rotation: 0.25,
      width: 1.4,
      depth: 2,
      roofType: 'shed',
      roofHeight: 0.6,
      materialPreset: 'preset-white',
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.value.dormer).toMatchObject({
      name: 'Dormer 2',
      rotation: 0.25,
      width: 1.4,
      depth: 2,
      roofType: 'shed',
      roofHeight: 0.6,
      materialPreset: 'preset-white',
    })
  })

  // A continuous architectural slope need not have one normal. These bounded positives
  // reject plane-only or blanket crown/apex bans; they do not certify rendered CSG/window cuts.
  for (const barrelSegments of [7, 12]) {
    test(`a ${barrelSegments}-bay barrel supports a qualifying centre with crown-crossing footprint`, () => {
      const f = fixture({ roofType: 'barrel', depth: 8, barrelRise: 2, barrelSegments })
      // z1 is pitched; depth3 spans [-.5,2.5], across the continuous crown.
      const result = planDormerCreation(f.nodes, f.segment, [0, 1], { depth: 3, height: 1 })
      if (!result.ok) throw new Error(result.message)
      expect(result.value.placement.gradient).toBeGreaterThanOrEqual(0.08)
      expect(result.value.dormer.depth).toBe(3)
      expect(result.value.dormer.position[2]).toBe(1)
      expect(result.value.exposure.status).toBe('exposed')
    })
  }

  test('a cone apex inside the footprint is not a blanket exclusion', () => {
    const f = fixture({ roofType: 'conical', width: 8, depth: 8, pitch: 45 })
    // Ry(pi/2) puts depth3 along x[-.5,2.5], inside radius4 but across the apex.
    const result = planDormerCreation(f.nodes, f.segment, [1, 0], {
      width: 1,
      depth: 3,
      height: 2,
      roofType: 'flat',
      rotation: Math.PI / 2,
    })
    if (!result.ok) throw new Error(result.message)
    expectFootprint(result.value.placement.localFootprint, [
      [-0.5, -0.5],
      [2.5, -0.5],
      [2.5, 0.5],
      [-0.5, 0.5],
    ])
    expect(result.value.exposure.status).toBe('exposed')
  })

  test('a curved shed supports a footprint across native bend facets with manual yaw', () => {
    const f = fixture({ arc: { centerX: 0, centerZ: -10, radius: 10 } })
    const result = planDormerCreation(f.nodes, f.segment, [0, 0], {
      width: 1.4,
      depth: 3,
      height: 2,
      rotation: 0,
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.value.dormer.rotation).toBe(0)
    expect(result.value.placement.gradient).toBeGreaterThanOrEqual(0.08)
    expect(result.value.exposure.status).toBe('exposed')
  })

  test('a new default window must fit and be exposed, unlike validation of an existing edit', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    expect(
      planDormerCreation(f.nodes, f.segment, [0, 2], { width: 0.6, windowWidth: 0.8 }),
    ).toMatchObject({ ok: false, code: 'window_too_wide' })
    // Depth .5 cannot uncover the unchanged native window centre at seatY-.375.
    expect(planDormerCreation(f.nodes, f.segment, [0, 2], { depth: 0.5 })).toMatchObject({
      ok: false,
      code: 'window_not_exposed',
    })
    expect(check(f, candidate(f.segment, { depth: 0.5, position: [0, 4, 2] })).ok).toBe(true)
  })

  test('creation contains the whole opening between native skirt and wall top, allowing exact contact', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    const before = structuredClone(f.nodes)
    // Native gable wall bounds are [-skirt, height]=[-.2,0], NOT the
    // gable's .49m roof peak. Centre=-skirt/2+offset, half-height=.1.
    // At offset0 both edges touch; ±.01 moves one edge outside the wall.
    for (const windowOffsetY of [0, -0.01, 0.01]) {
      const allocated: string[] = []
      const result = withIdAllocator(
        (prefix) => {
          allocated.push(prefix)
          return `${prefix}_bounded`
        },
        () =>
          planDormerCreation(freeze(f.nodes), f.segment, [0, 2], {
            wallSkirtHeight: 0.2,
            windowHeight: 0.2,
            windowOffsetY,
          }),
      )
      expect(f.nodes).toEqual(before)
      if (windowOffsetY === 0) {
        if (!result.ok) throw new Error(result.message)
        expect(result.value.window.position[1]).toBeCloseTo(-0.1, 9)
        expect(result.value.window.height).toBe(0.2)
        expect(result.value.exposure.status).toBe('exposed')
      } else {
        expect(result).toMatchObject({
          ok: false,
          code: 'window_does_not_fit',
          reason: 'window-fit',
        })
        expect(allocated).toEqual([])
      }
    }
  })

  for (const shedHighSide of ['front', 'back'] as const) {
    test(`creation selects the fitting ${shedHighSide} shed wall even when both window centres are exposed`, () => {
      const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
      // Own shed wall tops are 0 and2; opening [1.25,1.75] fits only the
      // high side. Both centres at host-localY5.5 clear the host: its higher
      // back covering is 6-1.225+.15sqrt(2), less than5.5.
      const result = planDormerCreation(freeze(f.nodes), f.segment, [0, 2], {
        roofType: 'shed',
        shedHighSide,
        roofHeight: 2,
        windowHeight: 0.5,
        windowOffsetY: 2.865,
      })
      if (!result.ok) throw new Error(result.message)
      expect(result.value.window.dormerFace).toBe(shedHighSide)
      expect(result.value.window.position[1]).toBeCloseTo(1.5, 9)
      expect(result.value.exposure.status).toBe('exposed')
    })
  }

  test('an exposed but non-fitting front cannot substitute for a fitting but buried back', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    // Opening [0,.5] exceeds the front wall's top0 but fits back top2.
    // Centre4.25 clears front covering3.225+.15sqrt(2), not back4.775+.15sqrt(2).
    expect(
      planDormerCreation(freeze(f.nodes), f.segment, [0, 2], {
        roofType: 'shed',
        shedHighSide: 'back',
        roofHeight: 2,
        windowHeight: 0.5,
        windowOffsetY: 1.615,
      }),
    ).toMatchObject({ ok: false, code: 'window_not_exposed' })
  })

  test('creation-only vertical fit does not prohibit editing an existing tall child', () => {
    const f = fixture({ roofType: 'gable', depth: 8, pitch: 45 })
    const existing = candidate(f.segment, {
      position: [0, 4, 2],
      windowHeight: 10,
      children: ['window_tall'],
    })
    addDormer(f, existing)
    f.nodes.window_tall = WindowNode.parse({
      id: 'window_tall',
      parentId: existing.id,
      dormerId: existing.id,
      dormerFace: 'front',
      height: 10,
      position: [0, -0.375, 0],
    })
    expect(check(f, { ...existing, width: 1.1 }).ok).toBe(true)
  })
})
