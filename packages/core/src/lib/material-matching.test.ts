import { expect, test } from 'bun:test'
import {
  MATERIAL_CATALOG,
  matchPascalMaterial,
  matchScriptSlotsToLibrary,
  type PascalMaterialHints,
} from '../index'
import { GeometryArtifactManifest } from '../schema'

const matches: [PascalMaterialHints, string][] = [
  [{ name: 'glass_pane', color: '#ff0000' }, 'preset-glass'],
  [{ name: 'Glazed panel' }, 'preset-glass'],
  [{ color: '#ffffff', transparent: true }, 'preset-glass'],
  [{ name: 'steelFrame', color: '#636363' }, 'metal-steel'],
  [{ name: 'brass_handles', color: '#b08d57' }, 'metal-brass'],
  [{ color: '#cc845b', metalness: 0.8, roughness: 0.3 }, 'metal-copper'],
  [{ name: 'oak_wood', color: '#a77440' }, 'wood-finewood27'],
  [{ name: 'walnut', color: '#3e220d' }, 'wood-squareparquet21'],
  [{ name: 'body', color: '#88654c', roughness: 0.7 }, 'wood-woodplank48'],
  [{ name: 'paint', color: '#eae6de' }, 'preset-softwhite'],
]

for (const [hints, id] of matches) {
  test(`matches ${JSON.stringify(hints)} to ${id}`, () => {
    const before = structuredClone(hints)
    expect(matchPascalMaterial(hints)).toBe(`library:${id}`)
    expect(MATERIAL_CATALOG.some((entry) => entry.id === id)).toBe(true)
    expect(matchPascalMaterial(hints)).toBe(matchPascalMaterial(hints))
    expect(hints).toEqual(before)
  })
}

test('uncertain slots retain their authored material', () => {
  for (const hints of [
    {},
    { name: 'body' },
    { name: 'wood', color: 'not a hex' },
    { color: '#gggggg' },
    { name: 'fabric', color: '#ff00ff' },
    { name: 'body', color: '#ff00ff', roughness: 0.05 },
    { name: 'body', color: '#88654c', roughness: 0.1 },
    { name: 'body', color: '#88654c', metalness: 0.3 },
    { name: 'bulb', color: '#ffffff', emissive: true },
  ])
    expect(matchPascalMaterial(hints)).toBeNull()
})

test('matching preserves every explicit override and fills only confident unpainted slots', () => {
  const manifest = GeometryArtifactManifest.parse({
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    triangles: 12,
    slots: [
      { id: 'wood', color: '#a77440' },
      { id: 'metal', color: '#636363' },
      { id: 'pane', transparent: true },
      { id: 'unmatched', color: '#ff00ff' },
    ],
  })
  for (const ref of ['scene:mtl_painted', 'library:preset-white', '#abcdef']) {
    const overrides = { wood: ref, orphaned: '#112233' }
    const before = structuredClone({ manifest, overrides })
    expect(matchScriptSlotsToLibrary(manifest, overrides)).toEqual({
      ...overrides,
      metal: 'library:metal-steel',
      pane: 'library:preset-glass',
    })
    expect({ manifest, overrides }).toEqual(before)
  }
})

test('a rebuild re-matches a slot still holding the previous automatic match', () => {
  const build = (color: string) =>
    GeometryArtifactManifest.parse({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      triangles: 12,
      slots: [
        { id: 'top', color },
        { id: 'legs', color },
      ],
    })
  const oak = build('#a77440')
  const first = matchScriptSlotsToLibrary(oak)
  expect(first).toEqual({ top: 'library:wood-finewood27', legs: 'library:wood-finewood27' })
  // The script turns both slots magenta; the user had picked steel for the legs.
  const painted = { ...first, legs: 'library:metal-steel' }
  expect(matchScriptSlotsToLibrary(build('#ff00ff'), painted, oak)).toEqual({
    legs: 'library:metal-steel',
  })
  expect(matchScriptSlotsToLibrary(build('#3e220d'), painted, oak)).toEqual({
    top: 'library:wood-squareparquet21',
    legs: 'library:metal-steel',
  })
})

test('older slot manifests still load and match explicit glass names', () => {
  const manifest = GeometryArtifactManifest.parse({
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    triangles: 12,
    slots: [{ id: 'body' }, { id: 'pane', label: 'Glass' }],
  })
  expect(matchScriptSlotsToLibrary(manifest)).toEqual({ pane: 'library:preset-glass' })
})
