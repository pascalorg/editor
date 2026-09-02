import { describe, expect, test } from 'bun:test'
import { extractRooms, extractSlabs, extractWalls } from '../core/wall-model'
import { probeSlabsFor } from '../framing/compute'
import { placeElectricMeterSpot, placePanelSpot } from '../engines/electrical'
import { placeCondenserSeedSpot, placeThermostatSpot } from '../engines/hvac'
import { placeMeterSpot, placeWhSpot } from '../engines/plumbing'
import { buildServicePointNodes, placedServiceTypes, planServiceSeeding } from './place'
import {
  ENGINE_RENDERED_SERVICE_TYPES,
  levelViewMode,
  PHYSICAL_SERVICE_TYPES,
  servicePresentation,
} from './placement'
import { ServiceNode } from './schema'

/**
 * The "Place service points" action: creates all EIGHT service nodes at the
 * ENGINES' auto positions, idempotently (types already present are skipped).
 */

// Synthetic scene: one level, four exterior walls + a garage divider, a
// garage zone (panel/WH rule) and a bathroom (sewer/stack rule).
function scene(): Record<string, Record<string, unknown>> {
  const wall = (id: string, start: [number, number], end: [number, number], extra = {}) => ({
    id,
    type: 'wall',
    parentId: 'level_1',
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    frontSide: 'exterior',
    children: [],
    ...extra,
  })
  const zone = (id: string, name: string, polygon: [number, number][], boundaryWallIds: string[]) => ({
    id,
    type: 'zone',
    parentId: 'level_1',
    name,
    polygon,
    boundaryWallIds,
  })
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [10, 0]),
    w_e: wall('w_e', [10, 0], [10, 8]),
    w_n: wall('w_n', [10, 8], [0, 8]),
    w_w: wall('w_w', [0, 8], [0, 0]),
    w_mid: wall('w_mid', [5, 0], [5, 8], { frontSide: 'interior', backSide: 'interior' }),
    z_garage: zone('z_garage', 'Garage', [[0, 0], [5, 0], [5, 8], [0, 8]], ['w_w', 'w_mid']),
    z_bath: zone('z_bath', 'Bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]], []),
  }
}

describe('buildServicePointNodes', () => {
  test('creates all eight service types at the engines’ auto spots', () => {
    const nodes = scene()
    const created = buildServicePointNodes(nodes, 'level_1')
    expect(created.map((n) => n.serviceType).sort()).toEqual([
      'electric-meter',
      'heat-pump',
      'panel',
      'power-entry',
      'sewer-exit',
      'thermostat',
      'water-entry',
      'water-heater',
    ])
    // every node validates against the schema and parents cleanly
    for (const n of created) {
      expect(() => ServiceNode.parse(n)).not.toThrow()
      expect(n.type).toBe('bones:service')
    }

    const slabs = extractSlabs(nodes, 'level_1')
    const walls = extractWalls(nodes, 'level_1', slabs)
    const rooms = extractRooms(nodes, 'level_1')

    // panel node sits exactly at the electrical engine's auto spot
    const panelSpot = placePanelSpot(walls, rooms)
    const panelNode = created.find((n) => n.serviceType === 'panel')
    expect(panelNode?.wallId).toBe(panelSpot?.wall.id ?? '')
    expect(panelNode?.wallT).toBeCloseTo((panelSpot?.u ?? 0) / (panelSpot?.wall.length ?? 1), 6)
    expect(panelNode?.heightAff).toBeCloseTo(panelSpot?.heightAff ?? 0, 6)

    // water-heater and water-entry mirror the plumbing engine's spots
    const whSpot = placeWhSpot(walls, rooms)
    const whNode = created.find((n) => n.serviceType === 'water-heater')
    expect(whNode?.wallId).toBe(whSpot?.wall.id ?? '')
    expect(whNode?.heightAff).toBeCloseTo(whSpot?.heightAff ?? 0, 6)

    const meterSpot = placeMeterSpot(walls)
    const meterNode = created.find((n) => n.serviceType === 'water-entry')
    expect(meterNode?.wallId).toBe(meterSpot?.wall.id ?? '')

    // electric meter mirrors the electrical engine's exterior-face spot
    const eMeterSpot = placeElectricMeterSpot(walls, rooms)
    const eMeterNode = created.find((n) => n.serviceType === 'electric-meter')
    expect(eMeterSpot).not.toBeNull()
    expect(eMeterNode?.wallId).toBe(eMeterSpot?.wall.id ?? '')
    expect(eMeterNode?.wallT).toBeCloseTo(
      (eMeterSpot?.u ?? 0) / (eMeterSpot?.wall.length ?? 1),
      6,
    )
    expect(eMeterNode?.heightAff).toBeCloseTo(eMeterSpot?.heightAff ?? 0, 6)
    // the meter wall is part of the shell (exterior)
    expect(walls.find((w) => w.id === eMeterNode?.wallId)?.exterior).toBe(true)

    // thermostat mirrors the hvac engine's interior-wall 52" spot
    const tstatSpot = placeThermostatSpot(walls, rooms)
    const tstatNode = created.find((n) => n.serviceType === 'thermostat')
    expect(tstatSpot).not.toBeNull()
    expect(tstatNode?.wallId).toBe(tstatSpot?.wall.id ?? '')
    expect(tstatNode?.heightAff).toBeCloseTo(52 * 0.0254, 6)

    // sewer exit + heat pump are floor-placed: position only, no wall anchor
    const sewer = created.find((n) => n.serviceType === 'sewer-exit')
    expect(sewer?.wallId).toBeUndefined()
    expect(sewer?.position).not.toEqual([0, 0, 0])

    const hp = created.find((n) => n.serviceType === 'heat-pump')
    // the seed = the engine's composed unit-#1 anchor (RO slide + grid
    // snap, HP polish item 3) — placeCondenserSeedSpot, not the raw
    // pre-snap election point
    const hpSpot = placeCondenserSeedSpot(walls, rooms)
    expect(hp?.wallId).toBeUndefined()
    expect(hpSpot).not.toBeNull()
    expect(hp?.position[0]).toBeCloseTo(hpSpot?.[0] ?? 0, 6)
    expect(hp?.position[2]).toBeCloseTo(hpSpot?.[1] ?? 0, 6)
    // …and the pad stands OUTSIDE the 10×8 shell
    const [hx, , hz] = hp?.position ?? [0, 0, 0]
    expect(hx > 0 && hx < 10 && hz > 0 && hz < 8).toBe(false)
  })

  test('idempotent: existing types are skipped, missing ones fill in', () => {
    const nodes = scene()
    const first = buildServicePointNodes(nodes, 'level_1')
    expect(first).toHaveLength(8)
    // simulate the panel + sewer-exit already created on this level
    const panel = first.find((n) => n.serviceType === 'panel') as ServiceNode
    const sewer = first.find((n) => n.serviceType === 'sewer-exit') as ServiceNode
    nodes[panel.id] = { ...panel, parentId: 'level_1' } as unknown as Record<string, unknown>
    nodes[sewer.id] = { ...sewer, parentId: 'level_1' } as unknown as Record<string, unknown>

    const second = buildServicePointNodes(nodes, 'level_1')
    expect(second.map((n) => n.serviceType).sort()).toEqual([
      'electric-meter',
      'heat-pump',
      'power-entry',
      'thermostat',
      'water-entry',
      'water-heater',
    ])

    // all eight present → nothing to create
    for (const n of second) {
      nodes[n.id] = { ...n, parentId: 'level_1' } as unknown as Record<string, unknown>
    }
    expect(buildServicePointNodes(nodes, 'level_1')).toEqual([])
  })

  test('service nodes on ANOTHER level do not block this one', () => {
    const nodes = scene()
    nodes.level_2 = { id: 'level_2', type: 'level', level: 1, height: 2.5 }
    const other = ServiceNode.parse({ serviceType: 'panel', wallId: 'w_x', wallT: 0.5 })
    nodes[other.id] = { ...other, parentId: 'level_2' } as unknown as Record<string, unknown>
    const created = buildServicePointNodes(nodes, 'level_1')
    expect(created.some((n) => n.serviceType === 'panel')).toBe(true)
  })

  test('wall-less level: no wall-anchored nodes, no crash', () => {
    const nodes: Record<string, Record<string, unknown>> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    }
    expect(buildServicePointNodes(nodes, 'level_1')).toEqual([])
  })

  test('slab-less gable storey: seeded meter wall === engine auto meter wall (A4 probe parity)', () => {
    // Verify round 2026-08-16 (F3): buildServicePointNodes classified walls
    // with the level's OWN slabs (none up here) while compute uses the
    // widened storey-below probe — up here the attic blanket marked every
    // wall exterior, the LONGEST (the partition) won placeMeterSpot, and
    // creation alone moved the meter off the engine's auto spot. The seeding
    // now shares probeSlabsFor: the partition (both probe sides over the
    // storey-below slab) stays interior, the perimeter gable wall wins —
    // exactly the wall the engine routes to.
    const bare = (id: string, start: [number, number], end: [number, number]) => ({
      id,
      type: 'wall',
      parentId: 'lvl_g',
      start,
      end,
      thickness: 0.114,
      height: 2.5,
      children: [],
    })
    const nodes: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl_0', 'lvl_g'] },
      lvl_0: { id: 'lvl_0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
      lvl_g: { id: 'lvl_g', type: 'level', parentId: 'bldg', level: 1, height: 2.0 },
      slab0: {
        id: 'slab0',
        type: 'slab',
        parentId: 'lvl_0',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 6],
          [0, 6],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.1,
      },
      // perimeter gable wall on the slab edge — exterior under the widened probe
      w_perim: bare('w_perim', [0, 0], [6, 0]),
      // interior partition, LONGER than the perimeter wall — the pre-fix winner
      w_part: bare('w_part', [1, 3], [9, 3]),
    }
    const { probeSlabs, hasLowerStorey } = probeSlabsFor(nodes, 'lvl_g')
    const walls = extractWalls(nodes, 'lvl_g', probeSlabs, hasLowerStorey)
    const engineWall = placeMeterSpot(walls)?.wall.id
    expect(engineWall).toBe('w_perim') // the engines route to the exterior wall
    const created = buildServicePointNodes(nodes, 'lvl_g')
    const meter = created.find((n) => n.serviceType === 'water-entry')
    expect(meter?.wallId).toBe(engineWall as string)
  })
})

/**
 * GATE (panel badge/disable): the "Place service points" button counts
 * DISTINCT service types (visible nodes only) — five duplicate panels must
 * NOT read as "all placed" while four types are still missing.
 */
describe('placedServiceTypes', () => {
  const svc = (id: string, serviceType: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'bones:service',
    parentId: 'level_1',
    serviceType,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    ...extra,
  })

  test('duplicates of one type count ONCE', () => {
    const nodes: Record<string, Record<string, unknown>> = {
      a: svc('a', 'panel'),
      b: svc('b', 'panel'),
      c: svc('c', 'panel'),
      d: svc('d', 'panel'),
      e: svc('e', 'panel'),
      f: svc('f', 'water-heater'),
    }
    const types = placedServiceTypes(nodes, 'level_1')
    expect(types.size).toBe(2)
    expect([...types].sort()).toEqual(['panel', 'water-heater'])
    // …so the action still has six types to create
    const created = buildServicePointNodes({ ...scene(), ...nodes }, 'level_1')
    expect(created.map((n) => n.serviceType).sort()).toEqual([
      'electric-meter',
      'heat-pump',
      'power-entry',
      'sewer-exit',
      'thermostat',
      'water-entry',
    ])
  })

  test('hidden nodes and foreign levels/types do not count', () => {
    const nodes: Record<string, Record<string, unknown>> = {
      a: svc('a', 'panel', { visible: false }),
      b: svc('b', 'water-heater', { parentId: 'level_2' }),
      c: svc('c', 'flux-capacitor'),
      d: svc('d', 'sewer-exit'),
    }
    const types = placedServiceTypes(nodes, 'level_1')
    expect([...types]).toEqual(['sewer-exit'])
  })
})

/**
 * ONE-SHOT seeding planner (user round 2026-08-20: automatic service points,
 * no button) — the auto-heal contract the FramingRenderer's reconcile batch
 * applies to scenes whose X-ray predates automation. The `servicesSeeded`
 * latch is the no-resurrection guarantee.
 */
describe('planServiceSeeding', () => {
  const framing = (servicesSeeded?: boolean) => ({
    id: 'bonesframing_1',
    ...(servicesSeeded === undefined ? {} : { servicesSeeded }),
  })

  test('unseeded level with no service nodes: seeds every type + latches, same batch', () => {
    const plan = planServiceSeeding(scene(), 'level_1', framing())
    expect(plan.create.map((n) => n.serviceType).sort()).toEqual([
      'electric-meter',
      'heat-pump',
      'panel',
      'power-entry',
      'sewer-exit',
      'thermostat',
      'water-entry',
      'water-heater',
    ])
    expect(plan.update).toEqual([
      { id: 'bonesframing_1', data: { servicesSeeded: true } },
    ])
  })

  test('latched: NOTHING is created — a user-deleted service point stays deleted', () => {
    const nodes = scene()
    // seed once, apply, latch
    const first = planServiceSeeding(nodes, 'level_1', framing())
    for (const n of first.create) {
      nodes[n.id] = { ...n, parentId: 'level_1' } as unknown as Record<string, unknown>
    }
    // the user deliberately deletes the heat pump
    const hp = first.create.find((n) => n.serviceType === 'heat-pump')
    delete nodes[String(hp?.id)]
    const again = planServiceSeeding(nodes, 'level_1', framing(true))
    expect(again.create).toHaveLength(0)
    expect(again.update).toHaveLength(0)
    // …even if EVERY service node is gone, the latch holds
    const wiped = planServiceSeeding(scene(), 'level_1', framing(true))
    expect(wiped.create).toHaveLength(0)
    expect(wiped.update).toHaveLength(0)
  })

  test('unlatched level that already carries service nodes: ADOPT — latch only, no gap-filling', () => {
    const nodes = scene()
    const panel = ServiceNode.parse({ serviceType: 'panel', wallId: 'w_s', wallT: 0.4 })
    nodes[panel.id] = { ...panel, parentId: 'level_1' } as unknown as Record<string, unknown>
    const plan = planServiceSeeding(nodes, 'level_1', framing())
    expect(plan.create).toHaveLength(0) // a pre-automation arrangement is the user's
    expect(plan.update).toEqual([
      { id: 'bonesframing_1', data: { servicesSeeded: true } },
    ])
  })

  test('nothing placeable yet (wall-less level): no creates AND no latch — retries later', () => {
    const bare: Record<string, Record<string, unknown>> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    }
    const plan = planServiceSeeding(bare, 'level_1', framing())
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })
})

/**
 * Sign plates respect the view mode (skeptic advisory 2026-08-21: eight
 * hazard-yellow signs on a "finished" house, auto-seeded with no click).
 * The call, stated in placement.ts: 'off' hides ALL signs and keeps only
 * physical equipment bodies; conceptual markers (sewer exit, power entry)
 * step aside entirely; xray/basement — and levels without an X-ray node —
 * show box + sign as before.
 *
 * PICK-PROXY column (Julien 2026-08-23, overruling the day-10 trade that
 * left the sign as the suppressed heat-pump's only handle): pickProxy is
 * true for EXACTLY the xray+engine-suppressed HEAT PUMP — the one kind
 * whose engine-rendered unit stands free of its sign — and false
 * everywhere a visible body already picks (off/basement/toggle-off/
 * no-framing) and for the wall-mounted suppressed kinds (water-heater /
 * electric-meter: their sign plates hug the equipment — stated follow-up
 * candidates). Geometry gates live in proxy.test.ts.
 */
describe('servicePresentation — signs respect the view mode', () => {
  const withFraming = (extra: Record<string, unknown>) => ({
    ...scene(),
    bonesframing_1: {
      id: 'bonesframing_1',
      type: 'bones:framing',
      parentId: 'level_1',
      ...extra,
    },
  })
  const svc = (serviceType: string) => ({
    serviceType: serviceType as never,
    parentId: 'level_1',
  })
  const ALL_TYPES = [
    'panel',
    'water-heater',
    'water-entry',
    'sewer-exit',
    'power-entry',
    'thermostat',
    'heat-pump',
    'electric-meter',
  ] as const

  /** The three kinds whose physical counterpart the ENGINES render at the
   * same anchor (heat-pump A/B 2026-08-22) — X-ray drops the placeholder
   * body, the sign stays. */
  const ENGINE_KINDS = ['heat-pump', 'water-heater', 'electric-meter'] as const

  test('xray: engine-rendered kinds drop the body, KEEP the sign; all others box + sign', () => {
    const nodes = withFraming({ viewMode: 'xray' })
    for (const t of ALL_TYPES) {
      // pickProxy: the HEAT PUMP alone — its suppressed body is replaced by
      // the engine's free-standing unit; WH/meter signs hug their equipment.
      const expected = ENGINE_KINDS.includes(t as (typeof ENGINE_KINDS)[number])
        ? { body: false, sign: true, pickProxy: t === 'heat-pump' }
        : { body: true, sign: true, pickProxy: false }
      expect(servicePresentation(nodes, svc(t))).toEqual(expected)
    }
    // The suppression map is exactly the discovered engine-anchor set.
    expect(Object.keys(ENGINE_RENDERED_SERVICE_TYPES).sort()).toEqual([...ENGINE_KINDS].sort())
  })

  test('basement: box + sign for every type (unchanged — documented design)', () => {
    const nodes = withFraming({ viewMode: 'basement' })
    for (const t of ALL_TYPES) {
      expect(servicePresentation(nodes, svc(t))).toEqual({
        body: true,
        sign: true,
        pickProxy: false,
      })
    }
  })

  test('xray toggle arm: engine hidden (show* false) → the body RETURNS as the visual anchor', () => {
    const arms = [
      ['heat-pump', 'showHvac'],
      ['water-heater', 'showPlumbing'],
      ['electric-meter', 'showElectrical'],
    ] as const
    for (const [t, toggle] of arms) {
      const nodes = withFraming({ viewMode: 'xray', [toggle]: false })
      // body back = visible pick handle back → no proxy (hvac off must not
      // leave a phantom hover volume where no unit renders)
      expect(servicePresentation(nodes, svc(t))).toEqual({
        body: true,
        sign: true,
        pickProxy: false,
      })
      // The toggles are per-engine — flipping one never un-suppresses the others.
      for (const [other] of arms) {
        if (other === t) continue
        expect(servicePresentation(nodes, svc(other))).toEqual({
          body: false,
          sign: true,
          pickProxy: other === 'heat-pump',
        })
      }
    }
    // Absent toggle field = schema default TRUE (legacy nodes never
    // re-parse) → suppression active; explicit true matches.
    const explicit = withFraming({ viewMode: 'xray', showHvac: true })
    expect(servicePresentation(explicit, svc('heat-pump'))).toEqual({
      body: false,
      sign: true,
      pickProxy: true,
    })
  })

  test("'off': all signs hide; only PHYSICAL equipment keeps its body", () => {
    const nodes = withFraming({ viewMode: 'off' })
    for (const t of ALL_TYPES) {
      const p = servicePresentation(nodes, svc(t))
      expect(p.sign).toBe(false)
      expect(p.body).toBe(PHYSICAL_SERVICE_TYPES.has(t))
      expect(p.pickProxy).toBe(false) // finished house: the real body picks
    }
    // the conceptual markers step aside entirely
    expect(servicePresentation(nodes, svc('sewer-exit')).body).toBe(false)
    expect(servicePresentation(nodes, svc('power-entry')).body).toBe(false)
    // the physically-visible equipment stays
    expect(servicePresentation(nodes, svc('panel')).body).toBe(true)
    expect(servicePresentation(nodes, svc('heat-pump')).body).toBe(true)
  })

  test('legacy framing node (seeThrough false, no viewMode) reads as off', () => {
    const nodes = withFraming({ seeThrough: false })
    expect(servicePresentation(nodes, svc('panel'))).toEqual({
      body: true,
      sign: false,
      pickProxy: false,
    })
    expect(servicePresentation(nodes, svc('sewer-exit'))).toEqual({
      body: false,
      sign: false,
      pickProxy: false,
    })
    expect(levelViewMode(nodes, 'level_1')).toBe('off')
  })

  test('no framing node on the level → pre-automation presentation (box + sign)', () => {
    expect(levelViewMode(scene(), 'level_1')).toBeNull()
    expect(servicePresentation(scene(), svc('sewer-exit'))).toEqual({
      body: true,
      sign: true,
      pickProxy: false,
    })
    // No framing node ⇒ no engines render on this level ⇒ the engine-anchor
    // kinds keep their body too (nothing else would draw the equipment),
    // and the visible body is the pick handle — no proxy.
    expect(servicePresentation(scene(), svc('heat-pump'))).toEqual({
      body: true,
      sign: true,
      pickProxy: false,
    })
  })

  test('a FOREIGN level’s framing node never gates this level', () => {
    const nodes = {
      ...scene(),
      bonesframing_2: {
        id: 'bonesframing_2',
        type: 'bones:framing',
        parentId: 'level_2',
        viewMode: 'off',
      },
    }
    expect(servicePresentation(nodes, svc('sewer-exit'))).toEqual({
      body: true,
      sign: true,
      pickProxy: false,
    })
  })
})

describe('heat-pump seed election validation (Julien scene, 2026-08-22)', () => {
  test('a false-exterior partition never seeds the pad indoors — coverage rides the seed', () => {
    // Node twin of the misclassified exhibit: the host declared interior
    // partitions exterior=true (its floor-coverage gaps); the seed action
    // must elect like the engine — probeSlabs threaded — or creation alone
    // would park the heat-pump node in the Bathroom (A4 parity break).
    const wall = (
      id: string,
      start: [number, number],
      end: [number, number],
      face: 'exterior' | 'interior',
    ) => ({
      id,
      type: 'wall',
      parentId: 'level_1',
      start,
      end,
      thickness: 0.2,
      height: 2.5,
      frontSide: face,
      backSide: 'interior',
      children: [],
    })
    const zone = (id: string, name: string, polygon: [number, number][]) => ({
      id,
      type: 'zone',
      parentId: 'level_1',
      name,
      polygon,
      boundaryWallIds: [],
    })
    const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]
    const nodes: Record<string, Record<string, unknown>> = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
      w_south: wall('w_south', [0, 0], [10, 0], 'exterior'),
      w_east: wall('w_east', [10, 0], [10, 8], 'exterior'),
      w_north: wall('w_north', [10, 8], [0, 8], 'exterior'),
      w_west: wall('w_west', [0, 8], [0, 0], 'exterior'),
      // FALSE exteriors nearest the laundry equipment room
      w_bathLaundry: wall('w_bathLaundry', [4, 2.5], [4, 4.5], 'exterior'),
      w_voidNorth: wall('w_voidNorth', [4, 2.5], [6, 2.5], 'exterior'),
      z_bath: zone('z_bath', 'Bathroom', rect(1, 2.5, 4, 4.5)),
      z_laundry: zone('z_laundry', 'Laundry', rect(4, 2.5, 6, 4.5)),
      z_bed: zone('z_bed', 'Bedroom', rect(1, 4.5, 9, 7)),
      z_living: zone('z_living', 'Living', rect(6, 0.5, 9, 4.5)),
      slab0: {
        id: 'slab0',
        type: 'slab',
        parentId: 'level_1',
        polygon: rect(0, 0, 10, 8),
        holes: [],
      },
    }
    const created = buildServicePointNodes(nodes, 'level_1')
    const hp = created.find((n) => n.serviceType === 'heat-pump')
    expect(hp).toBeDefined()
    // the honest spot: condenserStandoff (t/2 + 24" face clearance +
    // cabinet depth/2 = 1.1846) SOUTH of the true south wall, grid-snapped
    // outward to the 0.5 host step (HP polish) — outside the Bathroom
    // (pre-fix class: inside it) and outside the covered void
    // (coverage-blind: 5, 1.3154)
    expect(hp?.position?.[0]).toBeCloseTo(5, 6)
    expect(hp?.position?.[2]).toBeCloseTo(-1.5, 6)
  })
})
