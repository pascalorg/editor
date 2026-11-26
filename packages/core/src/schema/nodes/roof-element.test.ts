import { describe, expect, test } from 'bun:test'
import {
  buildRoofElementNode,
  ROOF_ELEMENT_KINDS,
  type RoofElementKind,
  type RoofElementOptions,
  RoofSegmentNode,
} from '../../index'

// Native schema/definition contracts observed before the builder exists. These
// literal facts discriminate shared manual/builder regressions, unlike parity alone.
const cases = [
  ['chimney', 'Chimney', { width: 0.6, depth: 0.6, heightAboveRidge: 1, bodyShape: 'square' }],
  ['skylight', 'Skylight', { width: 0.9, height: 1.2, skylightType: 'flat', curb: true }],
  ['solar-panel', 'Solar Panel', { rows: 2, columns: 3, panelWidth: 1, panelHeight: 1.65 }],
  ['cupola', 'Cupola', { width: 0.8, depth: 0.8, height: 1, roofStyle: 'dome' }],
  ['box-vent', 'Box Vent', { width: 0.4, depth: 0.4, height: 0.15, style: 'cap' }],
  ['ridge-vent', 'Ridge Vent', { length: 2, width: 0.3, height: 0.1, style: 'standard' }],
  ['turbine-vent', 'Turbine Vent', { diameter: 0.32, height: 0.42, style: 'globe', spinSpeed: 0 }],
  ['eyebrow-vent', 'Eyebrow Vent', { width: 0.5, depth: 0.6, height: 0.3, style: 'scoop' }],
] as const

function segment(overrides: Partial<RoofSegmentNode> = {}) {
  return RoofSegmentNode.parse({
    id: 'rseg_native',
    parentId: 'roof_native',
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: 30,
    wallHeight: 2,
    children: [],
    ...overrides,
  })
}

function build(kind: RoofElementKind, options?: RoofElementOptions) {
  const node = buildRoofElementNode(kind, segment(), [0.75, 17.25, 1.5], options)
  if (!node) throw new Error(`The gable fixture has a native seat/ridge for ${kind}`)
  return node
}

function close(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, 10)
  })
}

describe('native roof element construction', () => {
  test('offers exactly the eight existing native accessories', () => {
    expect(new Set(ROOF_ELEMENT_KINDS)).toEqual(new Set(cases.map(([kind]) => kind)))
  })

  for (const [kind, name, defaults] of cases) {
    test(`${kind} keeps native defaults and reciprocal host references without moving the supplied seat`, () => {
      const host = segment()
      const position: [number, number, number] = [0.75, 17.25, 1.5]
      const before = structuredClone({ host, position })
      const node = buildRoofElementNode(kind, host, position)
      expect(node).not.toBeNull()
      if (!node) throw new Error('Expected native construction')
      expect(node).toMatchObject({
        type: kind,
        name,
        parentId: host.id,
        roofSegmentId: host.id,
        ...defaults,
      })
      expect(node.id).not.toBe(host.id)
      // Construction consumes a supplied hit; it does not invent another height.
      close(node.position, kind === 'ridge-vent' ? [0.75, 0, 0] : position)
      expect({ host, position }).toEqual(before)
      expect(buildRoofElementNode(kind, host, position)?.id).not.toBe(node.id)
    })

    test(`${kind} accepts an explicit name without acquiring solar-only fields`, () => {
      const node = build(kind, { name: 'Surveyed accessory', rows: 1, columns: 20 })
      expect(node.name).toBe('Surveyed accessory')
      if (node.type === 'solar-panel') {
        expect(node.rows).toBe(1)
        expect(node.columns).toBe(20)
      } else {
        expect('rows' in node).toBe(false)
        expect('columns' in node).toBe(false)
      }
    })
  }

  test('preserves definition-level chimney finishes and cupola louvers', () => {
    const white = {
      properties: {
        color: '#ffffff',
        roughness: 0.85,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    }
    expect(build('chimney')).toMatchObject({ material: white, topMaterial: white })
    expect(build('cupola')).toMatchObject({
      materialPreset: 'preset-white',
      slots: { louvers: 'library:preset-metal' },
    })
  })

  test('solar dimensions retain native defaults independently for each omitted option', () => {
    expect(build('solar-panel')).toMatchObject({ rows: 2, columns: 3 })
    expect(build('solar-panel', { rows: 20 })).toMatchObject({ rows: 20, columns: 3 })
    expect(build('solar-panel', { columns: 1 })).toMatchObject({ rows: 2, columns: 1 })
  })
})

describe('native orientation and ridge placement', () => {
  for (const z of [-1.5, 1.5]) {
    test(`keeps analytical thirty-degree gable orientation on the ${z < 0 ? 'back' : 'front'} slope`, () => {
      const host = segment()
      for (const kind of ['box-vent', 'turbine-vent', 'eyebrow-vent'] as const) {
        const node = buildRoofElementNode(kind, host, [0.75, 5, z])
        expect(node?.rotation).toBeCloseTo(z < 0 ? Math.PI : 0, 10)
      }
      for (const kind of ['chimney', 'skylight', 'solar-panel', 'cupola'] as const) {
        expect(buildRoofElementNode(kind, host, [0.75, 5, z])?.rotation).toBe(0)
      }
      const solar = buildRoofElementNode('solar-panel', host, [0.75, 5, z])
      if (solar?.type !== 'solar-panel' || !solar.surfaceNormal)
        throw new Error('Solar construction must persist the native analytical normal')
      close(solar.surfaceNormal, [0, Math.sqrt(3) / 2, z < 0 ? -0.5 : 0.5])
    })
  }

  test('hip end vents point toward the end eave, not the gable front', () => {
    const host = segment({ roofType: 'hip' })
    expect(buildRoofElementNode('box-vent', host, [5, 5, 0])?.rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(buildRoofElementNode('box-vent', host, [-5, 5, 0])?.rotation).toBeCloseTo(
      -Math.PI / 2,
      10,
    )
  })

  test('flat accessories stay horizontal but a ridge vent cannot invent a ridge', () => {
    const host = segment({ roofType: 'flat' })
    expect(buildRoofElementNode('box-vent', host, [1, 2, 1])?.rotation).toBe(0)
    expect(buildRoofElementNode('solar-panel', host, [1, 2, 1])).toMatchObject({
      surfaceNormal: [0, 1, 0],
    })
    expect(buildRoofElementNode('ridge-vent', host, [1, 2, 1])).toBeNull()
    expect(
      buildRoofElementNode('ridge-vent', segment({ roofType: 'conical' }), [1, 2, 1]),
    ).toBeNull()
  })

  test('gable ridge snaps in plan and stores a zero height offset, not the cursor height', () => {
    const node = buildRoofElementNode('ridge-vent', segment(), [0.75, 17.25, -2.25])
    if (!node) throw new Error('Expected the native gable ridge')
    close(node.position, [0.75, 0, 0])
    expect(node.rotation).toBeCloseTo(0, 10)
  })

  test('shed retains its native high-eave snap rather than inventing a central ridge', () => {
    const host = segment({ roofType: 'shed', wallThickness: 0, overhang: 0, gableOverhang: 0 })
    const node = buildRoofElementNode('ridge-vent', host, [0.75, 17.25, 1.5])
    if (!node) throw new Error('Native shed high-eave snapping is supported')
    close(node.position, [0.75, 0, -4])
    expect(node.rotation).toBeCloseTo(0, 10)
  })
})
