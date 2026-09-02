import { describe, expect, test } from 'bun:test'
import type { Group } from 'three'
import type { Member } from '../core/types'
import {
  applyFaceCut,
  buildGroup,
  collectCutPlanes,
  patchGroup,
  updateWallSides,
  type WallSide,
  XRAY_CUT_BAND,
} from './renderer'

/**
 * NIGHT-8 UX GATES — the camera-POSITION dollhouse cut (verbatim: "the
 * closest [face] to the camera is removed as if the wall was opened. The
 * drywall in the back shows — we don't see through the whole wall").
 *
 * The retired view-DIRECTION cut (face · camera forward > 0.02) blanked
 * BOTH faces of any wall roughly parallel to the view axis — dot ≈ 0 fails
 * the visibility test for both stacks, so side walls read as fully open
 * ("no drywall at all"). These gates drive the pure visibility functions
 * headlessly: near/far truth per azimuth, the exactly-one-face invariant,
 * the hysteresis dead band, mode pins, the never-cull-framing pin, the
 * write-only-on-flip call-count contract, SELECTION INVARIANCE (day-9 #4:
 * selecting a wall must not close its near face over the in-wall MEP), and
 * the patch-reset regression gate (an in-place patch never resets the cut).
 */

// ---------------------------------------------------------------------------
// The 2-wall scene: an EXTERIOR wall along X at z=0 (house interior on +z,
// outdoors on -z; siding + sheathing outside, gypsum inside) and an INTERIOR
// partition along Z at x=1 (gypsum both faces).
// ---------------------------------------------------------------------------

const layer = (
  role: Member['role'],
  face: readonly [number, number],
  position: readonly [number, number, number],
  sourceId: string,
  label?: string,
): Member => ({
  system: 'wall-framing',
  role,
  dims: [2, 2.7, 0.012],
  length: 2,
  position,
  rotation: [0, 0, 0],
  material: 'lumber',
  sourceId,
  face,
  label,
})

const framing = (
  role: Member['role'],
  system: Member['system'],
  position: readonly [number, number, number],
  sourceId: string,
): Member => ({
  system,
  role,
  dims: [0.04, 2.4, 0.09],
  length: 2.4,
  position,
  rotation: [0, 0, 0],
  material: 'lumber',
  sourceId,
})

// Exterior wall 'ext': faces per wall-layers normalOf — the outdoor stack
// carries [0,-1] (two colors → two buckets), the room-side gypsum [0,+1].
const EXT_LAYERS: Member[] = [
  layer('cladding', [0, -1], [2, 1.35, -0.08], 'ext', 'vinyl siding'),
  layer('sheathing', [0, -1], [2, 1.35, -0.05], 'ext'),
  layer('drywall', [0, 1], [2, 1.35, 0.06], 'ext'),
]
// Interior wall 'int' (dir (0,1) → canonical normal (-1,0)): gypsum both faces.
const INT_LAYERS: Member[] = [
  layer('drywall', [-1, 0], [0.94, 1.35, 2], 'int'),
  layer('drywall', [1, 0], [1.06, 1.35, 2], 'int'),
]
// Framing + in-wall MEP that must NEVER be touched by this pass.
const NEVER_CULLED: Member[] = [
  framing('stud', 'wall-framing', [2, 1.2, 0], 'ext'),
  framing('top-plate', 'wall-framing', [1, 2.4, 2], 'int'),
  { ...framing('wire-run', 'electrical', [2, 0.4, 0], 'circuit_1'), material: 'copper' },
  { ...framing('pipe-run', 'plumbing', [1, 0.3, 2], 'cw_main'), material: 'pvc' },
  { ...framing('duct-run', 'hvac', [2, 2.5, 1], 'trunk'), material: 'duct' },
]
const SCENE = [...EXT_LAYERS, ...INT_LAYERS, ...NEVER_CULLED]

const WALLS = [
  {
    id: 'ext',
    start: [0, 0] as const,
    dir: [1, 0] as const,
    length: 4,
  },
  {
    id: 'int',
    start: [1, 1] as const,
    dir: [0, 1] as const,
    length: 2,
  },
]

type FaceChild = {
  userData: { face?: readonly [number, number]; sourceId?: string }
  visible: boolean
}
const faceChildren = (group: Group, sourceId: string): FaceChild[] =>
  (group.children as unknown as FaceChild[]).filter(
    (c) => c.userData.face && c.userData.sourceId === sourceId,
  )
const plainChildren = (group: Group): FaceChild[] =>
  (group.children as unknown as FaceChild[]).filter((c) => !c.userData.face)

/** visibility of every bucket matching (sourceId, face) — asserts they agree. */
function faceVisible(group: Group, sourceId: string, face: readonly [number, number]): boolean {
  const matches = faceChildren(group, sourceId).filter(
    (c) => c.userData.face?.[0] === face[0] && c.userData.face?.[1] === face[1],
  )
  expect(matches.length).toBeGreaterThan(0)
  const states = new Set(matches.map((c) => c.visible))
  expect(states.size).toBe(1) // same wall face → same treatment
  return matches[0]?.visible as boolean
}

function cutAt(group: Group, camX: number, camZ: number, sides = new Map<string, WallSide>()) {
  const planes = collectCutPlanes(SCENE, WALLS)
  updateWallSides(planes, camX, camZ, sides)
  applyFaceCut(group.children as unknown as FaceChild[], sides)
  return sides
}

describe('near/far classification truth — 4 azimuths over the 2-wall scene', () => {
  test('collectCutPlanes: exact wall planes match the wall-layers normal convention (face · n = ±1)', () => {
    const planes = collectCutPlanes(SCENE, WALLS)
    expect(planes.get('ext')).toEqual({ nx: -0, nz: 1, cx: 2, cz: 0 })
    expect(planes.get('int')).toEqual({ nx: -1, nz: 0, cx: 1, cz: 2 })
    for (const m of [...EXT_LAYERS, ...INT_LAYERS]) {
      const p = planes.get(m.sourceId) as { nx: number; nz: number }
      const t = (m.face?.[0] ?? 0) * p.nx + (m.face?.[1] ?? 0) * p.nz
      expect(Math.abs(t)).toBeCloseTo(1, 10)
    }
  })

  test('SOUTH (outside the house): the exterior siding/sheathing OPEN, the room-side gypsum is the visible backing', () => {
    const group = buildGroup(SCENE, [], 'xray')
    cutAt(group, 2, -8)
    // requirement (d): from OUTSIDE, the exterior face hides and the
    // interior drywall of the room behind shows — never see-through.
    expect(faceVisible(group, 'ext', [0, -1])).toBe(false) // near: siding + sheathing
    expect(faceVisible(group, 'ext', [0, 1])).toBe(true) // far: gypsum backing
    // interior wall seen across the room: its camera-side face opens too
    expect(faceVisible(group, 'int', [-1, 0])).toBe(true)
    expect(faceVisible(group, 'int', [1, 0])).toBe(false) // +x face is the camera side (cam x=2 > 1)
  })

  test('NORTH (deep inside, past both walls): the gypsum side of the exterior wall opens, siding is the far backing', () => {
    const group = buildGroup(SCENE, [], 'xray')
    cutAt(group, 2, 10)
    expect(faceVisible(group, 'ext', [0, 1])).toBe(false) // near: room gypsum
    expect(faceVisible(group, 'ext', [0, -1])).toBe(true) // far: siding — the wall stays closed
    expect(faceVisible(group, 'int', [1, 0])).toBe(false)
    expect(faceVisible(group, 'int', [-1, 0])).toBe(true)
  })

  test('EAST (grazing the exterior wall): every wall still opens exactly ONE face — the direction-cull regression', () => {
    const group = buildGroup(SCENE, [], 'xray')
    cutAt(group, 12, 2)
    // Old behavior at this azimuth (view dir ~(-1,0,0)): the ext wall runs
    // along X, both its faces dot ≈ 0 with the view direction → BOTH hidden
    // → see straight through. Position-based: camera z=2 is the +z side.
    expect(faceVisible(group, 'ext', [0, 1])).toBe(false)
    expect(faceVisible(group, 'ext', [0, -1])).toBe(true)
    // interior wall: camera east of x=1 → its +x gypsum opens
    expect(faceVisible(group, 'int', [1, 0])).toBe(false)
    expect(faceVisible(group, 'int', [-1, 0])).toBe(true)
  })

  test('WEST: mirrored on the interior wall — the -x gypsum opens, the next room face shows', () => {
    const group = buildGroup(SCENE, [], 'xray')
    cutAt(group, -12, 2)
    expect(faceVisible(group, 'int', [-1, 0])).toBe(false) // your drywall opens
    expect(faceVisible(group, 'int', [1, 0])).toBe(true) // the next room's face shows
    expect(faceVisible(group, 'ext', [0, 1])).toBe(false)
    expect(faceVisible(group, 'ext', [0, -1])).toBe(true)
  })

  test('full 360° orbit: EXACTLY one face per wall hidden at every step — never see-through, never sealed', () => {
    const group = buildGroup(SCENE, [], 'xray')
    const sides = new Map<string, WallSide>()
    for (let step = 0; step < 24; step++) {
      const a = (step / 24) * Math.PI * 2
      cutAt(group, 2 + 10 * Math.cos(a), 1.5 + 10 * Math.sin(a), sides)
      for (const wall of ['ext', 'int']) {
        const hidden = faceChildren(group, wall).filter((c) => !c.visible)
        const hiddenSigns = new Set(hidden.map((c) => JSON.stringify(c.userData.face)))
        expect(hiddenSigns.size).toBe(1) // one face sign hidden — no more, no less
      }
    }
  })
})

describe('hysteresis — the ±XRAY_CUT_BAND dead band around the wall plane', () => {
  const planes = () => collectCutPlanes(SCENE, WALLS)

  test('camera inside the band → the committed side HOLDS (crossing the plane included)', () => {
    const sides = new Map<string, WallSide>()
    updateWallSides(planes(), 2, -8, sides) // clearly outside
    expect(sides.get('ext')?.side).toBe(-1)
    // drift into the band, even PAST the plane: still no flip
    for (const z of [-0.4, -0.1, 0.05, 0.3, XRAY_CUT_BAND - 0.01]) {
      updateWallSides(planes(), 2, z, sides)
      expect(sides.get('ext')?.side).toBe(-1)
    }
    // clearly past the band: flips exactly then
    updateWallSides(planes(), 2, XRAY_CUT_BAND + 0.01, sides)
    expect(sides.get('ext')?.side).toBe(1)
  })

  test('grazing wobble across the plane never flaps: one flip per real crossing, zero inside the band', () => {
    const sides = new Map<string, WallSide>()
    updateWallSides(planes(), 2, -2, sides)
    const flips: number[] = []
    let last = sides.get('ext')?.side as number
    for (let i = 0; i < 200; i++) {
      // oscillate z within ±0.35 of the plane — always inside the band
      updateWallSides(planes(), 2, 0.35 * Math.sin(i / 3), sides)
      const now = sides.get('ext')?.side as number
      if (now !== last) flips.push(i)
      last = now
    }
    expect(flips).toEqual([]) // dead band = dead calm
  })

  test('a fresh camera INSIDE the band commits once and then holds', () => {
    const sides = new Map<string, WallSide>()
    updateWallSides(planes(), 2, 0.2, sides) // first sight, inside the band
    expect(sides.get('ext')?.side).toBe(1)
    updateWallSides(planes(), 2, -0.4, sides) // wobble to the other side, still inside
    expect(sides.get('ext')?.side).toBe(1)
  })

  test('a re-oriented wall never reuses its stale side (the cached normal is checked)', () => {
    const sides = new Map<string, WallSide>()
    updateWallSides(planes(), 2, 8, sides)
    expect(sides.get('ext')?.side).toBe(1)
    // same id, rotated 90° (canonical normal now (-1,0)): the camera sits a
    // mere 0.3 m off the NEW plane — inside the band — but the stale +1 must
    // not be held against a normal it never described: fresh commit → -1.
    const rotated = collectCutPlanes([], [
      { id: 'ext', start: [2, -2] as const, dir: [0, 1] as const, length: 4 },
    ])
    updateWallSides(rotated, 2.3, 0, sides)
    expect(sides.get('ext')).toEqual({ side: -1, nx: -1, nz: 0 })
  })
})

describe('mode pins — the cut belongs to X-ray alone', () => {
  test("OFF: no face buckets exist and the cut pass leaves every child visible (finished house keeps both faces)", () => {
    const group = buildGroup(SCENE, [], 'off')
    for (const c of group.children) {
      expect((c.userData as { face?: unknown }).face).toBeUndefined()
    }
    const sides = cutAt(group, 2, -8)
    expect(sides.get('ext')?.side).toBe(-1) // classification ran…
    for (const c of group.children) expect(c.visible).toBe(true) // …and touched nothing
  })

  test('BASEMENT: buckets are built face-less — the cut pass cannot touch the faint shell', () => {
    const group = buildGroup(SCENE, [], 'basement')
    expect(group.children.length).toBeGreaterThan(0)
    for (const c of group.children) {
      expect((c.userData as { face?: unknown }).face).toBeUndefined()
    }
    cutAt(group, 2, -8)
    for (const c of group.children) expect(c.visible).toBe(true)
  })

  test('framing and in-wall MEP are NEVER culled by this pass, from any azimuth', () => {
    const group = buildGroup(SCENE, [], 'xray')
    // Census: ONLY the layer stacks carry the cut's face key — ext wall
    // (cladding + sheathing + gypsum colors = 3 buckets) + int wall (gypsum
    // × 2 faces = 2). A build that fabricates faces onto framing/MEP
    // buckets would put them in the cut's reach — pinned here.
    const faced = (group.children as unknown as FaceChild[]).filter((c) => c.userData.face)
    expect(faced).toHaveLength(5)
    expect(plainChildren(group).length).toBeGreaterThanOrEqual(4) // lumber/wire/pipe/duct buckets
    const sides = new Map<string, WallSide>()
    for (const [x, z] of [
      [2, -8],
      [2, 10],
      [12, 2],
      [-12, 2],
      [0.5, 2],
    ] as const) {
      cutAt(group, x, z, sides)
      for (const c of plainChildren(group)) expect(c.visible).toBe(true)
      // …while SOME layer face is hidden (the pass is live, not vacuous)
      expect(
        (group.children as unknown as FaceChild[]).some((c) => c.userData.face && !c.visible),
      ).toBe(true)
    }
  })
})

describe('write-only-on-flip — the call-count contract (perf round survivorship)', () => {
  /** A face bucket stand-in whose .visible setter counts every write. */
  function probe(face: readonly [number, number], sourceId: string) {
    let value = true
    let writes = 0
    return {
      child: {
        userData: { face, sourceId },
        get visible() {
          return value
        },
        set visible(v: boolean) {
          writes++
          value = v
        },
      },
      writes: () => writes,
    }
  }

  test('a stable orbit on one side: ONE write per near face total, ZERO for far faces, zero churn across 100 frames', () => {
    const planes = collectCutPlanes(SCENE, WALLS)
    const near = probe([0, -1], 'ext')
    const far = probe([0, 1], 'ext')
    const sides = new Map<string, WallSide>()
    for (let frame = 0; frame < 100; frame++) {
      // camera swings widely but stays on the -z side of the ext wall
      updateWallSides(planes, 2 + Math.sin(frame) * 6, -3 - Math.cos(frame), sides)
      applyFaceCut([near.child, far.child], sides)
    }
    expect(near.writes()).toBe(1) // hidden once, then held
    expect(far.writes()).toBe(0) // stays visible — no redundant write
    expect(near.child.visible).toBe(false)
    expect(far.child.visible).toBe(true)
  })

  test('crossing the plane: exactly one write per face bucket of the flipped wall, the other wall untouched', () => {
    const planes = collectCutPlanes(SCENE, WALLS)
    const extNear = probe([0, -1], 'ext')
    const extFar = probe([0, 1], 'ext')
    const intA = probe([-1, 0], 'int')
    const intB = probe([1, 0], 'int')
    const all = [extNear.child, extFar.child, intA.child, intB.child]
    const sides = new Map<string, WallSide>()
    updateWallSides(planes, 2, -8, sides)
    applyFaceCut(all, sides)
    const baseline = [extNear.writes(), extFar.writes(), intA.writes(), intB.writes()]
    // cross the ext plane decisively (int wall's side is unchanged: x stays 2)
    updateWallSides(planes, 2, 8, sides)
    applyFaceCut(all, sides)
    expect(extNear.writes()).toBe((baseline[0] as number) + 1)
    expect(extFar.writes()).toBe((baseline[1] as number) + 1)
    expect(intA.writes()).toBe(baseline[2] as number) // no flip → no write
    expect(intB.writes()).toBe(baseline[3] as number)
  })

  test('selection toggling causes ZERO visibility writes — the cut is selection-blind (day-9 #4)', () => {
    // The exemption's removal is also a perf win: selecting/deselecting a
    // wall used to flip its near face (two writes per toggle); now the cut
    // has no selection input at all, so a click costs nothing here. The
    // smuggled third argument keeps this gate fatal to a restored exemption:
    // honoring it would re-show the near face on even frames → writes ≫ 1.
    const planes = collectCutPlanes(SCENE, WALLS)
    const near = probe([0, -1], 'ext')
    const far = probe([0, 1], 'ext')
    const sides = new Map<string, WallSide>()
    const cut = applyFaceCut as unknown as (
      children: readonly { userData: unknown; visible: boolean }[],
      s: ReadonlyMap<string, WallSide>,
      selected?: readonly string[],
    ) => void
    for (let frame = 0; frame < 60; frame++) {
      updateWallSides(planes, 2, -8, sides)
      cut([near.child, far.child], sides, frame % 2 === 0 ? ['ext'] : undefined)
    }
    expect(near.writes()).toBe(1) // the initial commit only — selection adds nothing
    expect(far.writes()).toBe(0)
    expect(near.child.visible).toBe(false) // open toward the camera even while "selected"
    expect(far.child.visible).toBe(true)
  })

  test('the side cache itself is write-stable: entry object identity survives same-side frames', () => {
    const planes = collectCutPlanes(SCENE, WALLS)
    const sides = new Map<string, WallSide>()
    updateWallSides(planes, 2, -8, sides)
    const entry = sides.get('ext')
    for (let i = 0; i < 50; i++) updateWallSides(planes, 2 + i * 0.1, -8, sides)
    expect(sides.get('ext')).toBe(entry as WallSide) // mutated in place, never re-minted
  })
})

describe('selection invariance (day-9 #4) and fallbacks', () => {
  // The retired night-4 exemption kept BOTH faces of the SELECTED wall
  // visible — under the position cut that CLOSED the near drywall over the
  // in-wall wires/pipes exactly when the user opened the Engineering card
  // to look inside ("electrical, plumbing, all the wires… disappear").
  // applyFaceCut no longer takes a selection at all; these gates smuggle
  // one through a widened cast so RESTORING the exemption (re-adding the
  // parameter and honoring it) fails here, not just in review.
  const cutWithSelection = applyFaceCut as unknown as (
    children: readonly FaceChild[],
    sides: ReadonlyMap<string, WallSide>,
    selected?: readonly string[],
  ) => void

  // Near-face truth per azimuth for both walls (same geometry as the
  // classification suite above): [cam, hidden ext face, hidden int face].
  const AZIMUTH_TRUTH = [
    [[2, -8], [0, -1], [1, 0]], // SOUTH, outside: siding/sheathing open
    [[2, 10], [0, 1], [1, 0]], // NORTH, deep inside: room gypsum opens
    [[12, 2], [0, 1], [1, 0]], // EAST: interior side of ext, +x side of int
    [[-12, 2], [0, 1], [-1, 0]], // WEST: the int wall mirrors
  ] as const

  test('a SELECTED wall cuts EXACTLY like an unselected one — near face open toward the camera, pinned at 4 azimuths', () => {
    for (const [[camX, camZ], extHidden, intHidden] of AZIMUTH_TRUTH) {
      const plain = buildGroup(SCENE, [], 'xray')
      const selectedGroup = buildGroup(SCENE, [], 'xray')
      const planes = collectCutPlanes(SCENE, WALLS)
      const sidesA = new Map<string, WallSide>()
      const sidesB = new Map<string, WallSide>()
      updateWallSides(planes, camX, camZ, sidesA)
      updateWallSides(planes, camX, camZ, sidesB)
      applyFaceCut(plain.children as unknown as FaceChild[], sidesA)
      cutWithSelection(selectedGroup.children as unknown as FaceChild[], sidesB, ['ext', 'int'])
      // identical build → children align by index; selection changes NOTHING
      const a = (plain.children as unknown as FaceChild[]).map((c) => c.visible)
      const b = (selectedGroup.children as unknown as FaceChild[]).map((c) => c.visible)
      expect(b).toEqual(a)
      // the selected wall reads OPEN toward the camera: near face hidden,
      // far face the closed backing — the in-wall guts are in direct view
      expect(faceVisible(selectedGroup, 'ext', extHidden)).toBe(false)
      expect(faceVisible(selectedGroup, 'ext', [-extHidden[0], -extHidden[1]])).toBe(true)
      expect(faceVisible(selectedGroup, 'int', intHidden)).toBe(false)
      expect(faceVisible(selectedGroup, 'int', [-intHidden[0], -intHidden[1]])).toBe(true)
      // …and the guts themselves stay untouchable by this pass, selected or not
      for (const c of plainChildren(selectedGroup)) expect(c.visible).toBe(true)
    }
  })

  test('dedupe-twin consistency under the new rule: kept id, dropped-twin id, or no selection — one identical cut', () => {
    // Members always carry the KEPT twin's sourceId (compute's colinear
    // dedupe). The old exemption had to resolve dropped ids through
    // duplicateOf; selection-blindness subsumes that mapping: EVERY id —
    // kept, dropped, or absent — must yield the same visibility state.
    const snapshots: boolean[][] = []
    for (const selected of [undefined, ['ext'], ['ext_dropped_twin'], ['nonexistent']] as const) {
      const group = buildGroup(SCENE, [], 'xray')
      const planes = collectCutPlanes(SCENE, WALLS)
      const sides = new Map<string, WallSide>()
      updateWallSides(planes, 2, -8, sides)
      cutWithSelection(group.children as unknown as FaceChild[], sides, selected)
      snapshots.push((group.children as unknown as FaceChild[]).map((c) => c.visible))
    }
    for (const s of snapshots.slice(1)) expect(s).toEqual(snapshots[0] as boolean[])
    expect((snapshots[0] as boolean[]).some((v) => !v)).toBe(true) // the cut is live, not vacuous
  })

  test('patch-reset regression gate: applyFaceCut → patchGroup(same structure) → the visibility snapshot survives', () => {
    // The far-face review flagged this hole: a same-structure in-place patch
    // (every live-drag preview tick) must NOT reset .visible on face buckets
    // — applyFaceCut writes only on side FLIPS, so a patch that silently
    // re-showed the near face would STAY wrong until the camera crossed the
    // wall plane. Pin: patch rewrites matrices, never visibility.
    const group = buildGroup(SCENE, [], 'xray')
    const sides = cutAt(group, 2, -8)
    const snapshot = (group.children as unknown as FaceChild[]).map((c) => c.visible)
    expect(snapshot.some((v) => !v)).toBe(true) // the cut is live before the patch
    const moved = SCENE.map((m) => ({
      ...m,
      position: [m.position[0] + 0.4, m.position[1], m.position[2]] as const,
    }))
    expect(patchGroup(group, moved, [], 'xray')).toBe(true) // in-place path taken
    expect((group.children as unknown as FaceChild[]).map((c) => c.visible)).toEqual(snapshot)
    // the next frame's cut on the unchanged camera side flips nothing
    applyFaceCut(group.children as unknown as FaceChild[], sides)
    expect((group.children as unknown as FaceChild[]).map((c) => c.visible)).toEqual(snapshot)
  })

  test('a face bucket whose wall the compute did not return still cuts via the member-centroid plane', () => {
    const gable: Member[] = [
      layer('sheathing', [0, -1], [6, 4, -0.05], 'roofgable'),
      layer('cladding', [0, -1], [6, 4, -0.08], 'roofgable', 'vinyl'),
      layer('drywall', [0, 1], [6, 4, 0.05], 'roofgable'),
    ]
    const planes = collectCutPlanes(gable, WALLS)
    const p = planes.get('roofgable') as { nx: number; nz: number; cx: number; cz: number }
    expect(p.nx).toBe(0)
    expect(p.nz).toBe(-1) // first face seen is the canonical normal
    expect(p.cx).toBeCloseTo(6, 10)
    expect(p.cz).toBeCloseTo(-0.0266, 3) // centroid of the three stacks ≈ centerline
    const group = buildGroup(gable, [], 'xray')
    const sides = new Map<string, WallSide>()
    updateWallSides(planes, 6, -10, sides)
    applyFaceCut(group.children as unknown as FaceChild[], sides)
    expect(faceVisible(group, 'roofgable', [0, -1])).toBe(false) // camera-side face opens
    expect(faceVisible(group, 'roofgable', [0, 1])).toBe(true)
  })

  test('a face with NO classifiable plane is left visible — this pass may open one face, never both', () => {
    const orphan = probeChild([0, 1], 'nowhere')
    applyFaceCut([orphan], new Map())
    expect(orphan.visible).toBe(true)
  })

  function probeChild(face: readonly [number, number], sourceId: string) {
    return { userData: { face, sourceId }, visible: true }
  }
})
