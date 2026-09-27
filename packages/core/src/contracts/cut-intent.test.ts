/**
 * F5b cut intents, executable examples (plan item DT-03a,
 * `editor-fidelity-foundations.md` §2.2).
 *
 * One example per cut family: a through opening, a depth pocket that keeps
 * its backing, a ceiling hole and a roof accessory. Each maps what today's
 * cut source produces onto the intent; DT-03b (walls, ceilings, slabs) and
 * RL-02 (roofs) must reproduce these numbers when they consume intents.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Capabilities, CuttableConfig } from '../registry'
import { CutIntent } from '../schema/cut'
import type { AnyNode, AnyNodeId, FidelityV3 } from '../schema/types'

const close = (actual: number, expected: number, digits = 6) =>
  expect(actual).toBeCloseTo(expected, digits)

type V2 = [number, number]
type V3 = [number, number, number]
// `+ 0` folds −0 into 0 so exact axis vectors compare equal.
const cross = (a: FidelityV3, b: FidelityV3): V3 => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
]
const closeRing = (ring: V2[]) =>
  ring.map(([u, v]) => [expect.closeTo(u, 12), expect.closeTo(v, 12)]) as unknown as V2[]
const rect = (cu: number, cv: number, w: number, h: number): V2[] => [
  [cu - w / 2, cv - h / 2],
  [cu + w / 2, cv - h / 2],
  [cu + w / 2, cv + h / 2],
  [cu - w / 2, cv + h / 2],
]

/** Wall face charts: `front` is wall-local (x, y); `back` runs from `end`, u = length − x. */
const toChart = (side: 'front' | 'back', length: number, [x, y]: V2): V2 =>
  side === 'front' ? [x, y] : [length - x, y]

/** The wall-local z range an intent removes; the front face is +thickness/2 (+n). */
function removedDepth(intent: CutIntent, thickness: number): [number, number] {
  const half = thickness / 2
  if (intent.depth === 'through') return [-half, half]
  return intent.host.surfaceId === 'front'
    ? [half - intent.depth, half]
    : [-half, -half + intent.depth]
}

/** What a pocket leaves of the wall behind it; a through cut leaves nothing to keep. */
const backingOf = (intent: CutIntent, thickness: number) =>
  intent.depth === 'through' ? null : thickness - intent.depth

/** DT-03b's backing rule (the source's "recess must retain wall backing"). */
const MIN_BACKING = 0.005
const keepsBacking = (intent: CutIntent, thickness: number) =>
  (backingOf(intent, thickness) ?? MIN_BACKING) >= MIN_BACKING - 1e-12

describe('through: a window cuts the whole wall, from either face', () => {
  // Today: `createOpeningCutoutBrush` extrudes the opening outline in
  // wall-local (x, y) through 2 × thickness, centred on the wall.
  const wall = { length: 4, thickness: 0.2 }
  const window = { width: 1.2, height: 1.0, position: [2, 1.4, 0] as V3 }
  const outline = rect(window.position[0], window.position[1], window.width, window.height)

  test('the front-face intent is the opening outline in wall-local metres', () => {
    const intent = CutIntent.parse({
      host: { nodeId: 'wall_a', surfaceId: 'front' },
      shape: { kind: 'polygon', ring: outline.map((p) => toChart('front', wall.length, p)) },
      depth: 'through',
    })
    expect(intent.shape).toEqual({
      kind: 'polygon',
      ring: closeRing([
        [1.4, 0.9],
        [2.6, 0.9],
        [2.6, 1.9],
        [1.4, 1.9],
      ]),
    })
    expect(removedDepth(intent, wall.thickness)).toEqual([-0.1, 0.1])
  })

  test('the back chart is right-handed with v up, so u runs from the end', () => {
    // Wall-local: +x along the wall, +y up, +z = +n (front normal).
    const back = { normal: [0, 0, -1] as V3, u: [-1, 0, 0] as V3 }
    expect(cross(back.normal, back.u)).toEqual([0, 1, 0])
    const intent = CutIntent.parse({
      host: { nodeId: 'wall_a', surfaceId: 'back' },
      shape: { kind: 'polygon', ring: outline.map((p) => toChart('back', wall.length, p)) },
      depth: 'through',
    })
    if (intent.shape.kind !== 'polygon') throw new Error('polygon expected')
    // Mapped back to wall-local x, it is the same opening.
    const xs = intent.shape.ring.map(([u]) => wall.length - u)
    close(Math.min(...xs), 1.4, 12)
    close(Math.max(...xs), 2.6, 12)
    expect(removedDepth(intent, wall.thickness)).toEqual([-0.1, 0.1])
  })

  test('taper: a splayed reveal narrows with depth', () => {
    const taper = (15 * Math.PI) / 180
    const intent = CutIntent.parse({
      host: { nodeId: 'wall_a', surfaceId: 'front' },
      shape: { kind: 'polygon', ring: outline },
      depth: 'through',
      taper,
    })
    // Each edge moves inward by depth · tan(taper): at the back face (0.2 m).
    const inset = wall.thickness * Math.tan(intent.taper!)
    close(inset, 0.05359)
    close(window.width - 2 * inset, 1.09282)
  })
})

describe('depth pocket: a niche keeps the backing', () => {
  const thickness = 0.2
  const niche = (depth: number, surfaceId: 'front' | 'back' = 'front') =>
    CutIntent.parse({
      host: { nodeId: 'wall_a', surfaceId },
      shape: { kind: 'polygon', ring: rect(1, 1.2, 0.6, 0.9) },
      depth,
    })

  test('depth runs along −normal from the named face', () => {
    const front = removedDepth(niche(0.12), thickness)
    close(front[0], -0.02)
    close(front[1], 0.1)
    const back = removedDepth(niche(0.05, 'back'), thickness)
    close(back[0], -0.1)
    close(back[1], -0.05)
  })

  test('what is left behind is the backing; a pocket must leave 5 mm', () => {
    close(backingOf(niche(0.12), thickness)!, 0.08)
    expect(keepsBacking(niche(0.12), thickness)).toBe(true)
    expect(keepsBacking(niche(0.195), thickness)).toBe(true)
    expect(keepsBacking(niche(0.198), thickness)).toBe(false)
  })
})

describe('ceiling hole: ceilingCut rings are underside rings as they are', () => {
  test('the underside chart is ceiling-local [x, z]; the slab top chart is [x, −z]', () => {
    expect(cross([0, -1, 0], [1, 0, 0])).toEqual([0, 0, 1])
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
  })

  test('a recessed downlight: buildCeilingHole → one underside intent', () => {
    // `item` ceilingCut: the inset (0.82) footprint rotated by yaw about Y.
    const [w, d, yaw, cx, cz] = [0.2, 0.2, Math.PI / 6, 2, 3]
    const half: V2 = [(w / 2) * 0.82, (d / 2) * 0.82]
    const hole = rect(0, 0, 2 * half[0], 2 * half[1]).map(
      ([dx, dz]): V2 => [
        cx + dx * Math.cos(yaw) + dz * Math.sin(yaw),
        cz - dx * Math.sin(yaw) + dz * Math.cos(yaw),
      ],
    )
    const intent = CutIntent.parse({
      host: { nodeId: 'ceiling_a', surfaceId: 'underside' },
      shape: { kind: 'polygon', ring: hole },
      depth: 'through',
    })
    expect(intent.shape).toEqual({ kind: 'polygon', ring: hole })
    // A round fixture can say what it is instead.
    const round = CutIntent.parse({
      host: { nodeId: 'ceiling_a', surfaceId: 'underside' },
      shape: { kind: 'circle', center: [cx, cz], radius: half[0] },
      depth: 'through',
    })
    expect(round.shape).toEqual({ kind: 'circle', center: [2, 3], radius: 0.082 })
  })
})

describe('roof accessory: a skylight cuts its facet, in slope metres', () => {
  const pitch = (40 * Math.PI) / 180
  // Today: `buildSkylightRoofCut` sizes a box to the frame plus the cutout
  // offset and orients it to the outer surface frame at the skylight.
  const skylight = { width: 0.6, height: 1.0, frameThickness: 0.05, cutoutOffset: 0.01 }
  const w = skylight.width + 2 * skylight.frameThickness + 2 * skylight.cutoutOffset
  const d = skylight.height + 2 * skylight.frameThickness + 2 * skylight.cutoutOffset
  const intent = CutIntent.parse({
    host: { nodeId: 'rseg_a', surfaceId: 'facet:f0:covering' },
    shape: { kind: 'polygon', ring: rect(1.5, 2, w, d) },
    depth: 'through',
  })

  test('the facet chart: u along the eave, v up the slope, the normal outward', () => {
    const u: V3 = [1, 0, 0]
    const upSlope: V3 = [0, Math.sin(pitch), -Math.cos(pitch)]
    const normal = cross(u, upSlope)
    close(normal[1], Math.cos(pitch))
    const v = cross(normal, u)
    for (let i = 0; i < 3; i++) close(v[i]!, upSlope[i]!)
  })

  test('the cut is the framed opening; its plan footprint shrinks by cos(pitch)', () => {
    close(w, 0.72)
    close(d, 1.12)
    if (intent.shape.kind !== 'polygon') throw new Error('polygon expected')
    const vs = intent.shape.ring.map(([, v]) => v)
    const slopeRun = Math.max(...vs) - Math.min(...vs)
    close(w * slopeRun * Math.cos(pitch), 0.617738)
  })
})

describe('publishers declare capabilities.cuts', () => {
  test('a plugin kind cuts its wall host from the scene it is given', () => {
    const capabilities: Capabilities = {
      cuts: (node, { nodes }) => {
        const host = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
        if (host?.type !== 'wall') return []
        return [
          {
            host: { nodeId: host.id, surfaceId: 'front' },
            shape: { kind: 'circle', center: [1, 1.5], radius: 0.1 },
            depth: 0.05,
          },
        ]
      },
    }
    const wall = { id: 'wall_a', type: 'wall', parentId: null } as unknown as AnyNode
    const vent = {
      id: 'plugin_vent',
      type: 'plugin:vent',
      parentId: 'wall_a',
    } as unknown as AnyNode
    const nodes = { wall_a: wall } as Record<AnyNodeId, AnyNode>
    const intents = capabilities.cuts!(vent, { nodes })
    expect(intents.map((intent) => CutIntent.safeParse(intent).success)).toEqual([true])
    expect(capabilities.cuts!({ ...vent, parentId: null } as AnyNode, { nodes })).toEqual([])
  })

  test('the deprecated cuttable alias still type-checks (plugin API v1) and nothing reads it', () => {
    const config: CuttableConfig = { hostKinds: ['wall'] }
    const legacy: Capabilities = { cuttable: config }
    expect(legacy.cuttable?.hostKinds).toEqual(['wall'])

    const packages = path.resolve(import.meta.dir, '../../..')
    const readers: string[] = []
    for (const pkg of readdirSync(packages)) {
      const src = path.join(packages, pkg, 'src')
      if (!existsSync(src)) continue
      for (const file of readdirSync(src, { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue
        if (pkg === 'core' && file === path.join('registry', 'types.ts')) continue
        if (/\bcuttable\b/.test(readFileSync(path.join(src, file), 'utf8'))) {
          readers.push(`${pkg}/src/${file}`)
        }
      }
    }
    expect(readers).toEqual([])
  })
})

describe('the schema refuses malformed intents', () => {
  const valid = {
    host: { nodeId: 'wall_a', surfaceId: 'front' },
    shape: { kind: 'polygon', ring: rect(1, 1, 0.5, 0.5) },
    depth: 'through',
  }
  const issues = (patch: Record<string, unknown>) =>
    CutIntent.safeParse({ ...valid, ...patch }).error?.issues.map((i) => i.path.join('.')) ?? []

  test('shapes, depths, tapers and part keys', () => {
    expect(issues({})).toEqual([])
    expect(
      issues({
        shape: {
          kind: 'polygon',
          ring: [
            [0, 0],
            [1, 0],
          ],
        },
      }),
    ).toEqual(['shape.ring'])
    expect(issues({ shape: { kind: 'circle', center: [0, 0], radius: 0 } })).toEqual([
      'shape.radius',
    ])
    expect(issues({ depth: 0 })).toEqual(['depth'])
    expect(issues({ depth: 'partial' })).toEqual(['depth'])
    expect(issues({ taper: Math.PI / 2 })).toEqual(['taper'])
    expect(issues({ host: { nodeId: '', surfaceId: 'front' } })).toEqual(['host.nodeId'])
    expect(issues({ host: { nodeId: 'wall_a', surfaceId: 'front', partKey: 'g1/stud' } })).toEqual([
      'host.partKey',
    ])
    expect(
      issues({ host: { nodeId: 'wall_a', surfaceId: 'front', partKey: 'g1/stud/s4' } }),
    ).toEqual([])
  })
})
