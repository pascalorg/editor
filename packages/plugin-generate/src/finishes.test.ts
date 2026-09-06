import { describe, expect, test } from 'bun:test'
import { MATERIAL_CATALOG } from '@pascal-app/core'
import { buildHouse } from './build'
import {
  colourPresets,
  describeFinishes,
  finishesFor,
  nearestColourPreset,
  PALETTES,
  pickPalette,
  ROOFINGS,
  SIDINGS,
  windowTypeFor,
} from './finishes'
import { rollDocument } from './roll'
import { STYLES, styleFor } from './styles'
import { POPPY } from './templates/poppy'

type N = Record<string, any>
const libraryIds = new Set(MATERIAL_CATALOG.map((m) => m.id))

describe('the finish tables point at real library materials', () => {
  test('every siding and roofing texture exists in the catalog; every style has palettes whose sidings are known', () => {
    for (const s of Object.values(SIDINGS)) expect(libraryIds.has(s.library)).toBe(true)
    for (const r of Object.values(ROOFINGS))
      if (r.library) expect(libraryIds.has(r.library)).toBe(true)
    for (const style of STYLES) {
      const list = PALETTES[style.key]
      expect(list && list.length >= 4).toBe(true)
      for (const p of list!) expect(SIDINGS[p.siding]).toBeDefined()
      expect(ROOFINGS[style.roofMat]).toBeDefined()
    }
    expect(colourPresets().length).toBeGreaterThan(30)
  })

  test('colours snap to the nearest catalog colour preset', () => {
    expect(nearestColourPreset('#f4f1ea')).toBe('preset-white')
    expect(nearestColourPreset('#1c1c1c')).toBe('preset-nearblack')
    expect(nearestColourPreset('#3d4f63')).toBe('preset-navy')
    expect(nearestColourPreset('#bcc5b2')).toBe('preset-sage')
    expect(libraryIds.has(nearestColourPreset('#8d2f23'))).toBe(true)
  })

  test('the palette index wraps and is deterministic', () => {
    expect(pickPalette('farmhouse', 0).palette.siding).toBe('lap_white')
    expect(pickPalette('farmhouse', 5).index).toBe(0)
    expect(pickPalette('farmhouse', -1).index).toBe(4)
    expect(pickPalette('nope', 2).palette).toBe(PALETTES.farmhouse![2]!)
  })
})

describe('finishesFor — one coordinated unit per style', () => {
  test('a farmhouse palette: lap siding texture, comp shingles, trim + door refs, double-hung windows with a colonial grid, painted rails', () => {
    const f = finishesFor(styleFor('farmhouse'), 1)
    expect(f.paletteName).toContain('sage')
    expect(f.siding.ref).toBe('library:siding-lap-sage')
    expect(f.siding.kind).toBe('lap')
    expect(f.roof.library).toBe('roof-classicshingles')
    expect(f.trim.ref).toBe('library:preset-white')
    expect(f.door.hex).toBe('#6f5136')
    expect(f.windows).toEqual({ type: 'double-hung', grid: 'colonial' })
    expect(f.wood.style).toBe('painted')
    expect(f.wood.hex).toBe('#f4f1ea')
    expect(f.products.siding).toContain('Hardie')
    expect(describeFinishes(f)).toContain('lap siding — sage')
    expect(describeFinishes(f)).toContain('colonial grid (recorded, not drawn)')
  })

  test('a modern palette: iron-black lap, standing seam as a metal material, sliders, walnut rails', () => {
    const f = finishesFor(styleFor('modern'), 0)
    expect(f.siding.ref).toBe('library:siding-lap-nearblack')
    expect(f.roof.metal).toBe(true)
    expect(f.roof.library).toBeUndefined()
    expect(f.windows.type).toBe('sliding')
    expect(f.wood.style).toBe('walnut')
    expect(f.wood.hex).toBe('#6b4e36')
  })

  test('a ranch palette: stucco as a flat colour on the stucco assembly', () => {
    const f = finishesFor(styleFor('ranch'), 0)
    expect(f.siding.kind).toBe('stucco')
    expect(f.siding.ref).toBe('library:preset-sage')
  })

  test('window types follow PlanCrafters stampWindowStyle', () => {
    const f = finishesFor(styleFor('farmhouse'), 0)
    expect(windowTypeFor(f, 48 * 0.0254, 60 * 0.0254)).toBe('double-hung')
    expect(windowTypeFor(f, 72 * 0.0254, 72 * 0.0254)).toBe('fixed')
    expect(windowTypeFor(f, 30 * 0.0254, 30 * 0.0254)).toBe('sliding')
    expect(windowTypeFor(finishesFor(styleFor('modern-mono'), 0), 48 * 0.0254, 60 * 0.0254)).toBe(
      'fixed',
    )
  })
})

describe('applied to a generated house', () => {
  const doc = rollDocument(1499472249, {
    style: 'farmhouse',
    beds: 3,
    baths: 2,
    garage: true,
  }).document
  const built = buildHouse(doc)
  const nodes = built.ops.map((o) => o.node as N)
  const f = built.finishes!

  test('the roll picked a palette; every exterior wall, window, entrance door, roof, post, rail and deck carries the unit', () => {
    expect(f.style).toBe('farmhouse')
    expect(f.palette).toBeGreaterThanOrEqual(0)
    const ext = nodes.filter((n) => n.type === 'wall' && n.metadata?.wallType === 'ext2x6')
    expect(ext.length).toBeGreaterThan(0)
    for (const w of ext) expect(w.slots?.exterior).toBe(f.siding.ref)
    for (const w of nodes.filter((n) => n.type === 'wall' && n.metadata?.wallType !== 'ext2x6'))
      expect(w.slots?.exterior).toBeUndefined()
    const windows = nodes.filter((n) => n.type === 'window')
    expect(windows.length).toBeGreaterThan(0)
    for (const w of windows) {
      expect(w.slots?.frame).toBe(f.trim.ref)
      expect(['double-hung', 'sliding', 'fixed']).toContain(w.windowType)
    }
    const front = nodes.find((n) => n.type === 'door' && n.name === 'Front door')!
    expect(front.slots?.panel).toBe(f.door.ref)
    const garage = nodes.find((n) => n.type === 'door' && n.doorType === 'garage-sectional')!
    expect(garage.slots?.panel).toBe(f.trim.ref)
    const interior = nodes.filter((n) => n.type === 'door' && n.metadata?.attach === 'door')
    for (const d of interior) expect(d.slots).toBeUndefined()
    const roof = nodes.find((n) => n.type === 'roof')!
    expect(roof.topMaterialPreset).toBe(`library:${f.roof.library}`)
    expect(roof.edgeMaterialPreset).toBe(f.trim.ref)
    const posts = nodes.filter((n) => n.type === 'column' && n.name === 'Porch post')
    expect(posts.length).toBeGreaterThan(0)
    for (const p of posts) expect(p.materialPreset).toBe(f.trim.ref)
    const rails = nodes.filter((n) => n.type === 'fence')
    expect(rails.length).toBeGreaterThan(0)
    for (const r of rails) expect(r.color).toBe(f.trim.hex) // farmhouse: painted rails everywhere
    const decks = nodes.filter((n) => n.type === 'slab' && n.metadata?.floor === 'deck')
    expect(decks.length).toBeGreaterThan(0)
    for (const d of decks) expect(d.materialPreset).toBe('library:wood-floorplank1')
    const stairs = nodes.filter((n) => n.type === 'stair')
    for (const s of stairs) expect(String(s.materialPreset)).toMatch(/^library:/)
    const building = nodes.find((n) => n.type === 'building')!
    expect(building.metadata.finishes.palette).toBe(f.palette)
    expect(building.metadata.finishes.siding.label).toBe(f.siding.label)
  })

  test('the same seed gives the same palette; a different palette index changes the unit together', () => {
    const again = buildHouse(
      rollDocument(1499472249, { style: 'farmhouse', beds: 3, baths: 2, garage: true }).document,
    )
    expect(again.finishes?.palette).toBe(f.palette)
    const other = buildHouse({ ...doc, finishes: { ...doc.finishes, palette: f.palette + 1 } })
    expect(other.finishes?.palette).toBe((f.palette + 1) % PALETTES.farmhouse!.length)
    expect(other.finishes?.siding.id).not.toBe(f.siding.id)
    expect(other.finishes?.trim.hex === f.trim.hex && other.finishes?.door.hex === f.door.hex).toBe(
      false,
    )
  })

  test('a modern slab house takes the metal roof and cable rails in the trim colour, concrete landings prefixed', () => {
    const poppy = buildHouse(POPPY)
    const nodes2 = poppy.ops.map((o) => o.node as N)
    const roof = nodes2.find((n) => n.type === 'roof')!
    expect(roof.topMaterial?.preset).toBe('metal')
    expect(roof.topMaterialPreset).toBeUndefined()
    for (const s of nodes2.filter((n) => n.type === 'slab' && n.metadata?.floor === 'porch-slab')) {
      expect(s.materialPreset).toBe('library:concrete-raw')
    }
    expect(poppy.finishes?.windows.type).toBe('sliding')
  })
})
