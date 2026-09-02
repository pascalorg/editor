import { describe, expect, test } from 'bun:test'
import { Mesh } from 'three'
import type { Fixture, Member, MemberMaterial, MemberRole } from '../core/types'
import {
  BELOW_GHOST_OPACITY,
  buildGroup,
  FAINT_OPACITY,
  isBelowFloor,
  SLAB_FIELD_OPACITY,
  THROUGH_RENDER_ORDER,
} from './renderer'

/**
 * The rubric's rendering gate: draw calls stay O(color buckets), never
 * O(member count). One InstancedMesh per color — a 10,000-member house must
 * render in a bounded handful of meshes.
 */

const ROLES: MemberRole[] = [
  'bottom-plate', 'top-plate', 'cap-plate', 'stud', 'king-stud', 'trimmer', 'header',
  'sill', 'cripple', 'blocking', 'joist', 'rim-joist', 'girder', 'post', 'rafter',
  'ridge', 'hip', 'valley', 'ceiling-joist', 'collar-tie', 'mudsill', 'stemwall',
  'footing', 'slab', 'vapor-retarder', 'anchor-bolt', 'hold-down', 'block', 'lintel', 'bond-beam',
  'pipe-run', 'vent-stack', 'duct-run', 'wire-run', 'rebar', 'hanger', 'plate-washer',
  'jack-rafter', 'outlooker', 'fascia', 'fire-blocking', 'backing',
]
const MATERIALS: MemberMaterial[] = [
  'lumber', 'pt-lumber', 'engineered', 'concrete', 'steel', 'pvc', 'copper', 'duct',
]

function synthesizeMembers(count: number): Member[] {
  const members: Member[] = []
  for (let i = 0; i < count; i++) {
    members.push({
      system: 'wall-framing',
      role: ROLES[i % ROLES.length] as MemberRole,
      dims: [0.04, 2, 0.09],
      length: 2,
      position: [i * 0.1, 1, 0],
      rotation: [0, (i % 8) * (Math.PI / 4), 0],
      material: MATERIALS[i % MATERIALS.length] as MemberMaterial,
      sourceId: `w${i % 20}`,
    })
  }
  return members
}

/** The FULL FixtureKind union — `satisfies` makes this COMPILE-TIME
 * exhaustive (skeptic advisory 2026-08-21: the gate ran 15/18 kinds and
 * missed water-meter / electric-meter / disconnect; a kind added to
 * core/types now breaks this line, never silently the census). */
const ALL_FIXTURE_KINDS = {
  receptacle: 1,
  'receptacle-gfci': 1,
  'receptacle-wr-gfci': 1,
  switch: 1,
  light: 1,
  'smoke-alarm': 1,
  'co-alarm': 1,
  panel: 1,
  'stub-out': 1,
  'vent-stack': 1,
  register: 1,
  return: 1,
  equipment: 1,
  'water-heater': 1,
  'water-meter': 1,
  cleanout: 1,
  thermostat: 1,
  'exhaust-fan': 1,
  'electric-meter': 1,
  disconnect: 1,
} satisfies Record<Fixture['kind'], 1>
const FIXTURE_KINDS = Object.keys(ALL_FIXTURE_KINDS) as Fixture['kind'][]

/** Kinds a finished house does NOT show (rough-in only) — viewMode 'off'
 * must hide exactly these from the synthetic mix. */
const ROUGH_IN_KINDS = new Set<Fixture['kind']>(['stub-out', 'vent-stack', 'cleanout'])

function synthesizeFixtures(count: number): Fixture[] {
  return Array.from({ length: count }, (_, i) => ({
    system: 'electrical' as const,
    kind: FIXTURE_KINDS[i % FIXTURE_KINDS.length] as Fixture['kind'],
    position: [i * 0.2, 0.4, 0] as const,
    rotationY: 0,
    sourceId: `w${i % 20}`,
  }))
}

type MeshLike = {
  isInstancedMesh?: boolean
  count?: number
  castShadow: boolean
  layers: { mask: number }
  material: {
    depthTest: boolean
    depthWrite: boolean
    transparent: boolean
    opacity: number
    colorWrite: boolean
  }
  renderOrder: number
  onBeforeRender?: { toString(): string }
}
const OVERLAY_MASK = 1 << 1 // host OVERLAY_LAYER = 1
const SCENE_MASK = 1 << 0 // default layer 0

const instanceCount = (group: { children: unknown[] }) =>
  group.children.reduce(
    (sum: number, child) =>
      sum +
      ((child as MeshLike).isInstancedMesh ? ((child as MeshLike).count ?? 0) : 0),
    0,
  )

describe('instanced rendering gate (rubric: UI/UX/Performance)', () => {
  test('10,000 members + 500 fixtures across every role/material stay under 50 draw calls', () => {
    const group = buildGroup(synthesizeMembers(10_000), synthesizeFixtures(500), 'xray')
    expect(group.children.length).toBeLessThanOrEqual(50)
    expect(group.children.length).toBeGreaterThan(8) // sanity: buckets exist
    // X-ray is single-copy everywhere now (the old below-grade ghosts moved
    // to basement mode) — every member + fixture is exactly one instance.
    expect(instanceCount(group)).toBe(10_500)
    // Basement mode: below-floor buckets emit two copies (solid + overlay
    // ghost) but the mesh count stays O(buckets).
    const basement = buildGroup(synthesizeMembers(10_000), synthesizeFixtures(500), 'basement')
    expect(basement.children.length).toBeLessThanOrEqual(50)
  })

  test('bucket count saturates — growing the population adds zero draw calls', () => {
    // 5k already hits every (material, role-color) combination the synthetic
    // mix can produce; doubling the members must not add a single mesh.
    const saturated = buildGroup(synthesizeMembers(5_000), [], 'xray').children.length
    const doubled = buildGroup(synthesizeMembers(10_000), [], 'xray').children.length
    expect(doubled).toBe(saturated)
  })

  test('face buckets scale per WALL, not per member (night-4 cull-exemption split)', () => {
    // Assembly-layer buckets key on (color, face normal, sourceId) so the
    // selected-wall exemption can toggle whole meshes: a 40-wall scene adds
    // O(walls × layer colors) face meshes — bounded, and independent of how
    // many layer MEMBERS each wall has (bands, opening splits).
    const walls = 40
    const perWall = 6 // gyp both faces + sheathing/wrb/cladding bands…
    const members = [] as ReturnType<typeof synthesizeMembers>
    for (let wi = 0; wi < walls; wi++) {
      for (let mi = 0; mi < perWall; mi++) {
        members.push({
          ...synthesizeMembers(1)[0]!,
          role: (['drywall', 'sheathing', 'wrb'] as const)[mi % 3] as 'drywall' | 'sheathing' | 'wrb',
          face: mi % 2 === 0 ? ([0, 1] as const) : ([0, -1] as const),
          sourceId: `wall_${wi}`,
        })
      }
    }
    const group = buildGroup(members, [], 'xray')
    // ≤ walls × (colors × faces present) — here 3 colors × 2 faces = 6/wall
    expect(group.children.length).toBeLessThanOrEqual(walls * 6)
    expect(group.children.length).toBeGreaterThanOrEqual(walls) // split per wall is real
    for (const child of group.children) {
      expect((child.userData as { sourceId?: string }).sourceId).toBeDefined()
    }
    // and the member count is preserved across the split
    const instances = group.children.reduce(
      (sum, c) => sum + (((c as { count?: number }).count) ?? 0),
      0,
    )
    expect(instances).toBe(walls * perWall)
  })

  test('X-ray: everything depth-tested, single scene-layer copy, no render hacks', () => {
    // Round-2 user reports: with depth tricks on the members themselves, a
    // footing painted over nearer studs, then far stud tops read through the
    // top plate. Members must occlude each other naturally in EVERY mode.
    // Round 2026-08-20: the below-floor overlay ghosts are GONE from X-ray —
    // "I shouldn't be able to see the crawl space at all" — so foundation /
    // buried runs are plain depth-tested geometry (visible only via real
    // sightlines); the see-under-the-house job moved to basement mode.
    const belowGrade = synthesizeMembers(100).map((m) => ({
      ...m,
      system: 'foundation' as const,
    }))
    const xray = buildGroup([...belowGrade, ...synthesizeMembers(100)], [], 'xray')
    const meshes = xray.children as unknown as MeshLike[]
    expect(meshes.length).toBeGreaterThan(0)
    for (const m of meshes) {
      expect(m.isInstancedMesh).toBe(true) // members only — no sentinels
      expect(m.layers.mask).toBe(SCENE_MASK) // NO overlay ghosts in X-ray
      expect(m.material.depthTest).toBe(true) // natural near-hides-far
      expect(m.material.depthWrite).toBe(true) // member-vs-member occlusion
      expect(m.material.transparent).toBe(false) // plain opaque draw
      expect(m.material.colorWrite).toBe(true)
      expect(m.renderOrder).toBe(0) // gizmos/handles keep drawing above
      // no custom render hooks — WebGPU-safe
      expect(m.onBeforeRender?.toString()).toBe(new Mesh().onBeforeRender.toString())
    }
    // Assembly layers carry their face normal for the dollhouse cut.
    const layered = buildGroup(
      [
        {
          ...synthesizeMembers(1)[0]!,
          role: 'drywall' as const,
          face: [0, 1] as const,
        },
      ],
      [],
      'xray',
    )
    const faceMesh = layered.children[0] as unknown as { userData: { face?: readonly [number, number]; sourceId?: string } }
    expect(faceMesh.userData.face).toEqual([0, 1])
    // …and their SOURCE WALL id (night-4: the selected wall is exempt from
    // the cut, so face buckets split per wall and tag their mesh).
    expect(faceMesh.userData.sourceId).toBeDefined()
    const twoWalls = buildGroup(
      [
        { ...synthesizeMembers(1)[0]!, role: 'drywall' as const, face: [0, 1] as const, sourceId: 'wall_a' },
        { ...synthesizeMembers(1)[0]!, role: 'drywall' as const, face: [0, 1] as const, sourceId: 'wall_b' },
      ],
      [],
      'xray',
    )
    // same color + same face normal but different walls → separate buckets
    expect(twoWalls.children).toHaveLength(2)
    const ids = twoWalls.children.map((c) => (c.userData as { sourceId?: string }).sourceId).sort()
    expect(ids).toEqual(['wall_a', 'wall_b'])
  })
})

describe('below-floor stratum classification (basement mode, round 2026-08-20)', () => {
  const base = {
    role: 'pipe-run' as MemberRole,
    dims: [2, 0.08, 0.08] as const,
    length: 2,
    rotation: [0, 0, 0] as const,
    sourceId: 'x',
  }
  test('foundation and floor-framing are below-floor by SYSTEM', () => {
    // footing (well below grade)
    expect(
      isBelowFloor({ ...base, system: 'foundation', role: 'footing', material: 'concrete', position: [0, -0.4, 0] }),
    ).toBe(true)
    // slab + vapor retarder ride the foundation system even at y≈0
    expect(
      isBelowFloor({ ...base, system: 'foundation', role: 'slab', material: 'concrete', position: [0, -0.05, 0] }),
    ).toBe(true)
    expect(
      isBelowFloor({ ...base, system: 'foundation', role: 'vapor-retarder', material: 'pvc', position: [0, -0.11, 0] }),
    ).toBe(true)
    // floor joists — the crawl-space ceiling
    expect(
      isBelowFloor({ ...base, system: 'floor-framing', role: 'joist', material: 'lumber', position: [0, -0.12, 0] }),
    ).toBe(true)
  })
  test('buried runs are below-floor by Y-EXTENT; in-wall and at-grade are not', () => {
    // buried DWV main: top of pipe under the floor line
    expect(
      isBelowFloor({ ...base, system: 'plumbing', material: 'pvc', position: [0, -0.25, 0] }),
    ).toBe(true)
    // in-wall cold supply at 0.28 m — above
    expect(
      isBelowFloor({ ...base, system: 'plumbing', material: 'pvc', position: [0, 0.28, 0] }),
    ).toBe(false)
    // wall studs — above
    expect(
      isBelowFloor({ ...base, system: 'wall-framing', role: 'stud', material: 'lumber', dims: [0.04, 2.4, 0.09], position: [0, 1.2, 0] }),
    ).toBe(false)
    // OUTDOOR condenser pad: hvac, sitting ON grade (box straddles up from
    // y=0) — outside the house, NOT under it. Pinned per the refinement.
    expect(
      isBelowFloor({ ...base, system: 'hvac', role: 'slab', material: 'concrete', dims: [0.9, 0.08, 0.9], position: [5, 0.04, 5] }),
    ).toBe(false)
  })
  test('B12 GES joins the buried convention via the y-extent rule: rods + buried GEC below-floor, wall wires above', () => {
    // driven ground rod — 8 ft of copper-clad, top below grade
    expect(
      isBelowFloor({
        ...base,
        system: 'electrical',
        role: 'ground-rod',
        material: 'copper',
        dims: [0.016, 2.4384, 0.016],
        position: [1, -0.05 - 2.4384 / 2, 0],
      }),
    ).toBe(true)
    // buried GEC rod-to-rod leg at rod-top depth
    expect(
      isBelowFloor({
        ...base,
        system: 'electrical',
        role: 'wire-run',
        material: 'copper',
        dims: [1.83, 0.014, 0.014],
        position: [1, -0.05, 0],
      }),
    ).toBe(true)
    // the same conductor strapped up the wall — above
    expect(
      isBelowFloor({
        ...base,
        system: 'electrical',
        role: 'wire-run',
        material: 'copper',
        dims: [1.83, 0.014, 0.014],
        position: [1, 0.45, 0],
      }),
    ).toBe(false)
  })
})

describe('view modes — per-stratum treatment (round 2026-08-20 tri-state)', () => {
  const footing: Member = {
    system: 'foundation',
    role: 'footing',
    dims: [2, 0.3, 0.4],
    length: 2,
    position: [1, -0.45, 0],
    rotation: [0, 0, 0],
    material: 'concrete',
    sourceId: 'fnd',
  }
  const buriedDwv: Member = {
    system: 'plumbing',
    role: 'pipe-run',
    dims: [2, 0.08, 0.08],
    length: 2,
    position: [1, -0.25, 0],
    rotation: [0, 0, 0],
    material: 'pvc',
    sourceId: 'dwv-main',
  }
  const stud: Member = {
    system: 'wall-framing',
    role: 'stud',
    dims: [0.04, 2.4, 0.09],
    length: 2.4,
    position: [1, 1.2, 0],
    rotation: [0, 0, 0],
    material: 'lumber',
    sourceId: 'w1',
  }
  const drywall: Member = {
    ...stud,
    role: 'drywall',
    face: [0, 1],
  }

  test("'xray': below-floor members render depth-tested ONLY — zero overlay ghosts", () => {
    const group = buildGroup([footing, buriedDwv, stud, drywall], synthesizeFixtures(6), 'xray')
    const overlay = (group.children as unknown as MeshLike[]).filter(
      (m) => m.layers.mask === OVERLAY_MASK,
    )
    expect(overlay).toHaveLength(0)
    // …and nothing is transparent: no see-through anywhere in X-ray.
    for (const m of group.children as unknown as MeshLike[]) {
      expect(m.material.transparent).toBe(false)
    }
    expect(instanceCount(group)).toBe(4 + 6)
  })

  test("'basement': below-floor = solid + STRONG overlay ghost; above-floor = faint shell", () => {
    const group = buildGroup([footing, buriedDwv, stud, drywall], synthesizeFixtures(6), 'basement')
    const meshes = group.children as unknown as MeshLike[]
    const ghosts = meshes.filter((m) => m.layers.mask === OVERLAY_MASK)
    const sceneSolids = meshes.filter(
      (m) => m.layers.mask === SCENE_MASK && !m.material.transparent,
    )
    const faints = meshes.filter(
      (m) => m.layers.mask === SCENE_MASK && m.material.transparent,
    )
    // two below-floor colors (concrete footing + pvc dwv) → 2 solid+ghost pairs
    expect(ghosts.length).toBe(2)
    expect(sceneSolids.length).toBe(2)
    for (const g of ghosts) {
      expect(g.material.opacity).toBe(BELOW_GHOST_OPACITY)
      expect(g.material.opacity).toBeGreaterThanOrEqual(0.8) // the star content
      expect(g.material.depthWrite).toBe(true) // self-occlusion in the overlay pass
      expect(g.castShadow).toBe(false)
    }
    // stud + drywall + fixtures collapse into the faint orientation shell
    expect(faints.length).toBeGreaterThanOrEqual(2)
    for (const f of faints) {
      expect(f.material.opacity).toBe(FAINT_OPACITY)
      expect(f.material.opacity).toBeLessThanOrEqual(0.15) // barely visible
      expect(f.material.depthWrite).toBe(false) // never occludes the star
      expect(f.castShadow).toBe(false)
    }
    // census: every member + fixture drawn once on the scene layer, plus one
    // overlay copy per below-floor instance
    expect(instanceCount(group)).toBe(4 + 6 + 2)
  })

  test("'basement': buried runs read THROUGH the slab field — distinct treatments (QA round 3)", () => {
    // The money-shot composition (51-basement-34-sw.png): a slab-on-grade
    // field over the under-slab DWV network. With the field's overlay copy
    // at 0.9 + depth-writing, the pipes only peeked out at the edges — the
    // core basement promise ("you get to see what's under your house…
    // the drainage") was only partially met. Contract: the slab/vapor
    // FIELDS are a translucent depth-silent veil; the buried runs (and
    // their fixtures) draw AFTER them and read through.
    const slabField: Member = {
      system: 'foundation',
      role: 'slab',
      dims: [10, 0.1, 8],
      length: 10,
      position: [5, -0.05, 4],
      rotation: [0, 0, 0],
      material: 'concrete',
      sourceId: 'slab_1',
    }
    const vapor: Member = {
      ...slabField,
      role: 'vapor-retarder',
      material: 'pvc',
      dims: [10, 0.006, 8],
      position: [5, -0.11, 4],
      sourceId: 'vb_1',
    }
    const underSlabDwv: Member = {
      ...buriedDwv, // plumbing pipe-run, top of pipe under the floor line
    }
    const cleanout: Fixture = {
      system: 'plumbing',
      kind: 'cleanout',
      position: [1, -0.2, 0],
      rotationY: 0,
      sourceId: 'dwv-main',
    }
    const group = buildGroup([slabField, vapor, footing, underSlabDwv], [cleanout], 'basement')
    const ghosts = (group.children as unknown as (MeshLike & { renderOrder: number })[]).filter(
      (m) => m.layers.mask === OVERLAY_MASK,
    )
    // FIELDS: translucent, depth-SILENT, first pass — a veil, never a wall
    const fields = ghosts.filter((g) => g.material.opacity === SLAB_FIELD_OPACITY)
    expect(fields).toHaveLength(2) // slab + vapor retarder
    for (const f of fields) {
      expect(f.material.depthWrite).toBe(false)
      expect(f.renderOrder).toBe(0)
    }
    // RUNS (pipe + its cleanout riser): strong, self-occluding, drawn AFTER
    const through = ghosts.filter((g) => g.renderOrder === THROUGH_RENDER_ORDER)
    expect(through).toHaveLength(2)
    for (const t of through) {
      expect(t.material.opacity).toBe(BELOW_GHOST_OPACITY)
      expect(t.material.depthWrite).toBe(true)
    }
    // STRUCTURE (footing): strong, depth-writing, first pass — unchanged
    const struct = ghosts.filter(
      (g) => g.renderOrder === 0 && g.material.opacity === BELOW_GHOST_OPACITY,
    )
    expect(struct).toHaveLength(1)
    // every below-floor bucket still ships its opaque scene-layer twin
    const sceneSolids = (group.children as unknown as MeshLike[]).filter(
      (m) => m.layers.mask === SCENE_MASK && !m.material.transparent,
    )
    expect(sceneSolids).toHaveLength(ghosts.length)
  })

  test("'basement': a BURIED fixture joins the ghosted star content, not the shell", () => {
    // A cleanout riser on the under-slab DWV sits below the floor line —
    // stratum-split like members (advisory 2026-08-21).
    const buriedCleanout: Fixture = {
      system: 'plumbing',
      kind: 'cleanout',
      position: [1, -0.2, 0],
      rotationY: 0,
      sourceId: 'dwv-main',
    }
    const receptacle: Fixture = {
      system: 'electrical',
      kind: 'receptacle',
      position: [1, 0.38, 0],
      rotationY: 0,
      sourceId: 'w1',
    }
    const group = buildGroup([], [buriedCleanout, receptacle], 'basement')
    const meshes = group.children as unknown as MeshLike[]
    const ghosts = meshes.filter((m) => m.layers.mask === OVERLAY_MASK)
    expect(ghosts).toHaveLength(1) // the cleanout's overlay copy
    expect(ghosts[0]?.material.opacity).toBe(BELOW_GHOST_OPACITY)
    const faints = meshes.filter(
      (m) => m.layers.mask === SCENE_MASK && m.material.transparent,
    )
    expect(faints).toHaveLength(1) // the receptacle fades into the shell
    expect(faints[0]?.material.opacity).toBe(FAINT_OPACITY)
    // census: both fixtures on the scene layer + one overlay copy
    expect(instanceCount(group)).toBe(2 + 1)
  })

  test("'off': the FINISHED house — zero members, only finished-surface fixtures", () => {
    const fixtures = synthesizeFixtures(FIXTURE_KINDS.length) // one of each kind
    const group = buildGroup([footing, buriedDwv, stud, drywall], fixtures, 'off')
    const meshes = group.children as unknown as MeshLike[]
    // no framing/MEP/foundation members, no face layers (host skins ARE the
    // walls — also kills the old drywall z-fight), no ghosts, nothing faint
    for (const m of meshes) {
      expect(m.layers.mask).toBe(SCENE_MASK)
      expect(m.material.transparent).toBe(false)
    }
    const surfaceCount = fixtures.filter((f) => !ROUGH_IN_KINDS.has(f.kind)).length
    expect(instanceCount(group)).toBe(surfaceCount)
    expect(surfaceCount).toBe(FIXTURE_KINDS.length - 3)
    // members alone → empty group
    expect(buildGroup([footing, stud, drywall], [], 'off').children).toHaveLength(0)
  })
})

describe('buildGroups — cross-level members split into foreign level groups', () => {
  test('tagged members land in a per-level group, untagged in the main group', () => {
    const { buildGroups } = require('./renderer') as typeof import('./renderer')
    const stud = {
      system: 'wall-framing' as const,
      role: 'stud' as const,
      dims: [0.04, 2.4, 0.09] as const,
      length: 2.4,
      position: [1, 1.2, 0] as const,
      rotation: [0, 0, 0] as const,
      material: 'lumber' as const,
      sourceId: 'w1',
    }
    const rafter = { ...stud, system: 'roof-framing' as const, role: 'rafter' as const, levelId: 'lvlroof' }
    const { group, foreign } = buildGroups([stud, rafter], [], 'xray')
    expect(foreign.size).toBe(1)
    expect(foreign.get('lvlroof')?.name).toBe('bones-foreign-lvlroof')
    // main group holds only the stud's instanced mesh, foreign only the rafter's
    expect(group.children.length).toBeGreaterThan(0)
    expect((foreign.get('lvlroof')?.children.length ?? 0)).toBeGreaterThan(0)
  })
})

describe('exploded roof stratum (day board A, 2026-08-16 + F1 verify round)', () => {
  test('explodedRoofOffset: half an exploded slot (EXPLODED_GAP 5 → 2.5) for ABOVE-owner groups in exploded mode only', () => {
    const { explodedRoofOffset } = require('./renderer') as typeof import('./renderer')
    // above-owner roof group: drops in exploded mode
    expect(explodedRoofOffset('exploded', true)).toBe(-2.5)
    expect(explodedRoofOffset('stacked', true)).toBe(0)
    expect(explodedRoofOffset('solo', true)).toBe(0)
    // viewer store not resolved yet (dynamic import pending) = stacked
    expect(explodedRoofOffset(undefined, true)).toBe(0)
    // F1 gate: a BELOW-owner foreign group (ground-storey porch roof) is
    // NEVER offset — pre-fix it dropped 2.5 m into the storey below it.
    expect(explodedRoofOffset('exploded', false)).toBe(0)
    expect(explodedRoofOffset('stacked', false)).toBe(0)
    expect(explodedRoofOffset(undefined, false)).toBe(0)
  })

  test('buildGroups propagates the strataAbove tag per foreign group (F1)', () => {
    const { buildGroups } = require('./renderer') as typeof import('./renderer')
    const rafter = {
      system: 'roof-framing' as const,
      role: 'rafter' as const,
      dims: [0.04, 0.2, 3] as const,
      length: 3,
      position: [1, 1.2, 0] as const,
      rotation: [0.5, 0, 0] as const,
      material: 'lumber' as const,
      sourceId: 'roofseg',
    }
    const main = { ...rafter, levelId: 'lvlroof', strataAbove: true as const }
    const porch = { ...rafter, sourceId: 'porchseg', levelId: 'lvl0' }
    const { foreign } = buildGroups([main, porch], [], 'xray')
    expect(foreign.get('lvlroof')?.userData.strataAbove).toBe(true)
    expect(foreign.get('lvl0')?.userData.strataAbove).toBe(false)
  })

  test('buildGroups foreign groups start flush at y 0 — the offset is frame-loop applied', () => {
    const { buildGroups } = require('./renderer') as typeof import('./renderer')
    const rafter = {
      system: 'roof-framing' as const,
      role: 'rafter' as const,
      dims: [0.04, 0.2, 3] as const,
      length: 3,
      position: [1, 1.2, 0] as const,
      rotation: [0.5, 0, 0] as const,
      material: 'lumber' as const,
      sourceId: 'roofseg',
      levelId: 'lvlroof',
      strataAbove: true as const,
    }
    const { foreign } = buildGroups([rafter], [], 'xray')
    expect(foreign.get('lvlroof')?.position.y).toBe(0)
  })
})

describe('mountLevelId — render-only mount grouping (F1b closing nit)', () => {
  test('a mountLevelId-only member lands in a foreign group with strataAbove userData', () => {
    const { buildGroups } = require('./renderer') as typeof import('./renderer')
    const rafter = {
      system: 'roof-framing' as const,
      role: 'rafter' as const,
      dims: [3, 0.04, 0.09] as const,
      length: 3,
      position: [2, 0.5, 1] as const,
      rotation: [0, 0, 0.5] as const,
      material: 'lumber' as const,
      sourceId: 'roof1',
      mountLevelId: 'lvlattic',
      strataAbove: true as const,
    }
    const { foreign } = buildGroups([rafter], [], 'xray')
    expect(foreign.has('lvlattic')).toBe(true)
    expect(foreign.get('lvlattic')?.userData.strataAbove).toBe(true)
  })
})

describe('the X-ray never intercepts the event raycast (F2 selection round)', () => {
  test('every built mesh has a no-op raycast — zero intersections pushed, in every mode', () => {
    // R3F recurses the level wrapper groups, so framing meshes (even
    // invisible culled buckets) landed in event.intersections at the
    // wall's own depth and starved the hidden-wall selection gate —
    // hovering a stud highlighted the furniture BEHIND the wall.
    for (const mode of ['xray', 'basement', 'off'] as const) {
      const group = buildGroup(synthesizeMembers(200), synthesizeFixtures(20), mode)
      let meshCount = 0
      group.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        meshCount++
        const intersects: unknown[] = []
        // three's signature: raycast(raycaster, intersects) — a no-op must
        // leave the array empty and never throw on a bare call
        ;(obj.raycast as (r: unknown, i: unknown[]) => void)({}, intersects)
        expect(intersects).toHaveLength(0)
      })
      expect(meshCount).toBeGreaterThan(0) // non-vacuous
    }
  })
})
