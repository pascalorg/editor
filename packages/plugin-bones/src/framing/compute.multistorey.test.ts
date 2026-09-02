import { describe, expect, test } from 'bun:test'
import { baselineConfig, baselineScene } from './baseline-scene'
import { computeTakeoff } from '../engines/takeoff'
import { extractLevels, extractWalls } from '../core/wall-model'
import { FramingNode } from './schema'
import { computeLevel } from './compute'

/**
 * Prod report (2026-08-15, "starter house"): a two-storey house wore its
 * roof at GROUND level — trusses rendered inside the ground floor.
 * INVARIANT — members are emitted in the framing node's LEVEL-LOCAL space
 * (the host mounts each node inside its level group at the stacked storey
 * elevation): a roof living two storeys up must come out shifted by the
 * storey delta, and a shared roof is framed by exactly ONE X-ray node.
 */

const wall = (id: string, level: string, start: [number, number], end: [number, number]) => ({
  id,
  type: 'wall',
  parentId: level,
  start,
  end,
  thickness: 0.114,
  height: 2.5,
  frontSide: 'exterior',
  backSide: 'interior',
  children: [],
})

function twoStoreyScene() {
  const nodes: Record<string, Record<string, unknown>> = {
    bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvl1', 'lvlroof'] },
    lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
    lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: 2.7 },
    lvlroof: { id: 'lvlroof', type: 'level', parentId: 'bldg', level: 2, height: 2.0 },
    w0a: wall('w0a', 'lvl0', [0, 0], [8, 0]),
    w0b: wall('w0b', 'lvl0', [8, 0], [8, 5]),
    w0c: wall('w0c', 'lvl0', [8, 5], [0, 5]),
    w0d: wall('w0d', 'lvl0', [0, 5], [0, 0]),
    w1a: wall('w1a', 'lvl1', [0, 0], [8, 0]),
    w1b: wall('w1b', 'lvl1', [8, 0], [8, 5]),
    w1c: wall('w1c', 'lvl1', [8, 5], [0, 5]),
    w1d: wall('w1d', 'lvl1', [0, 5], [0, 0]),
    roofseg: {
      id: 'roofseg',
      type: 'roof-segment',
      parentId: 'lvlroof',
      position: [4, 0, 2.5],
      rotation: 0,
      roofType: 'gable',
      width: 8.6,
      depth: 5.6,
      pitch: 30,
      thickness: 0.2,
    },
  }
  return nodes
}

const bones = (id: string, levelId: string) =>
  FramingNode.parse({ id, parentId: levelId, jurisdiction: 'AUTO' }) as FramingNode

describe('multi-storey elevations (prod 2026-08-15)', () => {
  test('extractLevels stacks storeys like the host (per building, ordinal order)', () => {
    const levels = extractLevels(twoStoreyScene())
    const byId = new Map(levels.map((l) => [l.id, l]))
    expect(byId.get('lvl0')?.baseY).toBe(0)
    expect(byId.get('lvl1')?.baseY).toBeCloseTo(2.7, 5)
    expect(byId.get('lvlroof')?.baseY).toBeCloseTo(5.4, 5)
  })

  test('baseElevation offsets stack on top of the storey below', () => {
    const nodes = twoStoreyScene()
    ;(nodes.lvl1 as Record<string, unknown>).baseElevation = 0.3
    const byId = new Map(extractLevels(nodes).map((l) => [l.id, l]))
    expect(byId.get('lvl1')?.baseY).toBeCloseTo(3.0, 5)
    expect(byId.get('lvlroof')?.baseY).toBeCloseTo(5.7, 5)
  })

  test('ground-floor X-ray lifts the roof by the storey delta — never at its own ceiling', () => {
    const nodes = twoStoreyScene()
    const node = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const roof = result.members.filter((m) => m.system === 'roof-framing')
    expect(roof.length).toBeGreaterThan(0)
    // cross-level members stay roof-LEVEL-local and carry the tag — the
    // renderer mounts them into the roof level's Object3D, so stacked,
    // exploded AND solo transforms all apply natively (round 3)
    expect(roof.every((m) => m.levelId === 'lvlroof')).toBe(true)
    // roof level ABOVE the lvl0 owner → strataAbove: takes the exploded
    // roof stratum drop (F1)
    expect(roof.every((m) => m.strataAbove === true)).toBe(true)
    const maxY = Math.max(...roof.map((m) => m.position[1]))
    expect(maxY).toBeLessThan(4.0) // local, never pre-shifted to world
  })

  test('roof on the node.s own level frames with no shift (single-storey regression)', () => {
    const nodes = twoStoreyScene()
    // move the roof segment onto lvl0 and drop the other levels' walls
    ;(nodes.roofseg as Record<string, unknown>).parentId = 'lvl0'
    const node = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const roof = result.members.filter((m) => m.system === 'roof-framing')
    expect(roof.length).toBeGreaterThan(0)
    const minY = Math.min(...roof.map((m) => m.position[1]))
    expect(minY).toBeLessThan(5.0)
    // Ground storey (no storey below): the attic strata rule must NOT fire
    // even roomless+slabless (verify round: in-progress ground scenes).
    expect(roof.every((m) => m.strataAbove !== true && m.mountLevelId === undefined)).toBe(true)
  })

  test('span tables reach computeLevel: honest R802.5.1 flags on the 5.6 m ceiling joists (B2/S10)', () => {
    const nodes = twoStoreyScene()
    const node = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const roof = result.members.filter((m) => m.system === 'roof-framing')
    // 8.6×5.6 gable @30°, 2x6 @24": run 2.8 m fits the 20-psf table (3.57 m)
    // — rafters clean, no purlins/struts
    const rafters = roof.filter((m) => m.role === 'rafter')
    expect(rafters.length).toBeGreaterThan(0)
    expect(rafters.every((m) => !m.flag)).toBe(true)
    expect(roof.some((m) => m.role === 'post')).toBe(false)
    // …but the ONE-PIECE 5.6 m ceiling joists exceed 2x6 @16" limited
    // storage (3.90 m): the honest flag rides through to the takeoff
    const cjs = roof.filter((m) => m.role === 'ceiling-joist')
    expect(cjs.length).toBeGreaterThan(0)
    expect(cjs.every((m) => m.flag?.includes('R802.5.1'))).toBe(true)
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    const flagRow = rows.find(
      (r) => r.section === 'Flags' && r.detail.includes('Ceiling joist over prescriptive span'),
    )
    expect(flagRow?.quantity).toBe(cjs.length)
  })

  test('a shared roof is framed by exactly one X-ray — the highest storey wins', () => {
    const nodes = twoStoreyScene()
    const node0 = bones('bonesframing_0', 'lvl0')
    const node1 = bones('bonesframing_1', 'lvl1')
    nodes.bonesframing_0 = node0 as unknown as Record<string, unknown>
    nodes.bonesframing_1 = node1 as unknown as Record<string, unknown>
    const r0 = computeLevel(nodes, node0)
    const r1 = computeLevel(nodes, node1)
    const roof0 = r0.members.filter((m) => m.system === 'roof-framing')
    const roof1 = r1.members.filter((m) => m.system === 'roof-framing')
    expect(roof0).toEqual([])
    expect(r0.warnings.some((w) => w.includes('Roof is framed by'))).toBe(true)
    expect(roof1.length).toBeGreaterThan(0)
    // tagged to the roof level, roof-level-local coordinates
    expect(roof1.every((m) => m.levelId === 'lvlroof')).toBe(true)
  })

  test('floor-one X-ray frames its own walls level-locally (y from 0)', () => {
    const nodes = twoStoreyScene()
    const node = bones('bonesframing_1', 'lvl1')
    nodes.bonesframing_1 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const studs = result.members.filter((m) => m.system === 'wall-framing')
    expect(studs.length).toBeGreaterThan(0)
    // level-local: plates start at y≈0, never at world 2.7
    const minY = Math.min(...studs.map((m) => m.position[1]))
    expect(minY).toBeLessThan(0.5)
  })
})

describe('interior-storey hvac routes in soffits (checklist M1)', () => {
  // Skeptic 2026-08-16: the ground storey's "attic" trunk rose to y 3.10 —
  // INSIDE the storey above (storey height 2.7). Interior storeys have no
  // attic: the trunk caps below the ceiling as a dropped-soffit run.
  function hvacScene() {
    const nodes = twoStoreyScene()
    nodes.z0 = {
      id: 'z0',
      type: 'zone',
      parentId: 'lvl0',
      name: 'Bedroom',
      polygon: [[0, 0], [8, 0], [8, 5], [0, 5]],
    }
    nodes.z1 = {
      id: 'z1',
      type: 'zone',
      parentId: 'lvl1',
      name: 'Bedroom',
      polygon: [[0, 0], [8, 0], [8, 5], [0, 5]],
    }
    return nodes
  }
  const hvacBones = (id: string, levelId: string) =>
    FramingNode.parse({
      id,
      parentId: levelId,
      jurisdiction: 'AUTO',
      showHvac: true,
    }) as FramingNode
  const SOFFIT_WARNING = 'interior-storey ducts run in soffits/floor webs — verify'

  test('ground storey under a walled storey: no duct member above its storey height', () => {
    const nodes = hvacScene()
    const node = hvacBones('bonesframing_h0', 'lvl0')
    nodes.bonesframing_h0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const ducts = result.members.filter((m) => m.system === 'hvac' && m.role === 'duct-run')
    expect(ducts.length).toBeGreaterThan(0)
    for (const m of ducts) {
      expect(m.position[1] + m.dims[1] / 2).toBeLessThanOrEqual(2.7)
    }
    expect(result.warnings).toContain(SOFFIT_WARNING)
  })

  test('top walled storey (bare roof level above) keeps attic routing, warning-free', () => {
    const nodes = hvacScene()
    const node = hvacBones('bonesframing_h1', 'lvl1')
    nodes.bonesframing_h1 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const trunk = result.members.filter(
      (m) => m.system === 'hvac' && m.label?.startsWith('Trunk'),
    )
    expect(trunk.length).toBeGreaterThan(0)
    // the attic plane sits above the wall top — that's the roof level's space
    expect(Math.max(...trunk.map((m) => m.position[1] + m.dims[1] / 2))).toBeGreaterThan(2.5)
    expect(result.warnings).not.toContain(SOFFIT_WARNING)
  })
})

describe('multi-storey — verify-round defect gates', () => {
  test('height-less legacy levels stack at the host default 2.5, not 2.7', () => {
    const nodes = twoStoreyScene()
    delete (nodes.lvl0 as Record<string, unknown>).height
    delete (nodes.lvl1 as Record<string, unknown>).height
    const byId = new Map(extractLevels(nodes).map((l) => [l.id, l]))
    expect(byId.get('lvl1')?.baseY).toBeCloseTo(2.5, 5)
    expect(byId.get('lvlroof')?.baseY).toBeCloseTo(5.0, 5)
  })

  test('own-level roof: election still applies — no double framing', () => {
    // porch roof drawn on lvl0 itself; nodes on lvl0 AND lvl1
    const nodes = twoStoreyScene()
    ;(nodes.roofseg as Record<string, unknown>).parentId = 'lvl0'
    const node0 = bones('bonesframing_0', 'lvl0')
    const node1 = bones('bonesframing_1', 'lvl1')
    nodes.bonesframing_0 = node0 as unknown as Record<string, unknown>
    nodes.bonesframing_1 = node1 as unknown as Record<string, unknown>
    const roof0 = computeLevel(nodes, node0).members.filter((m) => m.system === 'roof-framing')
    const roof1 = computeLevel(nodes, node1).members.filter((m) => m.system === 'roof-framing')
    expect(roof0.length + roof1.length).toBeGreaterThan(0)
    expect(Math.min(roof0.length, roof1.length)).toBe(0)
  })

  test('two buildings: each ground floor keeps its foundation and slab-on-grade', () => {
    const nodes = twoStoreyScene()
    // building B: single storey, its own ground level with walls + slab
    nodes.bldgB = { id: 'bldgB', type: 'building', children: ['lvlB0'] }
    nodes.lvlB0 = { id: 'lvlB0', type: 'level', parentId: 'bldgB', level: 0, height: 4.0 }
    nodes.wBa = wall('wBa', 'lvlB0', [20, 0], [26, 0])
    nodes.wBb = wall('wBb', 'lvlB0', [26, 0], [26, 4])
    nodes.wBc = wall('wBc', 'lvlB0', [26, 4], [20, 4])
    nodes.wBd = wall('wBd', 'lvlB0', [20, 4], [20, 0])
    nodes.slabB = {
      id: 'slabB',
      type: 'slab',
      parentId: 'lvlB0',
      polygon: [
        [20, 0],
        [26, 0],
        [26, 4],
        [20, 4],
      ],
      holes: [],
      elevation: 0.05,
      thickness: 0.1,
    }
    const nodeB = bones('bonesframing_b', 'lvlB0')
    nodes.bonesframing_b = nodeB as unknown as Record<string, unknown>
    const result = computeLevel(nodes, nodeB)
    // ground of building B: foundation present, NO elevated floor framing
    expect(result.members.filter((m) => m.system === 'foundation').length).toBeGreaterThan(0)
    expect(result.members.filter((m) => m.system === 'floor-framing')).toEqual([])
  })

  test('two buildings: each frames its OWN roof; no cross-building adoption', () => {
    const nodes = twoStoreyScene()
    nodes.bldgB = { id: 'bldgB', type: 'building', children: ['lvlB0', 'lvlBroof'] }
    nodes.lvlB0 = { id: 'lvlB0', type: 'level', parentId: 'bldgB', level: 0, height: 2.5 }
    nodes.lvlBroof = { id: 'lvlBroof', type: 'level', parentId: 'bldgB', level: 1, height: 0.4 }
    nodes.wBa = wall('wBa', 'lvlB0', [20, 0], [26, 0])
    nodes.roofsegB = {
      id: 'roofsegB',
      type: 'roof-segment',
      parentId: 'lvlBroof',
      position: [23, 0, 2],
      rotation: 0,
      roofType: 'gable',
      width: 6.5,
      depth: 4.5,
      pitch: 30,
      thickness: 0.2,
    }
    const nodeA = bones('bonesframing_0', 'lvl0')
    const nodeB = bones('bonesframing_b', 'lvlB0')
    nodes.bonesframing_0 = nodeA as unknown as Record<string, unknown>
    nodes.bonesframing_b = nodeB as unknown as Record<string, unknown>
    const roofA = computeLevel(nodes, nodeA).members.filter((m) => m.system === 'roof-framing')
    const roofB = computeLevel(nodes, nodeB).members.filter((m) => m.system === 'roof-framing')
    // both buildings' roofs frame — by their own nodes
    expect(roofA.length).toBeGreaterThan(0)
    expect(roofB.length).toBeGreaterThan(0)
    // each tagged to its own building's roof level
    expect(roofA.every((m) => m.levelId === 'lvlroof')).toBe(true)
    expect(roofB.every((m) => m.levelId === 'lvlBroof')).toBe(true)
  })
})

describe('gable walls on slab-less levels (prod starter house, day board B 2026-08-16)', () => {
  /** Host scenes routinely mark BOTH wall faces 'interior' — these walls
   * carry no frontSide/backSide at all, so everything rides the fallback. */
  const bareWall = (
    id: string,
    level: string,
    start: [number, number],
    end: [number, number],
  ) => ({
    id,
    type: 'wall',
    parentId: level,
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    children: [],
  })

  function gableScene() {
    const nodes: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvlroof'] },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
      lvlroof: { id: 'lvlroof', type: 'level', parentId: 'bldg', level: 1, height: 2.0 },
      // ground storey: bare perimeter + an interior partition, over a slab
      wga: bareWall('wga', 'lvl0', [0, 0], [8, 0]),
      wgb: bareWall('wgb', 'lvl0', [8, 0], [8, 5]),
      wgc: bareWall('wgc', 'lvl0', [8, 5], [0, 5]),
      wgd: bareWall('wgd', 'lvl0', [0, 5], [0, 0]),
      w_mid: bareWall('w_mid', 'lvl0', [0, 2.5], [8, 2.5]),
      slab0: {
        id: 'slab0',
        type: 'slab',
        parentId: 'lvl0',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 5],
          [0, 5],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.1,
      },
      // roof storey: gable-end walls, NO slabs, NO rooms
      wroofa: bareWall('wroofa', 'lvlroof', [0, 0], [8, 0]),
      wroofb: bareWall('wroofb', 'lvlroof', [0, 5], [8, 5]),
    }
    return nodes
  }

  test('gable wall above a slabbed ground storey frames EXTERIOR with the full layer stack', () => {
    // The prod bug: applyExteriorFallback probed THIS level's slabs — a roof
    // level has none, both sides read 'uncovered', the gable framed interior
    // (no sheathing/WRB/cladding). The probe now widens to the storey below.
    const nodes = gableScene()
    const node = bones('bonesframing_roof', 'lvlroof')
    nodes.bonesframing_roof = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    for (const wallId of ['wroofa', 'wroofb']) {
      const roles = new Set(
        result.members.filter((m) => m.sourceId === wallId).map((m) => m.role),
      )
      expect(roles.has('sheathing')).toBe(true)
      expect(roles.has('wrb')).toBe(true)
      expect(roles.has('cladding')).toBe(true)
    }
    // and the takeoff books WSP for the (framed, exterior) gable walls
    expect(result.areas.wallSheathingM2 ?? 0).toBeGreaterThan(0)
  })

  test('ground interior partition stays interior; slabbed perimeter probe unchanged', () => {
    const nodes = gableScene()
    const node = bones('bonesframing_ground', 'lvl0')
    nodes.bonesframing_ground = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const midRoles = new Set(
      result.members.filter((m) => m.sourceId === 'w_mid').map((m) => m.role),
    )
    expect(midRoles.has('sheathing')).toBe(false)
    expect(midRoles.has('wrb')).toBe(false)
    expect(midRoles.has('cladding')).toBe(false)
    expect(midRoles.has('drywall')).toBe(true)
    const perimRoles = new Set(
      result.members.filter((m) => m.sourceId === 'wga').map((m) => m.role),
    )
    expect(perimRoles.has('sheathing')).toBe(true)
  })

  test('no flooring ANYWHERE + no rooms: every straight wall on the level is exterior (attic rule)', () => {
    const nodes = gableScene()
    delete nodes.slab0
    // lvlroof has a storey below it in the building — the attic rule applies
    const walls = extractWalls(nodes, 'lvlroof', [], true)
    expect(walls).toHaveLength(2)
    expect(walls.every((w) => w.exterior)).toBe(true)
  })

  test('a drawn zone suppresses the attic rule — ambiguous walls stay interior', () => {
    const nodes = gableScene()
    delete nodes.slab0
    nodes.zroof = {
      id: 'zroof',
      type: 'zone',
      parentId: 'lvlroof',
      name: 'Loft',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
      ],
      boundaryWallIds: [],
    }
    const walls = extractWalls(nodes, 'lvlroof', [], true)
    expect(walls.every((w) => !w.exterior)).toBe(true)
  })

  test('a zone whose polygon points are all malformed does NOT suppress the attic rule (extractRooms parity)', () => {
    // extractRooms pair-filters polygon points and requires >= 3 VALID
    // vertices — the hasRooms gate must apply the same validation, or a
    // malformed zone counts as a room here while extractRooms drops it.
    const nodes = gableScene()
    delete nodes.slab0
    nodes.zbad = {
      id: 'zbad',
      type: 'zone',
      parentId: 'lvlroof',
      name: 'Ghost',
      polygon: ['a', null, {}, [1]],
      boundaryWallIds: [],
    }
    const walls = extractWalls(nodes, 'lvlroof', [], true)
    expect(walls.every((w) => w.exterior)).toBe(true)
  })

  test('in-progress GROUND storey (no slabs, no rooms, nothing below): walls stay INTERIOR', () => {
    // Verify round 2026-08-16 (F2): the attic rule fired on a bare ground
    // storey — partitions framed exterior/CMU and the takeoff booked
    // sheathing the layer engine never renders. No storey below = no attic.
    const nodes = gableScene()
    delete nodes.slab0
    const walls = extractWalls(nodes, 'lvl0', [], false)
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every((w) => !w.exterior)).toBe(true)
  })
})

describe('takeoff/member consistency (checklist S4, verify round 2026-08-16)', () => {
  /** Bare walls: no frontSide/backSide — everything rides the fallback. */
  const bareWall = (
    id: string,
    level: string,
    start: [number, number],
    end: [number, number],
  ) => ({
    id,
    type: 'wall',
    parentId: level,
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    children: [],
  })

  const sheathingMembers = (r: ReturnType<typeof computeLevel>) =>
    r.members.filter((m) => m.role === 'sheathing')

  test('in-progress ground storey: zero sheathing area AND zero sheathing members', () => {
    // Pre-fix this scene booked wallSheathingM2 > 0 (attic blanket marked
    // every wall exterior) while layoutWallLayers emitted NO sheathing
    // (exteriorSide had no slab/room signal) — the takeoff lied.
    const nodes: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0'] },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.5 },
      wa: bareWall('wa', 'lvl0', [0, 0], [8, 0]),
      wb: bareWall('wb', 'lvl0', [8, 0], [8, 5]),
      w_part: bareWall('w_part', 'lvl0', [0, 2.5], [8, 2.5]),
    }
    const node = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    expect(result.areas.wallSheathingM2 ?? 0).toBe(0)
    expect(sheathingMembers(result)).toHaveLength(0)
    // and nothing framed as CMU either — partitions are not exterior walls
    expect(result.members.filter((m) => m.role === 'block')).toHaveLength(0)
  })

  test('gable storey over a slabbed ground: sheathing area > 0 IMPLIES sheathing members > 0 (non-vacuous)', () => {
    const nodes: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvlroof'] },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
      lvlroof: { id: 'lvlroof', type: 'level', parentId: 'bldg', level: 1, height: 2.0 },
      slab0: {
        id: 'slab0',
        type: 'slab',
        parentId: 'lvl0',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 5],
          [0, 5],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.1,
      },
      wroofa: bareWall('wroofa', 'lvlroof', [0, 0], [8, 0]),
      wroofb: bareWall('wroofb', 'lvlroof', [0, 5], [8, 5]),
    }
    const node = bones('bonesframing_roof', 'lvlroof')
    nodes.bonesframing_roof = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    // booked area and rendered members move TOGETHER
    expect(result.areas.wallSheathingM2 ?? 0).toBeGreaterThan(0)
    expect(sheathingMembers(result).length).toBeGreaterThan(0)
  })
})

describe('LOD-400 B5: PT sole plates split by storey (IRC R317.1(2))', () => {
  test('storey-0 bottom plates bear on the slab and book PT; studs/top plates stay untreated', () => {
    const nodes = twoStoreyScene()
    const node = bones('bonesframing_pt0', 'lvl0')
    nodes.bonesframing_pt0 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const plates = result.members.filter(
      (m) => m.system === 'wall-framing' && m.role === 'bottom-plate',
    )
    expect(plates.length).toBe(4) // one per wall of the rectangle
    for (const p of plates) {
      expect(p.material).toBe('pt-lumber')
      expect(p.label).toContain('PT sole plate')
      expect(p.label).toContain('R317.1')
    }
    // ONLY the sole plate is concrete-contact — everything else untreated
    for (const m of result.members.filter(
      (m) => m.system === 'wall-framing' && m.role !== 'bottom-plate',
    )) {
      expect(m.material).not.toBe('pt-lumber')
    }
    // and the takeoff books the PT SKU from those members (booked == built)
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(
      rows.some((r) => r.section === 'Wall framing' && r.item === '2x4 PT' && r.unit === 'pcs'),
    ).toBe(true)
  })

  test('storey-1 bottom plates bear on the framed floor and stay untreated lumber', () => {
    const nodes = twoStoreyScene()
    const node = bones('bonesframing_pt1', 'lvl1')
    nodes.bonesframing_pt1 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const plates = result.members.filter(
      (m) => m.system === 'wall-framing' && m.role === 'bottom-plate',
    )
    expect(plates.length).toBe(4)
    for (const p of plates) {
      expect(p.material).toBe('lumber')
      expect(p.label).toContain('Bottom plate')
      expect(p.label).not.toContain('R317.1')
    }
    // no PT SKU row anywhere on the upper storey
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(rows.some((r) => r.item.endsWith(' PT'))).toBe(false)
  })
})

describe('multi-storey — mixed roof levels (re-verify regression)', () => {
  test('porch on the ground level + main roof above: the owner frames BOTH', () => {
    const nodes = twoStoreyScene()
    nodes.porchseg = {
      id: 'porchseg',
      type: 'roof-segment',
      parentId: 'lvl0',
      position: [50, 2.5, 2],
      rotation: 0,
      roofType: 'shed',
      width: 3,
      depth: 2,
      pitch: 15,
      thickness: 0.15,
    }
    const node0 = bones('bonesframing_0', 'lvl0')
    const node1 = bones('bonesframing_1', 'lvl1')
    nodes.bonesframing_0 = node0 as unknown as Record<string, unknown>
    nodes.bonesframing_1 = node1 as unknown as Record<string, unknown>
    const roof0 = computeLevel(nodes, node0).members.filter((m) => m.system === 'roof-framing')
    const roof1 = computeLevel(nodes, node1).members.filter((m) => m.system === 'roof-framing')
    // node1 owns: it frames BOTH the main roof and the ground-level porch
    expect(roof0).toEqual([])
    const porch = roof1.filter((m) => m.position[0] > 40)
    const main = roof1.filter((m) => m.position[0] <= 40)
    expect(porch.length).toBeGreaterThan(0)
    expect(main.length).toBeGreaterThan(0)
    // each tagged to ITS source level, positions level-local (unshifted)
    expect(porch.every((m) => m.levelId === 'lvl0')).toBe(true)
    expect(main.every((m) => m.levelId === 'lvlroof')).toBe(true)
    // F1 gate (verify round 2026-08-16): the porch's source level sits
    // BELOW the lvl1 owner — NO strataAbove, so the exploded roof stratum
    // never drops it into the ground storey; the main roof (above the
    // owner) carries the tag and takes the drop.
    expect(porch.every((m) => m.strataAbove === undefined)).toBe(true)
    expect(main.every((m) => m.strataAbove === true)).toBe(true)
  })

  test('single X-ray on the ground frames both roof levels too', () => {
    const nodes = twoStoreyScene()
    nodes.porchseg = {
      id: 'porchseg',
      type: 'roof-segment',
      parentId: 'lvl0',
      position: [50, 2.5, 2],
      rotation: 0,
      roofType: 'shed',
      width: 3,
      depth: 2,
      pitch: 15,
      thickness: 0.15,
    }
    const node0 = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node0 as unknown as Record<string, unknown>
    const roof = computeLevel(nodes, node0).members.filter((m) => m.system === 'roof-framing')
    expect(roof.filter((m) => m.position[0] > 40).length).toBeGreaterThan(0)
    expect(roof.filter((m) => m.position[0] <= 40).length).toBeGreaterThan(0)
  })
})

describe('hvac attic detection — gable-walled roof level (re-verify round)', () => {
  test('a roof level carrying only gable walls keeps ATTIC routing, warning-free', () => {
    const nodes = twoStoreyScene()
    // strip floor one so lvl0 is the top lived storey; roof level gets gables
    delete nodes.w1a
    delete nodes.w1b
    delete nodes.w1c
    delete nodes.w1d
    delete nodes.lvl1
    ;(nodes.bldg as Record<string, unknown>).children = ['lvl0', 'lvlroof']
    nodes.slab0 = {
      id: 'slab0', type: 'slab', parentId: 'lvl0',
      polygon: [[0, 0], [8, 0], [8, 5], [0, 5]], holes: [], elevation: 0.05, thickness: 0.1,
    }
    nodes.zone0 = { id: 'zone0', type: 'zone', parentId: 'lvl0', name: 'Living', polygon: [[0, 0], [8, 0], [8, 5], [0, 5]] }
    ;(nodes.lvl0 as Record<string, unknown>).children = ['w0a', 'w0b', 'w0c', 'w0d', 'slab0', 'zone0']
    nodes.gableA = wall('gableA', 'lvlroof', [0, 2.5], [1.5, 2.5])
    nodes.gableB = wall('gableB', 'lvlroof', [6.5, 2.5], [8, 2.5])
    const node = bones('bonesframing_hvac', 'lvl0')
    ;(node as unknown as Record<string, unknown>).showHvac = true
    nodes.bonesframing_hvac = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    expect(result.warnings.some((w) => w.includes('soffit'))).toBe(false)
    const ducts = result.members.filter((m) => m.role === 'duct-run')
    if (ducts.length > 0) {
      // attic routing: trunk above the wall tops, not capped at ceiling−0.35
      const maxTop = Math.max(...ducts.map((m) => m.position[1] + m.dims[1] / 2))
      expect(maxTop).toBeGreaterThan(2.5)
    }
  })
})

describe('exploded stratum — owner ON the roof level (F1b closure, prod report)', () => {
  test('roof members on a roomless slab-less owner level carry strataAbove', () => {
    const nodes = twoStoreyScene()
    // owner sits on the roof level itself (the user's gable-framing flow)
    const node = bones('bonesframing_roof', 'lvlroof')
    nodes.bonesframing_roof = node as unknown as Record<string, unknown>
    const roof = computeLevel(nodes, node).members.filter((m) => m.system === 'roof-framing')
    expect(roof.length).toBeGreaterThan(0)
    expect(roof.every((m) => m.mountLevelId === 'lvlroof' && m.strataAbove === true)).toBe(true)
    // render-only: the plan-set lift tag stays unset (elevations draw these
    // owner-local — the levelId reuse double-lifted them, verify round)
    expect(roof.every((m) => m.levelId === undefined)).toBe(true)
  })

  test('a walls-only GROUND storey with a roof never strata-drops (no storey below)', () => {
    const nodes = twoStoreyScene()
    delete nodes.lvl1
    delete nodes.lvlroof
    delete nodes.roofseg
    delete nodes.w1a
    delete nodes.w1b
    delete nodes.w1c
    delete nodes.w1d
    ;(nodes.bldg as Record<string, unknown>).children = ['lvl0']
    nodes.roofG = {
      id: 'roofG', type: 'roof-segment', parentId: 'lvl0', position: [4, 2.5, 2.5],
      rotation: 0, roofType: 'gable', width: 8.6, depth: 5.6, pitch: 30, thickness: 0.2,
    }
    const node = bones('bonesframing_g', 'lvl0')
    nodes.bonesframing_g = node as unknown as Record<string, unknown>
    const roof = computeLevel(nodes, node).members.filter((m) => m.system === 'roof-framing')
    expect(roof.length).toBeGreaterThan(0)
    expect(roof.every((m) => m.strataAbove !== true && m.mountLevelId === undefined)).toBe(true)
  })

  test('a porch roof on a lived-in owner level stays flush (no stratum)', () => {
    const nodes = twoStoreyScene()
    delete nodes.roofseg
    nodes.slab0 = {
      id: 'slab0', type: 'slab', parentId: 'lvl0',
      polygon: [[0, 0], [8, 0], [8, 5], [0, 5]], holes: [], elevation: 0.05, thickness: 0.1,
    }
    ;(nodes.lvl0 as Record<string, unknown>).children = ['w0a', 'w0b', 'w0c', 'w0d', 'slab0']
    nodes.porch = {
      id: 'porch', type: 'roof-segment', parentId: 'lvl0', position: [50, 2.5, 2],
      rotation: 0, roofType: 'shed', width: 3, depth: 2, pitch: 15, thickness: 0.15,
    }
    const node = bones('bonesframing_0', 'lvl0')
    nodes.bonesframing_0 = node as unknown as Record<string, unknown>
    const roof = computeLevel(nodes, node).members.filter((m) => m.system === 'roof-framing')
    expect(roof.length).toBeGreaterThan(0)
    expect(roof.every((m) => m.strataAbove !== true)).toBe(true)
  })
})

describe('LOD-400 B3: subfloor booked == built', () => {
  test('deck members exist wherever the takeoff books T&G sheets, and counts agree', () => {
    // On a TWO-STOREY scene (the single-storey baseline is slab-on-grade —
    // no floor framing, which made the first version of this gate vacuous;
    // verify night-6). The upper storey needs a SLAB for the floor engine.
    const scene = twoStoreyScene()
    scene.slab_up = {
      id: 'slab_up',
      type: 'slab',
      parentId: 'lvl1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      holes: [[[3, 2], [4.2, 2], [4.2, 4.6], [3, 4.6]]],
      elevation: 0,
      thickness: 0.3,
    }
    const cfg = FramingNode.parse({
      id: 'bonesframing_up',
      parentId: 'lvl1',
      jurisdiction: 'TX',
      detail: '400',
      showFloor: true,
    })
    const result = computeLevel(scene, cfg)
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    const row = rows.find((r) => r.item.includes('Subfloor'))
    const deck = result.members.filter((m) => m.role === 'subfloor')
    // NON-VACUOUS: the upper storey MUST book and MUST build
    expect(row).toBeDefined()
    expect(deck.length).toBeGreaterThan(0)
    const deckArea = deck.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(row?.quantity).toBe(Math.ceil(deckArea / (1.2192 * 2.4384)))
  })
})

describe('upper-storey plumbing truth (skeptic S2, feat/underfloor-dwv)', () => {
  const plumbedBones = (id: string, levelId: string) =>
    FramingNode.parse({
      id,
      parentId: levelId,
      jurisdiction: 'AUTO',
      showPlumbing: true,
    }) as FramingNode
  const zone = (id: string, levelId: string, wallId: string) => ({
    id,
    type: 'zone',
    parentId: levelId,
    name: 'Bathroom',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 5],
      [0, 5],
    ],
    boundaryWallIds: [wallId],
  })

  test('a first-floor bathroom warns about the missing riser; ground floor stays sewer-labeled', () => {
    const nodes = twoStoreyScene()
    nodes.z1bath = zone('z1bath', 'lvl1', 'w1a')
    const upper = computeLevel(nodes, plumbedBones('bonesframing_up', 'lvl1'))
    expect(upper.warnings.some((w) => w.includes('riser to the storey below'))).toBe(true)
    const upperMain = upper.members.filter((m) => m.sourceId === 'dwv-main')
    expect(upperMain.length).toBeGreaterThan(0)
    for (const m of upperMain) {
      expect(m.label).not.toContain('sewer')
      expect(m.label).toContain('riser to storey below (not modeled)')
    }
    expect(upper.members.some((m) => m.label?.includes('P2603.4'))).toBe(false)

    const grounded = twoStoreyScene()
    grounded.z0bath = zone('z0bath', 'lvl0', 'w0a')
    const ground = computeLevel(grounded, plumbedBones('bonesframing_gnd', 'lvl0'))
    expect(ground.warnings.some((w) => w.includes('riser to the storey below'))).toBe(false)
    expect(
      ground.members.some(
        (m) => m.sourceId === 'dwv-main' && m.label?.includes('sewer/septic'),
      ),
    ).toBe(true)
  })
})

describe('LOD-400 B17: slab-on-grade booked == built, ground storeys only', () => {
  test('baseline census: the ground level BUILDS the slab field + vapor retarder and BOOKS both', () => {
    const result = computeLevel(baselineScene(), baselineConfig('INTL'))
    const field = result.members.filter((m) => m.role === 'slab')
    const membrane = result.members.filter((m) => m.role === 'vapor-retarder')
    expect(field.length).toBeGreaterThan(0)
    expect(membrane.length).toBe(field.length)
    for (const m of [...field, ...membrane]) expect(m.system).toBe('foundation')
    // S4 parity: the yd³ row is the member volume, the sqft row the member
    // area at the stated +10% lap factor — booked == built.
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    const round1 = (n: number) => Math.round(n * 10) / 10
    const vol = field.reduce((sum, m) => sum + m.dims[0] * m.dims[1] * m.dims[2], 0)
    const slabRow = rows.find(
      (r) =>
        r.item === 'Concrete' && r.detail.startsWith('slab field (3-1/2" slab-on-grade, R506.1)'),
    )
    // quantity = NET member volume — the B21e stated waste never inflates it
    expect(slabRow?.quantity).toBe(Math.max(0.1, round1(vol * 1.30795)))
    const area = membrane.reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    const vaporRow = rows.find((r) => r.item === 'Vapor retarder 6-mil poly')
    expect(vaporRow?.quantity).toBe(round1((area * 1.1) / 0.09290304))
    // …and the biggest pour on the job is no longer a phantom: the field
    // outweighs footings + stemwalls combined (the B17 defect shape).
    const pourOf = (detail: string) =>
      rows.find((r) => r.item === 'Concrete' && r.detail.startsWith(detail))?.quantity ?? 0
    expect(slabRow?.quantity ?? 0).toBeGreaterThan(pourOf('footings') + pourOf('stemwalls'))
  })

  test('the slab-on-grade warning names geometry that EXISTS in the same result', () => {
    const result = computeLevel(baselineScene(), baselineConfig('INTL'))
    const warning = result.warnings.find((w) => w.startsWith('Ground floor is slab-on-grade'))
    // the promise: "the Foundation system draws the slab field…"
    expect(warning).toContain('Foundation')
    expect(warning).toContain('slab field')
    expect(warning).toContain('vapor retarder')
    // …and the pointed-at geometry is real, in the SAME compute result
    expect(result.members.some((m) => m.role === 'slab')).toBe(true)
    expect(result.members.some((m) => m.role === 'vapor-retarder')).toBe(true)
  })

  test('upper storeys NEVER grow a ground slab: deck framing yes, slab field no', () => {
    const nodes = twoStoreyScene()
    nodes.slab_up_b17 = {
      id: 'slab_up_b17',
      type: 'slab',
      parentId: 'lvl1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      holes: [],
      elevation: 0.05,
      thickness: 0.1,
    }
    const node = bones('bonesframing_up_b17', 'lvl1')
    nodes.bonesframing_up_b17 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    expect(result.members.filter((m) => m.role === 'slab')).toHaveLength(0)
    expect(result.members.filter((m) => m.role === 'vapor-retarder')).toHaveLength(0)
    // the storey floor is the JOIST platform + deck, not a pour
    expect(result.members.some((m) => m.role === 'joist')).toBe(true)
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(
      rows.some((r) => r.item === 'Concrete' && r.detail.includes('slab field')),
    ).toBe(false)
    expect(rows.some((r) => r.item === 'Vapor retarder 6-mil poly')).toBe(false)
  })

  test('showFoundation OFF: the warning stops promising members and names the toggle instead', () => {
    // Skeptic rider (round 1): with Foundation off, the old wording pointed
    // at geometry that is NOT in the result. The pointer clause is gated.
    const nodes = baselineScene()
    const node = FramingNode.parse({
      ...(baselineConfig('INTL') as unknown as Record<string, unknown>),
      id: 'bonesframing_nofnd',
      showFoundation: false,
    }) as FramingNode
    nodes.bonesframing_nofnd = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    expect(result.members.filter((m) => m.role === 'slab')).toHaveLength(0)
    expect(result.members.filter((m) => m.role === 'vapor-retarder')).toHaveLength(0)
    const warning = result.warnings.find((w) => w.startsWith('Ground floor is slab-on-grade'))
    expect(warning).toContain('enable Foundation')
    expect(warning).not.toContain('draws')
  })

  test('ground storey of the two-storey scene builds the field once a slab exists', () => {
    const nodes = twoStoreyScene()
    nodes.slab_gnd_b17 = {
      id: 'slab_gnd_b17',
      type: 'slab',
      parentId: 'lvl0',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      holes: [],
      elevation: 0.05,
      thickness: 0.1,
    }
    const node = bones('bonesframing_gnd_b17', 'lvl0')
    nodes.bonesframing_gnd_b17 = node as unknown as Record<string, unknown>
    const result = computeLevel(nodes, node)
    const field = result.members.filter((m) => m.role === 'slab')
    expect(field.length).toBeGreaterThan(0)
    for (const m of field) expect(m.sourceId).toBe('slab_gnd_b17')
  })
})

describe('LOD-400 B18d: upper-storey girder posts bear on ground pads end-to-end', () => {
  // 8×6 plan: the 6 m clear span forces a girder + 4x4 posts on the upper
  // floor. The GROUND storey's foundation must pour a pad under every one
  // of them and carve the slab field around each.
  function girderScene() {
    const nodes: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvl1'] },
      lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: 2.7 },
      g0a: wall('g0a', 'lvl0', [0, 0], [8, 0]),
      g0b: wall('g0b', 'lvl0', [8, 0], [8, 6]),
      g0c: wall('g0c', 'lvl0', [8, 6], [0, 6]),
      g0d: wall('g0d', 'lvl0', [0, 6], [0, 0]),
      slab_gnd: {
        id: 'slab_gnd',
        type: 'slab',
        parentId: 'lvl0',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.1,
      },
      slab_up: {
        id: 'slab_up',
        type: 'slab',
        parentId: 'lvl1',
        polygon: [
          [0, 0],
          [8, 0],
          [8, 6],
          [0, 6],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.1,
      },
    }
    return nodes
  }
  const cfg = (id: string, levelId: string) =>
    FramingNode.parse({
      id,
      parentId: levelId,
      jurisdiction: 'TX',
      detail: '400',
      showWalls: true,
      showFloor: true,
      showFoundation: true,
    }) as FramingNode

  const nodes = girderScene()
  const upper = computeLevel(nodes, cfg('bonesframing_b18up', 'lvl1'))
  const posts = upper.members.filter((m) => m.role === 'post')
  const ground = computeLevel(nodes, cfg('bonesframing_b18gnd', 'lvl0'))
  const pads = ground.members.filter((m) => m.label?.startsWith('Pad footing'))

  test('census: one ground pad per upper post, at the exact plan spot (non-vacuous)', () => {
    expect(posts.length).toBeGreaterThan(0)
    expect(pads.length).toBe(posts.length)
    for (const p of posts) {
      expect(
        pads.some(
          (d) =>
            Math.abs((d.position[0] ?? 0) - p.position[0]) < 1e-6 &&
            Math.abs((d.position[2] ?? 0) - p.position[2]) < 1e-6,
        ),
      ).toBe(true)
    }
    // the bearing plane: post bottom (upper-local −storeyHeight) == pad top (ground y 0)
    for (const p of posts) {
      expect(p.position[1] - p.dims[1] / 2).toBeCloseTo(-2.7, 5)
    }
    for (const d of pads) {
      expect((d.position[1] ?? 0) + d.dims[1] / 2).toBeCloseTo(0, 5)
    }
  })

  test('the ground slab field carves around every pad', () => {
    const strips = ground.members.filter((m) => m.role === 'slab')
    expect(strips.length).toBeGreaterThan(0)
    for (const pad of pads) {
      const [phx, phz] = [pad.dims[0] / 2, pad.dims[2] / 2]
      for (const s of strips) {
        const ox =
          Math.min((s.position[0] ?? 0) + s.dims[0] / 2, (pad.position[0] ?? 0) + phx) -
          Math.max((s.position[0] ?? 0) - s.dims[0] / 2, (pad.position[0] ?? 0) - phx)
        const oz =
          Math.min((s.position[2] ?? 0) + s.dims[2] / 2, (pad.position[2] ?? 0) + phz) -
          Math.max((s.position[2] ?? 0) - s.dims[2] / 2, (pad.position[2] ?? 0) - phz)
        expect(Math.min(ox, oz)).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  test('pads join the foundation footings pour; a storey with no floor above pours none', () => {
    const rows = computeTakeoff(ground.members, ground.fixtures, ground.areas)
    const footings = rows.find(
      (r) =>
        r.section === 'Foundation' && r.item === 'Concrete' && r.detail.startsWith('footings'),
    )
    expect(footings).toBeDefined()
    const single = girderScene()
    delete single.slab_up
    ;(single.bldg as { children?: string[] }).children = ['lvl0']
    delete single.lvl1
    const noUpper = computeLevel(single, cfg('bonesframing_b18solo', 'lvl0'))
    expect(noUpper.members.filter((m) => m.label?.startsWith('Pad footing'))).toHaveLength(0)
    const soloRows = computeTakeoff(noUpper.members, noUpper.fixtures, noUpper.areas)
    const soloFootings = soloRows.find(
      (r) =>
        r.section === 'Foundation' && r.item === 'Concrete' && r.detail.startsWith('footings'),
    )
    expect(Number(footings?.quantity)).toBeGreaterThan(Number(soloFootings?.quantity))
  })

  test('the upper storey itself pours nothing (foundation stays a ground concern)', () => {
    expect(upper.members.filter((m) => m.system === 'foundation')).toHaveLength(0)
  })
})

describe('LOD-400 B7: hip thrust members ride computeLevel end-to-end', () => {
  test('a hip-roofed storey composes ceiling joists + collar ties at 400 (non-vacuous)', () => {
    // The E5 baseline scene has no roof segments (recapture = byte-identical
    // on B7) — THIS compose carries the truth that the hip family's new
    // R802.4.2/R802.4.6 members survive extraction → framing → takeoff.
    const nodes = twoStoreyScene()
    delete nodes.lvl1
    delete nodes.lvlroof
    delete nodes.roofseg
    delete nodes.w1a
    delete nodes.w1b
    delete nodes.w1c
    delete nodes.w1d
    ;(nodes.bldg as Record<string, unknown>).children = ['lvl0']
    nodes.roofH = {
      id: 'roofH', type: 'roof-segment', parentId: 'lvl0', position: [4, 2.5, 2.5],
      rotation: 0, roofType: 'hip', width: 10, depth: 12, pitch: 40, thickness: 0.2,
    }
    const cfg = FramingNode.parse({
      id: 'bonesframing_b7', parentId: 'lvl0', jurisdiction: 'TX', detail: '400',
    })
    const result = computeLevel(nodes, cfg)
    const cjs = result.members.filter(
      (m) => m.system === 'roof-framing' && m.role === 'ceiling-joist',
    )
    const ties = result.members.filter(
      (m) => m.system === 'roof-framing' && m.role === 'collar-tie',
    )
    expect(cjs.length).toBeGreaterThan(20)
    expect(ties.length).toBeGreaterThan(0)
    expect(cjs.every((m) => m.label?.includes('R802.4.2'))).toBe(true)
    expect(ties.every((m) => m.label?.includes('R802.4.6'))).toBe(true)
    // S4 free ride: the sticks land on the existing Roof lumber pcs rows
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(rows.some((r) => r.section === 'Roof' && r.item === '2x4' && r.unit === 'pcs')).toBe(true)
    expect(rows.some((r) => r.section === 'Roof' && r.item === '2x6' && r.unit === 'pcs')).toBe(true)
  })
})

describe('LOD-400 B8c: unframed roof intersections reach the computeLevel warnings', () => {
  const PHRASE = 'roof intersection not framed — valley detail required'

  /** Single-storey scene with a gable main + a hip wing punching its eave. */
  function hipWingScene() {
    const nodes = twoStoreyScene()
    delete nodes.lvl1
    delete nodes.lvlroof
    delete nodes.roofseg
    delete nodes.w1a
    delete nodes.w1b
    delete nodes.w1c
    delete nodes.w1d
    ;(nodes.bldg as Record<string, unknown>).children = ['lvl0']
    nodes.roofMain = {
      id: 'roofMain', type: 'roof-segment', parentId: 'lvl0', position: [4, 2.5, 2.5],
      rotation: 0, roofType: 'gable', width: 8.6, depth: 5.6, pitch: 40, thickness: 0.2,
    }
    nodes.roofWing = {
      id: 'roofWing', type: 'roof-segment', parentId: 'lvl0', position: [4, 2.5, 5.5],
      rotation: Math.PI / 2, roofType: 'hip', width: 3, depth: 3, pitch: 40, thickness: 0.2,
    }
    return nodes
  }

  test('a hip wing into the gable main warns (P4 prints computeLevel warnings verbatim)', () => {
    const cfg = FramingNode.parse({
      id: 'bonesframing_b8c', parentId: 'lvl0', jurisdiction: 'TX', detail: '400',
    })
    const result = computeLevel(hipWingScene(), cfg)
    const hits = result.warnings.filter((w) => w.includes(PHRASE))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('roofMain')
    expect(hits[0]).toContain('roofWing')
    // the wing still framed straight through — no valley members exist
    expect(result.members.some((m) => m.role === 'valley')).toBe(false)
  })

  test('LOD 200 stays schematic (valleys are not framed there either — no code claims)', () => {
    const cfg = FramingNode.parse({
      id: 'bonesframing_b8c200', parentId: 'lvl0', jurisdiction: 'TX', detail: '200',
    })
    const result = computeLevel(hipWingScene(), cfg)
    expect(result.warnings.some((w) => w.includes(PHRASE))).toBe(false)
  })
})
