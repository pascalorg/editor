import { describe, expect, test } from 'bun:test'
import { CONDENSER_PAD_THICKNESS, CONDENSER_UNIT_DIMS } from '../engines/hvac'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'
import { servicePresentation } from './placement'
import { HP_PROXY_INFLATE, resolveHeatPumpProxy } from './proxy'
import { ServiceNode } from './schema'

/**
 * HEAT-PUMP PICK PROXY (Julien 2026-08-23: hover/select/move the unit
 * itself, kitchen-island style) — geometry + composition gates. The
 * mode/toggle gate is the suppression matrix (place.test.ts pickProxy
 * column); THESE gates prove the resolved proxy really covers the engine's
 * rendered unit:
 *  - footprint: the engine cabinet dims × a small inflate (≥ the unit,
 *    hugging it), unit-center height = pad top + cabinet h/2;
 *  - yaw parity: the engine's unit-#1 bearing, read from the SAME memoized
 *    computeLevel the framing renderer draws from;
 *  - A4 parity: unit #1 sits at the service node verbatim, so the proxy
 *    (mounted in the node's group) stands exactly on the rendered unit;
 *  - engine silence: no unit #1 composed ⇒ NO proxy (no phantom hover
 *    volume; the sign plate stays the only handle — the stated trade).
 */

// Node-level scene (host shapes): 10×8 exterior shell, garage divider,
// garage + bathroom zones — enough for the hvac engine to serve rooms and
// compose the outdoor unit.
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
  const zone = (id: string, name: string, polygon: [number, number][]) => ({
    id,
    type: 'zone',
    parentId: 'level_1',
    name,
    polygon,
    boundaryWallIds: [],
  })
  return {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [10, 0]),
    w_e: wall('w_e', [10, 0], [10, 8]),
    w_n: wall('w_n', [10, 8], [0, 8]),
    w_w: wall('w_w', [0, 8], [0, 0]),
    w_mid: wall('w_mid', [5, 0], [5, 8], { frontSide: 'interior', backSide: 'interior' }),
    z_garage: zone('z_garage', 'Garage', [[0, 0], [5, 0], [5, 8], [0, 8]]),
    z_bath: zone('z_bath', 'Bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
  }
}

function framing(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return FramingNode.parse({
    id: 'bonesframing_1',
    parentId: 'level_1',
    viewMode: 'xray',
    ...extra,
  }) as unknown as Record<string, unknown>
}

/** Scene + framing node + a heat-pump service node at `at` (plan). */
function xrayScene(at: readonly [number, number] | null) {
  const nodes = scene()
  nodes.bonesframing_1 = framing()
  let hp: ServiceNode | null = null
  if (at) {
    hp = ServiceNode.parse({ serviceType: 'heat-pump', position: [at[0], 0, at[1]] })
    nodes[hp.id] = { ...hp, parentId: 'level_1' } as unknown as Record<string, unknown>
  }
  return { nodes, hp }
}

describe('resolveHeatPumpProxy — the unit-footprint pick volume', () => {
  test('resolves the engine cabinet footprint at the unit center height, yaw = unit #1', () => {
    const { nodes, hp } = xrayScene([5, -1.2])
    const node = { serviceType: 'heat-pump' as const, parentId: 'level_1' }
    // the matrix says proxy; the resolver supplies geometry
    expect(servicePresentation(nodes, node).pickProxy).toBe(true)
    const proxy = resolveHeatPumpProxy(nodes, node)
    expect(proxy).not.toBeNull()
    // footprint = engine truth × inflate — covers the unit, hugs it
    expect(proxy?.dims[0]).toBeCloseTo(CONDENSER_UNIT_DIMS[0] * HP_PROXY_INFLATE, 9)
    expect(proxy?.dims[1]).toBeCloseTo(CONDENSER_UNIT_DIMS[1] * HP_PROXY_INFLATE, 9)
    expect(proxy?.dims[2]).toBeCloseTo(CONDENSER_UNIT_DIMS[2] * HP_PROXY_INFLATE, 9)
    expect(HP_PROXY_INFLATE).toBeGreaterThan(1)
    expect(HP_PROXY_INFLATE).toBeLessThan(1.1)
    // unit-center height: pad top + half the cabinet
    expect(proxy?.centerY).toBeCloseTo(
      CONDENSER_PAD_THICKNESS + CONDENSER_UNIT_DIMS[1] / 2,
      9,
    )
    // yaw + position parity vs the ENGINE's own compose (memo-shared with
    // the framing renderer): unit #1 verbatim at the node (A4), bearing out
    const result = computeLevel(nodes, nodes.bonesframing_1 as never)
    const unit1 = result.fixtures.find(
      (f) => f.meta?.equipment === 'condenser' && f.meta?.unit === 1,
    )
    expect(unit1).toBeDefined()
    expect(proxy?.rotationY).toBe(unit1?.rotationY as number)
    expect(unit1?.position[0]).toBeCloseTo(hp ? 5 : Number.NaN, 6)
    expect(unit1?.position[2]).toBeCloseTo(hp ? -1.2 : Number.NaN, 6)
    expect(unit1?.position[1]).toBeCloseTo(proxy?.centerY as number, 9)
  })

  test('engine silence (no served rooms ⇒ no unit) resolves NO proxy — no phantom hover volume', () => {
    const { nodes } = xrayScene([5, -1.2])
    delete nodes.z_garage
    delete nodes.z_bath
    const node = { serviceType: 'heat-pump' as const, parentId: 'level_1' }
    // the compose really is silent (non-vacuous)
    const result = computeLevel(nodes, nodes.bonesframing_1 as never)
    expect(result.fixtures.some((f) => f.meta?.equipment === 'condenser')).toBe(false)
    expect(resolveHeatPumpProxy(nodes, node)).toBeNull()
  })

  test('non-heat-pump kinds and framing-less levels resolve null', () => {
    const { nodes } = xrayScene([5, -1.2])
    expect(
      resolveHeatPumpProxy(nodes, { serviceType: 'water-heater', parentId: 'level_1' }),
    ).toBeNull()
    const bare = scene() // no bones:framing node
    expect(
      resolveHeatPumpProxy(bare, { serviceType: 'heat-pump', parentId: 'level_1' }),
    ).toBeNull()
  })

  test('renderer composition: hvac OFF mounts nothing (matrix gate), hvac ON mounts the proxy', () => {
    // The renderer mounts iff presentation.pickProxy && resolve(...) — pin
    // the conjunction on both arms so neither gate can rot alone.
    const on = xrayScene([5, -1.2]).nodes
    const node = { serviceType: 'heat-pump' as const, parentId: 'level_1' }
    expect(servicePresentation(on, node).pickProxy && resolveHeatPumpProxy(on, node) !== null).toBe(
      true,
    )
    const off = xrayScene([5, -1.2]).nodes
    off.bonesframing_1 = framing({ showHvac: false })
    // hvac off: the placeholder body returns as the visible pick handle —
    // the matrix says no proxy even though a resolver call would find no
    // fixture anyway (compose without hvac emits no condenser)
    expect(servicePresentation(off, node).pickProxy).toBe(false)
  })
})
