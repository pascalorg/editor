import { describe, expect, test } from 'bun:test'
import {
  getEffectiveWallSurfaceMaterial,
  getWallTrimFaces,
  getWallTrimSlotId,
  type WallNode,
} from '../schema/nodes/wall'
import {
  buildWallFinishLayout,
  resolveWallFaceChain,
  resolveWallFinish,
} from '../systems/wall/wall-finish'
import { migrateWallFaceBands, migrateWallFaceKeys } from './wall-face-migration'

type Raw = Record<string, any>
type Face = 'a' | 'b'
type Side = 'interior' | 'exterior'

// ── The renderer before phase 7, restated as a pure oracle ───────────────────
// Face finish: `viewer/systems/wall/wall-system.tsx` getWallFaceMaterialIndex +
// `wall-materials.ts` resolveWallFaceMaterial / resolveWallSlotMaterial.
// Trims: `nodes/wall/treatments.tsx` resolveTreatmentSideSign + slot lookup.

const WALL_HEIGHT = 2.5
const SUFFIX: Record<Side, string> = { interior: 'Interior', exterior: 'Exterior' }
const TRIM_DEFAULTS: Record<string, string> = {
  skirting: 'library:preset-softwhite',
  crown: 'library:preset-white',
  chairRail: 'library:preset-cream',
}

function oldSide(node: Raw, face: Face): Side {
  const stored = face === 'a' ? node.frontSide : node.backSide
  return stored === 'interior' || stored === 'exterior'
    ? stored
    : face === 'a'
      ? 'interior'
      : 'exterior'
}

function oldChain(node: Raw, side: Side): string {
  const ref = node.slots?.[side]
  if (ref) return `ref:${ref}`
  const spec = getEffectiveWallSurfaceMaterial(node, side)
  if (spec.materialPreset) return `preset:${spec.materialPreset}`
  if (spec.material) return `inline:${JSON.stringify(spec.material)}`
  return 'default:library:concrete-drywall'
}

function oldBands(node: Raw) {
  const raw = {
    enabled: false,
    count: 1,
    lowerHeight: 0.84,
    middleHeight: 0.61,
    upperHeight: 0.61,
    ...(node.faceBands ?? {}),
  }
  const count = raw.enabled ? Math.max(1, Math.min(4, Math.round(raw.count ?? 3))) : 1
  const lower = count >= 2 ? Math.max(0, Math.min(WALL_HEIGHT, raw.lowerHeight)) : 0
  const middle = count >= 3 ? Math.max(0, Math.min(WALL_HEIGHT - lower, raw.middleHeight)) : 0
  const upper =
    count >= 4 ? Math.max(0, Math.min(WALL_HEIGHT - lower - middle, raw.upperHeight)) : 0
  return {
    enabled: raw.enabled && count > 1,
    count,
    lowerTop: lower,
    middleTop: lower + middle,
    upperTop: lower + middle + upper,
  }
}

function oldFaceFinish(node: Raw, face: Face, y: number): string {
  const side = oldSide(node, face)
  const bands = oldBands(node)
  if (!bands.enabled) return oldChain(node, side)
  const band =
    y < bands.lowerTop
      ? 'lower'
      : y < bands.middleTop
        ? 'middle'
        : bands.count >= 4 && y < bands.upperTop
          ? 'upper'
          : bands.count >= 4
            ? 'top'
            : 'upper'
  const ref = node.slots?.[`${band}${SUFFIX[side]}`]
  return ref ? `ref:${ref}` : oldChain(node, side)
}

function oldTrimFace(node: Raw, side: Side): Face {
  if (node.frontSide === side) return 'a'
  if (node.backSide === side) return 'b'
  return side === 'interior' ? 'a' : 'b'
}

function oldTrims(node: Raw, face: Face): string[] {
  const out: string[] = []
  for (const kind of ['skirting', 'crown', 'chairRail']) {
    const trim = node[kind]
    if (!trim?.enabled) continue
    const sides: Side[] =
      (trim.sides ?? 'both') === 'both' ? ['interior', 'exterior'] : [trim.sides]
    for (const side of sides) {
      if (oldTrimFace(node, side) !== face) continue
      out.push(`${kind}:${node.slots?.[`${kind}${SUFFIX[side]}`] || TRIM_DEFAULTS[kind]}`)
    }
  }
  return out
}

// ── The phase-7 renderer on a migrated node ──────────────────────────────────

function newFaceFinish(node: Raw, face: Face, y: number): string {
  const hit = resolveWallFinish(buildWallFinishLayout(node as WallNode, []), face, 1, y)
  if (hit.source !== 'slot') return `ref:${hit.ref}`
  const chain = resolveWallFaceChain(node as WallNode, face)
  if (chain.kind === 'ref') return `ref:${chain.ref}`
  if (chain.kind === 'default') return `default:${chain.ref}`
  return chain.spec.materialPreset
    ? `preset:${chain.spec.materialPreset}`
    : `inline:${JSON.stringify(chain.spec.material)}`
}

function newTrims(node: Raw, face: Face): string[] {
  const out: string[] = []
  for (const kind of ['skirting', 'crown', 'chairRail'] as const) {
    const trim = node[kind]
    if (!trim?.enabled || !getWallTrimFaces(trim.sides ?? 'both').includes(face)) continue
    out.push(`${kind}:${node.slots?.[getWallTrimSlotId(face, kind)] || TRIM_DEFAULTS[kind]}`)
  }
  return out
}

function migrate(node: Raw): Raw {
  const nodes = { [node.id]: node }
  return migrateWallFaceBands(migrateWallFaceKeys(nodes).nodes).nodes[node.id] as Raw
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const FRONT_SIDES: unknown[] = ['interior', 'exterior', 'unknown', undefined, { color: '#A02424' }]
const BACK_SIDES: unknown[] = ['interior', 'exterior', 'unknown', undefined]
const HEIGHTS = [-0.2, 0.1, 0.5, 0.79, 0.81, 1.2, 1.35, 1.8, 2.4]

const SCENARIOS: Record<string, Raw> = {
  'both side slots': { slots: { interior: 'library:in', exterior: 'library:out' } },
  'interior slot + legacy exterior preset': {
    slots: { interior: 'library:in' },
    exteriorMaterialPreset: 'library:legacy-out',
  },
  'legacy inline + non-ref preset + wall-wide fallback': {
    interiorMaterial: { properties: { color: '#111111' } },
    exteriorMaterialPreset: 'white',
    material: { properties: { color: '#999999' } },
  },
  'wall-wide legacy only': { materialPreset: 'library:general' },
  'legacy side fields with a partial side': {
    interiorMaterialPreset: 'library:legacy-in',
    materialPreset: 'library:general',
  },
  'empty-string slot falls through to legacy': {
    slots: { interior: '' },
    interiorMaterialPreset: 'library:legacy-in',
  },
  'no finish at all': {},
  ...Object.fromEntries(
    [2, 3, 4].map((count) => [
      `${count} bands`,
      {
        faceBands: { enabled: true, count, lowerHeight: 0.8, middleHeight: 0.5, upperHeight: 0.4 },
        slots: {
          interior: 'library:in',
          lowerInterior: 'library:low-in',
          middleExterior: 'library:mid-out',
          upperInterior: 'library:up-in',
          upperExterior: 'library:up-out',
          topExterior: 'library:top-out',
          lowerExterior: 'library:low-out',
        },
      },
    ]),
  ),
  'bands disabled keep their dead slots out of sight': {
    faceBands: { enabled: false, count: 3 },
    slots: { lowerInterior: 'library:low-in' },
  },
  'band slots over legacy inline faces': {
    faceBands: { enabled: true, count: 2, lowerHeight: 1 },
    slots: { lowerExterior: 'library:low-out' },
    exteriorMaterial: { properties: { color: '#222222' } },
  },
  trims: {
    skirting: { enabled: true, sides: 'interior' },
    crown: { enabled: true, sides: 'exterior' },
    chairRail: { enabled: true, sides: 'both' },
    slots: {
      skirtingInterior: 'library:skirt-in',
      skirtingExterior: 'library:skirt-out',
      crownExterior: 'library:crown-out',
      chairRailInterior: 'library:rail-in',
      chairRailExterior: 'library:rail-out',
    },
  },
}

function wall(extra: Raw, frontSide: unknown, backSide: unknown): Raw {
  const node: Raw = {
    id: 'wall_m1',
    type: 'wall',
    start: [0, 0],
    end: [4, 0],
    children: [],
    ...extra,
  }
  if (frontSide !== undefined) node.frontSide = frontSide
  if (backSide !== undefined) node.backSide = backSide
  return node
}

function degenerate(node: Raw) {
  return oldTrimFace(node, 'interior') === oldTrimFace(node, 'exterior')
}

describe('M1 + M2 keep every face looking the same', () => {
  for (const [name, extra] of Object.entries(SCENARIOS)) {
    test(name, () => {
      for (const frontSide of FRONT_SIDES) {
        for (const backSide of BACK_SIDES) {
          const legacy = wall(structuredClone(extra), frontSide, backSide)
          const migrated = migrate(legacy)
          const label = `${JSON.stringify(frontSide)}/${JSON.stringify(backSide)}`
          for (const face of ['a', 'b'] as const) {
            for (const y of HEIGHTS) {
              expect([label, face, y, newFaceFinish(migrated, face, y)]).toEqual([
                label,
                face,
                y,
                oldFaceFinish(legacy, face, y),
              ])
            }
            if (degenerate(legacy)) continue
            expect([label, face, newTrims(migrated, face)]).toEqual([
              label,
              face,
              oldTrims(legacy, face),
            ])
          }
          // Nothing semantic survives: rendering never needs frontSide / backSide again.
          const keys = Object.keys(migrated.slots ?? {})
          expect(keys.filter((key) => /interior|exterior|^front$|^back$/i.test(key))).toEqual([])
          for (const key of [
            'interiorMaterial',
            'interiorMaterialPreset',
            'exteriorMaterial',
            'exteriorMaterialPreset',
            'faceBands',
          ])
            expect(key in migrated).toBe(false)
          expect(migrated.frontSide).toEqual(legacy.frontSide)
        }
      }
    })
  }

  test('a side pair that drew both trims on one face keeps that face and trims the other', () => {
    // exterior/exterior: the old renderer drew the interior and exterior trim on face a.
    const legacy = wall(structuredClone(SCENARIOS.trims!), 'exterior', 'exterior')
    expect(oldTrims(legacy, 'a')).toEqual([
      'skirting:library:skirt-in',
      'crown:library:crown-out',
      'chairRail:library:rail-in',
      'chairRail:library:rail-out',
    ])
    expect(oldTrims(legacy, 'b')).toEqual([])
    const migrated = migrate(legacy)
    expect(newTrims(migrated, 'a')).toEqual([
      'skirting:library:skirt-in',
      'crown:library:crown-out',
      'chairRail:library:rail-in',
    ])
    // `both` now draws the second face instead of doubling the first; it keeps the exterior finish.
    expect(newTrims(migrated, 'b')).toEqual(['chairRail:library:rail-out'])
  })

  test('stray front / back keys fill a face M1 left empty and never override a side slot', () => {
    expect(
      migrate(wall({ slots: { front: 'library:f', back: 'library:b' } }, 'exterior', 'interior'))
        .slots,
    ).toEqual({
      a: 'library:f',
      b: 'library:b',
    })
    expect(
      migrate(
        wall(
          { slots: { interior: 'library:in', front: 'library:f', back: 'library:b' } },
          'exterior',
          'interior',
        ),
      ).slots,
    ).toEqual({ a: 'library:f', b: 'library:in' })
  })

  test('a corrupt side value falls back like the renderer did (front → interior)', () => {
    const migrated = migrate(
      wall(
        { slots: { interior: 'library:in', exterior: 'library:out' } },
        { color: '#A02424' },
        'exterior',
      ),
    )
    expect(migrated.slots).toEqual({ a: 'library:in', b: 'library:out' })
  })
})

describe('M2 face bands → paint regions', () => {
  test('band heights become full-width horizontal regions on each face', () => {
    const migrated = migrate(
      wall(
        {
          faceBands: {
            enabled: true,
            count: 4,
            lowerHeight: 0.8,
            middleHeight: 0.5,
            upperHeight: 0.4,
          },
          slots: {
            lowerInterior: 'library:1',
            middleInterior: 'library:2',
            upperInterior: 'library:3',
            topInterior: 'library:4',
            middleExterior: 'library:b2',
          },
        },
        'interior',
        'exterior',
      ),
    )
    expect(migrated.faceRegions).toEqual([
      { id: 'band-a-lower', face: 'a', v1: 0.8, finish: 'library:1' },
      { id: 'band-a-middle', face: 'a', v0: 0.8, v1: 1.3, finish: 'library:2' },
      { id: 'band-a-upper', face: 'a', v0: 1.3, v1: 1.7000000000000002, finish: 'library:3' },
      { id: 'band-a-top', face: 'a', v0: 1.7000000000000002, finish: 'library:4' },
      { id: 'band-b-middle', face: 'b', v0: 0.8, v1: 1.3, finish: 'library:b2' },
    ])
    expect(migrated.slots).toEqual({})
  })

  test('two and three bands, reversed sides, and existing regions stay on top', () => {
    const two = migrate(
      wall(
        {
          faceBands: { enabled: true, count: 2, lowerHeight: 1.1 },
          slots: { lowerInterior: 'library:low', upperExterior: 'library:up' },
          faceRegions: [{ id: 'mine', face: 'a', u0: 1, finish: 'library:mine' }],
        },
        'exterior',
        'interior',
      ),
    )
    expect(two.faceRegions).toEqual([
      { id: 'band-a-upper', face: 'a', v0: 1.1, finish: 'library:up' },
      { id: 'band-b-lower', face: 'b', v1: 1.1, finish: 'library:low' },
      { id: 'mine', face: 'a', u0: 1, finish: 'library:mine' },
    ])
    const three = migrate(
      wall(
        { faceBands: { enabled: true, count: 3 }, slots: { middleInterior: 'library:mid' } },
        'interior',
        'exterior',
      ),
    )
    expect(three.faceRegions).toEqual([
      { id: 'band-a-middle', face: 'a', v0: 0.84, v1: 1.45, finish: 'library:mid' },
    ])
  })

  test('disabled or single bands leave no regions and drop the config', () => {
    for (const faceBands of [
      { enabled: false, count: 3 },
      { enabled: true, count: 1 },
      { enabled: true },
    ]) {
      const migrated = migrate(
        wall({ faceBands, slots: { lowerInterior: 'library:x' } }, 'interior', 'exterior'),
      )
      expect(migrated.faceRegions).toBeUndefined()
      expect('faceBands' in migrated).toBe(false)
      expect(migrated.slots).toEqual({})
    }
  })
})

describe('idempotence', () => {
  test('M1 and M2 are no-ops on their own output, even after the sides are reclassified', () => {
    for (const extra of Object.values(SCENARIOS)) {
      const once = migrate(wall(structuredClone(extra), 'exterior', 'interior'))
      expect(migrate(once)).toEqual(once)
      const nodes = { [once.id]: once }
      expect(migrateWallFaceKeys(nodes).nodes).toBe(nodes)
      expect(migrateWallFaceBands(nodes).nodes).toBe(nodes)
      // The kernel keeps rewriting sides after edits; a migrated wall must not move again.
      const reclassified = { ...once, frontSide: 'interior', backSide: 'exterior' }
      expect(migrate(reclassified)).toEqual(reclassified)
    }
  })

  test('untouched scenes come back as the same object', () => {
    const nodes = {
      wall_plain: {
        id: 'wall_plain',
        type: 'wall',
        start: [0, 0],
        end: [1, 0],
        slots: { a: 'library:x' },
      },
      slab_x: { id: 'slab_x', type: 'slab', slots: { interior: 'library:y' } },
    }
    expect(migrateWallFaceKeys(nodes).nodes).toBe(nodes)
    expect(migrateWallFaceBands(nodes).nodes).toBe(nodes)
  })
})
