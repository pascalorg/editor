import { describe, expect, test } from 'bun:test'
import { ServicePointNode, UtilityLineNode, UtilityPoleNode } from '../schema'
import { bindPatch, freeEnds, planAttach } from '../utility-line/attach'
import { resolveLineEndpoints } from '../utility-line/endpoints'

const wall = {
  id: 'wall_e',
  type: 'wall',
  parentId: 'level_1',
  start: [4, -7],
  end: [4, 7],
  thickness: 0.18,
  height: 2.74,
}
const building = { id: 'bldg_1', type: 'building', position: [5, 0, 16], rotation: [0, 0, 0] }
const level = { id: 'level_1', type: 'level', parentId: 'bldg_1' }

function scene() {
  const pole = UtilityPoleNode.parse({
    id: 'utilpl_a',
    parentId: 'bldg_1',
    position: [18, 0, -0.6],
    height: 10.7,
  })
  const meter = ServicePointNode.parse({
    id: 'utilsp_m',
    parentId: 'bldg_1',
    serviceKind: 'electric-meter',
    wallId: 'wall_e',
    wallT: 0.33,
    height: 1.5,
  })
  // Drawn before the meter rule: ends on a stored vertex in the yard, 3 m
  // from where the meter actually is.
  const line = UtilityLineNode.parse({
    id: 'utilln_1',
    parentId: 'bldg_1',
    system: 'power',
    routing: 'overhead',
    fromRef: 'utilpl_a',
    toRef: null,
    path: [
      [18, 0, -0.6],
      [12, 0, 6],
      [11.5, 0, 14.5],
    ],
  })
  const nodes = {
    bldg_1: building,
    level_1: level,
    wall_e: wall,
    utilpl_a: pole,
    utilsp_m: meter,
    utilln_1: line,
  } as unknown as Record<string, Record<string, unknown>>
  return { nodes, line, meter, pole }
}

describe('attach a free end', () => {
  test('a power drop with a free end binds to the nearest electric meter', () => {
    const { nodes, line } = scene()
    expect(freeEnds(line)).toEqual(['to'])
    const plan = planAttach(nodes, line, 'to')
    expect(plan).not.toBeNull()
    expect(plan?.kind).toBe('service-point')
    expect(plan?.nodeId).toBe('utilsp_m')
    expect(plan?.distance).toBeLessThan(6)
    // The patch drops the dangling vertex and binds the ref.
    expect(plan?.patch.toRef).toBe('utilsp_m')
    expect(plan?.patch.path?.length).toBe(2)
  })

  test('after the patch the run ends exactly on the meter', () => {
    const { nodes, line } = scene()
    const plan = planAttach(nodes, line, 'to')!
    const patched = { ...line, ...plan.patch } as typeof line
    const resolved = resolveLineEndpoints(nodes, patched)
    expect(resolved.to?.kind).toBe('service-point')
    const end = resolved.path[resolved.path.length - 1]!
    // Meter on the east wall (local x 4 + t/2) at wallT 0.33 → local z −2.38,
    // in site metres through the building frame [5, 16].
    // The anchor sits on the wall FACE (plus the device's own stand-off).
    expect(Math.abs(end[0] - (5 + 4 + 0.09))).toBeLessThan(0.12)
    expect(Math.abs(end[2] - (16 + (-7 + 14 * 0.33)))).toBeLessThan(0.12)
  })

  test('nothing within the radius → null, and a two-vertex run keeps its shape', () => {
    const { nodes, line } = scene()
    const far = { ...line, path: [line.path[0]!, [80, 0, 80]] as typeof line.path }
    expect(planAttach(nodes, far, 'to')).toBeNull()
    const patch = bindPatch(far, 'to', 'utilsp_m')
    expect(patch.path?.length).toBe(2)
    expect(patch.toRef).toBe('utilsp_m')
  })

  test('a water line ignores poles and electric meters', () => {
    const { nodes, line } = scene()
    const water = { ...line, system: 'water' as const, routing: 'underground' as const }
    expect(planAttach(nodes, water, 'to')).toBeNull()
  })
})
