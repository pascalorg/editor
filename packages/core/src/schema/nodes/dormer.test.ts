import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  DormerNode,
  getDormerDefaultWindowFace,
  getDormerExposedFaces,
  getDormerWindowExposure,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SkylightNode,
  WindowNode,
} from '../../index'
import { withIdAllocator } from '../base'

function fixture() {
  const building = BuildingNode.parse({ id: 'building_b', children: ['level_l'] })
  const level = LevelNode.parse({ id: 'level_l', parentId: building.id, children: ['roof_r'] })
  const roof = RoofNode.parse({ id: 'roof_r', parentId: level.id, children: ['rseg_s'] })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_s',
    parentId: roof.id,
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 45,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.25,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: ['dormer_d'],
  })
  const dormer = DormerNode.parse({
    id: 'dormer_d',
    parentId: segment.id,
    roofSegmentId: segment.id,
    position: [0, 4, 2],
    width: 2,
    depth: 2,
    height: 3,
    wallSkirtHeight: 2,
    windowOffsetY: 0.8,
    children: ['window_w'],
  })
  const window = WindowNode.parse({
    id: 'window_w',
    parentId: dormer.id,
    dormerId: dormer.id,
    dormerFace: 'front',
    position: [0, -0.2, 0],
    width: 0.5,
    height: 0.4,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, roof, segment, dormer, window].map((node) => [node.id, node]),
  )
  return { nodes, level, roof, segment, dormer, window }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function exposure(f: ReturnType<typeof fixture>, dormer = f.dormer, window = f.window) {
  const before = structuredClone({ nodes: f.nodes, dormer, window, segment: f.segment })
  const input = freeze(structuredClone(before))
  const allocated: string[] = []
  const result = withIdAllocator(
    (prefix) => {
      allocated.push(prefix)
      return `${prefix}_unexpected`
    },
    () =>
      getDormerWindowExposure(input.dormer, input.window, input.segment, { nodes: input.nodes }),
  )
  expect(allocated).toEqual([])
  expect(input).toEqual(before)
  expect({ nodes: f.nodes, dormer, window, segment: f.segment }).toEqual(before)
  return result
}

function addCover(
  f: ReturnType<typeof fixture>,
  suffix: string,
  roofY: number,
  cut = false,
  independentBuilding = false,
) {
  let parentLevel = f.nodes[f.level.id] as LevelNode
  if (independentBuilding) {
    const building = BuildingNode.parse({ id: `building_${suffix}`, children: [`level_${suffix}`] })
    parentLevel = LevelNode.parse({ id: `level_${suffix}`, parentId: building.id, children: [] })
    f.nodes[building.id] = building
    f.nodes[parentLevel.id] = parentLevel
  }
  const roof = RoofNode.parse({
    id: `roof_${suffix}`,
    parentId: parentLevel.id,
    position: [0, roofY, 4.5],
    children: [`rseg_${suffix}`],
  })
  const segment = RoofSegmentNode.parse({
    id: `rseg_${suffix}`,
    parentId: roof.id,
    roofType: 'flat',
    width: 4,
    depth: 4,
    wallHeight: 2,
    wallThickness: 0,
    deckThickness: 0.25,
    shingleThickness: 0.05,
    overhang: 0,
    gableOverhang: 0,
    children: cut ? [`skylight_${suffix}`] : [],
  })
  f.nodes[roof.id] = roof
  f.nodes[segment.id] = segment
  f.nodes[parentLevel.id] = { ...parentLevel, children: [...parentLevel.children, roof.id] }
  if (cut) {
    f.nodes[`skylight_${suffix}`] = SkylightNode.parse({
      id: `skylight_${suffix}`,
      parentId: segment.id,
      roofSegmentId: segment.id,
      position: [0, 2.3, 0],
      width: 1,
      height: 1,
    })
  }
  return { roof, segment }
}

// Independent oracles: y=6-|z| for the bare 45° host, plus .30/cos(45°)
// for its finished covering, and elementary face/yaw transforms. The rule is
// strictly >.01m CENTRE clearance, not whole-window clearance. No sampled
// candidate geometry or incidental triangle ordering determines expected values.
describe('dormer exposure against finished physical covering', () => {
  test('a centre between bare shell and finished covering is buried', () => {
    const f = fixture()
    const result = exposure(f, f.dormer, { ...f.window, position: [0, -0.8, 0] })
    expect(result.status).toBe('buried')
    if (result.status === 'unmeasured') throw new Error(result.reason)
    expect(result.position[1]).toBeCloseTo(3.2, 9)
    expect(result.coveringY).toBeCloseTo(3 + 0.3 * Math.SQRT2, 9)
    expect(result.clearanceM).toBeCloseTo(0.2 - 0.3 * Math.SQRT2, 9)
  })

  test('actual edited child position and face win over legacy offsets', () => {
    const f = fixture()
    expect(getDormerExposedFaces(f.dormer, f.segment, { nodes: f.nodes })).toEqual({
      front: true,
      back: false,
    })
    expect(exposure(f, f.dormer, { ...f.window, position: [0, -1, 0] }).status).toBe('buried')
    expect(
      exposure(f, f.dormer, { ...f.window, dormerFace: 'back', position: [0, 2, 0] }).status,
    ).toBe('exposed')
    // A child's own centre, not its stored parent's inline default, determines exposure.
    const changedLegacy = { ...f.dormer, windowOffsetY: -20 }
    expect(exposure(f, changedLegacy).status).toBe('exposed')
  })

  test('actual face-local u/v/normal offset is transformed through dormer yaw', () => {
    const f = fixture()
    const dormer = {
      ...f.dormer,
      position: [1, 4, 1] as [number, number, number],
      rotation: Math.PI / 2,
    }
    const window = { ...f.window, position: [0.25, 2, 0.2] as [number, number, number] }
    const result = exposure(f, dormer, window)
    if (result.status === 'unmeasured') throw new Error(result.reason)
    expect(result.status).toBe('exposed')
    // Front origin z1 plus normal .2; Ry(pi/2) maps [u,z] to [z,-u].
    result.position.forEach((value, i) => {
      expect(value).toBeCloseTo([2.2, 6, 0.75][i]!, 9)
    })
    expect(result.coveringY).toBeCloseTo(5.25 + 0.3 * Math.SQRT2, 9)
    expect(result.clearanceM).toBeCloseTo(0.75 - 0.3 * Math.SQRT2, 9)
  })

  for (const [clearance, status] of [
    [0.009, 'buried'],
    [0.01, 'buried'],
    [0.011, 'exposed'],
  ] as const) {
    test(`native centre clearance ${clearance} is ${status}`, () => {
      const f = fixture()
      f.segment = RoofSegmentNode.parse({
        ...f.segment,
        roofType: 'flat',
        wallHeight: 3.5,
        deckThickness: 0.25,
        shingleThickness: 0.25,
      })
      f.nodes[f.segment.id] = f.segment
      const dormer = { ...f.dormer, position: [0, 4, 0] as [number, number, number] }
      // The .4m window bottom remains below the covering in all three cases.
      expect(exposure(f, dormer, { ...f.window, position: [0, clearance, 0] }).status).toBe(status)
    })
  }

  test('removes only the queried dormer cut immutably, not another hosted skylight', () => {
    const f = fixture()
    expect(exposure(f).status).toBe('exposed')
    const cut = SkylightNode.parse({
      id: 'skylight_other',
      parentId: f.segment.id,
      roofSegmentId: f.segment.id,
      position: [0, 3, 3],
      width: 1,
      height: 1,
    })
    f.nodes[cut.id] = cut
    f.segment = { ...f.segment, children: [f.dormer.id, cut.id] }
    f.nodes[f.segment.id] = f.segment
    const result = exposure(f)
    expect(result).toMatchObject({ status: 'unmeasured', reason: 'accessory-cut' })
    expect(result.nodeIds).toContain(cut.id)
    expect(getDormerExposedFaces(f.dormer, f.segment, { nodes: f.nodes }).front).toBe(false)
  })

  test('a local host miss is not global exposure; another covering still buries the child', () => {
    const f = fixture()
    const proud = { ...f.dormer, position: [0, 8, 3.5] as [number, number, number] }
    const window = { ...f.window, position: [0, 0, 0] as [number, number, number] }
    expect(exposure(f, proud, window)).toMatchObject({
      status: 'exposed',
      coveringY: null,
      clearanceM: null,
    })
    const upper = addCover(f, 'upper', 8)
    const blocked = exposure(f, proud, window)
    expect(blocked.status).toBe('buried')
    if (blocked.status === 'unmeasured') throw new Error(blocked.reason)
    expect(blocked.coveringY).toBeCloseTo(10.3, 9)
    expect(blocked.nodeIds).toContain(upper.segment.id)
  })

  test('roof and segment transforms locate other buildings covering the actual child', () => {
    const f = fixture()
    f.nodes[f.roof.id] = { ...f.roof, position: [10, 2, 20], rotation: Math.PI / 2 }
    f.segment = { ...f.segment, position: [1, 3, 2], rotation: Math.PI / 2 }
    f.nodes[f.segment.id] = f.segment
    expect(exposure(f).status).toBe('exposed')
    // Child local [0,3.8,3] becomes level [12,8.8,16] through the two quarter turns.
    // Independent building avoids inter-roof CSG changing the upper roof's known surface.
    const upper = addCover(f, 'upper', 8, false, true)
    f.nodes[upper.roof.id] = { ...upper.roof, position: [12, 8, 16] }
    const result = exposure(f)
    expect(result.status).toBe('buried')
    if (result.status === 'unmeasured') throw new Error(result.reason)
    result.position.forEach((value, i) => {
      expect(value).toBeCloseTo([0, 3.8, 3][i]!, 9)
    })
    // Upper covering level Y10.3 minus the host's Y5 origin is local Y5.3.
    expect(result.coveringY).toBeCloseTo(5.3, 9)
    expect(result.clearanceM).toBeCloseTo(-1.5, 9)
  })

  test('an unresolved outside-host covering is unknown, but a known blocker certifies burial', () => {
    const f = fixture()
    const proud = { ...f.dormer, position: [0, 8, 3.5] as [number, number, number] }
    const window = { ...f.window, position: [0, 0, 0] as [number, number, number] }
    addCover(f, 'unknown', 11, true)
    const unknown = exposure(f, proud, window)
    expect(unknown).toMatchObject({ status: 'unmeasured', reason: 'accessory-cut' })
    expect(unknown.nodeIds).toContain('skylight_unknown')
    addCover(f, 'blocker', 8, false, true)
    expect(exposure(f, proud, window).status).toBe('buried')
  })

  for (const [maximumCoveringY, expected] of [
    [7.98, 'exposed'],
    [7.99, 'unmeasured'],
    [8.1, 'unmeasured'],
  ] as const) {
    test(`an unresolved cut with complete native covering upper bound ${maximumCoveringY} is ${expected}`, () => {
      const f = fixture()
      const proud = { ...f.dormer, position: [0, 8, 3.5] as [number, number, number] }
      const window = { ...f.window, position: [0, 0, 0] as [number, number, number] }
      // Actual centre is Y8, outside its own host at Z4.5. Independent flat
      // covering has global maximum roofY + wall2 + deck.25 + shingle.05.
      // Its unknown skylight cut can only remove geometry, never raise that bound.
      addCover(f, 'bounded', maximumCoveringY - 2.3, true, true)
      const result = exposure(f, proud, window)
      expect(result.status).toBe(expected)
      if (result.status === 'unmeasured') {
        // Equal to the strict 1cm clearance boundary is NOT a safe bound;
        // higher unknown covering must not be silently discarded either.
        expect(result.reason).toBe('accessory-cut')
        expect(result.nodeIds).toContain('skylight_bounded')
      }
    })
  }

  test('invalid host or window ownership never certifies exposure', () => {
    const f = fixture()
    expect(exposure(f, f.dormer, { ...f.window, dormerId: 'dormer_foreign' }).status).toBe(
      'unmeasured',
    )
    expect(exposure(f, f.dormer, { ...f.window, parentId: 'dormer_foreign' }).status).toBe(
      'unmeasured',
    )
    delete f.nodes[f.roof.id]
    expect(exposure(f).status).toBe('unmeasured')
    expect(getDormerExposedFaces(f.dormer, f.segment, { nodes: f.nodes })).toEqual({
      front: false,
      back: false,
    })
  })

  test('legacy nominal 35° face visibility is not finished-covering certification', () => {
    const f = fixture()
    const pitch = (35 * Math.PI) / 180
    const seatY = 2 + 2 * Math.tan(pitch)
    f.segment = RoofSegmentNode.parse({
      ...f.segment,
      pitch: 35,
      deckThickness: 0.1,
      shingleThickness: 0.05,
    })
    f.dormer = DormerNode.parse({
      id: f.dormer.id,
      parentId: f.segment.id,
      roofSegmentId: f.segment.id,
      position: [0, seatY, 2],
      children: [f.window.id],
    })
    f.window = WindowNode.parse({
      id: f.window.id,
      parentId: f.dormer.id,
      dormerId: f.dormer.id,
      dormerFace: 'front',
      position: [0.02, -0.375, 0],
      width: 0.76,
      height: 0.68,
    })
    Object.assign(f.nodes, {
      [f.segment.id]: f.segment,
      [f.dormer.id]: f.dormer,
      [f.window.id]: f.window,
    })
    // Native front is .775m downhill. It clears bare shell but not the .15m
    // normal-thickness covering: .775*tan(35°)-.375-.15/cos(35°) < 0.
    expect(getDormerExposedFaces(f.dormer, f.segment)).toEqual({ front: true, back: false })
    expect(getDormerExposedFaces(f.dormer, f.segment, { nodes: f.nodes }).front).toBe(false)
    const result = exposure(f)
    expect(result.status).toBe('buried')
    if (result.status === 'unmeasured') throw new Error(result.reason)
    expect(result.position[1]).toBeCloseTo(seatY - 0.375, 9)
    expect(result.coveringY).toBeCloseTo(2 + 1.225 * Math.tan(pitch) + 0.15 / Math.cos(pitch), 9)
    expect(result.clearanceM).toBeCloseTo(
      0.775 * Math.tan(pitch) - 0.375 - 0.15 / Math.cos(pitch),
      9,
    )
    expect(getDormerWindowExposure(f.dormer, f.window, f.segment).status).toBe('buried')
  })

  test('legacy host-local calls retain deterministic face fallback without false certification', () => {
    const f = fixture()
    expect(getDormerExposedFaces(f.dormer, f.segment)).toEqual({ front: true, back: false })
    expect(getDormerDefaultWindowFace(f.dormer, f.segment)).toBe('front')
    const reversed = { ...f.dormer, rotation: Math.PI }
    expect(getDormerExposedFaces(reversed, f.segment)).toEqual({ front: false, back: true })
    expect(getDormerDefaultWindowFace(reversed, f.segment)).toBe('back')
    const buried = { ...f.dormer, position: [0, 0, 2] as [number, number, number] }
    expect(getDormerExposedFaces(buried, f.segment)).toEqual({ front: false, back: false })
    expect(getDormerDefaultWindowFace(buried, f.segment)).toBe('front')
    expect(getDormerDefaultWindowFace(f.dormer)).toBe('front')
  })
})
