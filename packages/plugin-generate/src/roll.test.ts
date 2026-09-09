import { describe, expect, test } from 'bun:test'

import { buildHouse } from './build'
import { validateDocument } from './document'
import { rollDocument } from './roll'
import { STYLE_KEYS } from './styles'

describe('the exterior wall system follows the site (2026-09-09)', () => {
  test('a Lee County, FL site rolls a block + stucco house; a Leon County one a wood-frame house; no site, wood frame', () => {
    const lee = rollDocument(7, { style: 'craftsman', site: { state: 'FL', county: 'Lee', lat: 26.6 } })
    expect(lee.document.wallSystem).toBe('cmu')
    expect(lee.document.finishes?.siding).toMatch(/^stucco_/)
    expect(lee.document.wallSystemBasis).toMatch(/Lee County/)
    const leon = rollDocument(7, { style: 'craftsman', site: { state: 'FL', county: 'Leon', lat: 30.44 } })
    expect(leon.document.wallSystem).toBe('framed')
    expect(leon.document.finishes?.siding).not.toMatch(/^stucco_/)
    expect(rollDocument(7, { style: 'craftsman' }).document.wallSystem).toBe('framed')
  })
})

describe('the narrow-lot parti (2026-09-09): one column, a grand entrance, the suite at the back', () => {
  test('a 30 ft band rolls the narrow plan in every style, validates, builds, and stays inside 30 × 65 ft', () => {
    for (const style of STYLE_KEYS) {
      for (const seed of [3, 11, 42]) {
        const rolled = rollDocument(seed, { style, maxWidthFt: 30, maxDepthFt: 65, beds: 3, baths: 2, garage: false })
        const doc = rolled.document
        expect(doc.name).toMatch(/narrow-lot plan/)
        const names = doc.rooms.map((r) => r.name)
        for (const n of ['FOYER', 'HALL', 'GREAT ROOM', 'KITCHEN', 'DINING', 'LAUNDRY', 'BATH 2', 'HALL 2', 'WIC', 'PRIMARY BATH', 'PRIMARY BEDROOM', 'BEDROOM 2', 'BEDROOM 3']) {
          expect(names).toContain(n)
        }
        let w = 0
        let d = 0
        for (const r of doc.rooms) {
          w = Math.max(w, r.x + r.w)
          d = Math.max(d, r.y + r.d)
        }
        expect(w).toBeLessThanOrEqual(30)
        expect(d).toBeLessThanOrEqual(65)
        expect(d).toBeGreaterThan(w) // longer than wide — the gables land front and back
        expect(doc.roof?.gables ?? []).not.toContain('left')
        expect(validateDocument(doc).errors ?? []).toEqual([])
        const built = buildHouse(doc)
        expect(built.ok).toBe(true)
        expect(built.errors).toEqual([])
      }
    }
  })
  test('a fourth bedroom needs the wider band; a garage is not rolled; a 2-bed puts the office at the front', () => {
    const four = rollDocument(5, { maxWidthFt: 33, maxDepthFt: 70, beds: 4, baths: 2, garage: true })
    expect(four.document.rooms.map((r) => r.name)).toContain('BEDROOM 4')
    expect(four.document.rooms.some((r) => r.kind === 'garage')).toBe(false)
    expect(four.warnings.some((w) => /detached garage/.test(w))).toBe(true)
    const two = rollDocument(5, { maxWidthFt: 28, maxDepthFt: 70, beds: 2, baths: 1, garage: false })
    const names = two.document.rooms.map((r) => r.name)
    expect(names).toContain('OFFICE')
    expect(names).not.toContain('PRIMARY BATH')
    expect(names).toContain('BATH')
    // the two-column warning about crossing a side setback is gone with the plan it was about
    expect(two.warnings.some((w) => /cross a side setback/.test(w))).toBe(false)
  })
  test('a wide band keeps the two-column plan', () => {
    const wide = rollDocument(5, { maxWidthFt: 60, maxDepthFt: 70, beds: 3, baths: 2, garage: true })
    expect(wide.document.name).not.toMatch(/narrow-lot plan/)
    expect(wide.document.rooms.some((r) => r.kind === 'garage')).toBe(true)
  })
})

describe('the roller on a narrow frontage', () => {
  test('a rolled garage gives way before the plan crosses a side setback; a requested one stays and warns', () => {
    // seed 1082019874 rolled a farmhouse with a garage on the Land Park lot: 58.5' on a 39' frontage.
    // 2026-09-09: a 39' band is a NARROW lot — it takes the narrow parti, garage-less, and says so
    const dropped = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', maxWidthFt: 39 })
    expect(dropped.options.garage).toBe(false)
    expect(dropped.document.name).toMatch(/narrow-lot plan/)
    expect(dropped.warnings.some((w) => w.includes('cross a side setback'))).toBe(false)
    const widest = Math.max(...dropped.document.rooms.map((r) => r.x + r.w))
    expect(widest).toBeLessThanOrEqual(39)

    const forced = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', garage: true, maxWidthFt: 39 })
    // the ask is honoured where it can be — on a narrow band it cannot, and the roll says so
    expect(forced.options.garage).toBe(false)
    expect(forced.document.rooms.some((r) => r.kind === 'garage')).toBe(false)
    expect(forced.warnings.some((w) => w.includes('detached garage'))).toBe(true)
    // a 50' band is still the two-column plan: the rolled garage gives way and says so
    const fifty = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', maxWidthFt: 50 })
    expect(fifty.document.name).not.toMatch(/narrow-lot plan/)
    expect(fifty.options.garage).toBe(false)
    expect(fifty.warnings.some((w) => w.includes('cannot take an attached garage'))).toBe(true)
  })

  test('a frontage that takes the garage keeps it', () => {
    const kept = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', maxWidthFt: 70 })
    expect(kept.options.garage).toBe(true)
    expect(kept.warnings).toEqual([])
  })
})

describe('the roller', () => {
  test('is deterministic: the same seed and options give the same document', () => {
    const a = rollDocument(42, { beds: 3, baths: 2, garage: true, style: 'farmhouse' })
    const b = rollDocument(42, { beds: 3, baths: 2, garage: true, style: 'farmhouse' })
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document))
    expect(JSON.stringify(rollDocument(43, { beds: 3, baths: 2, garage: true, style: 'farmhouse' }).document)).not.toBe(
      JSON.stringify(a.document),
    )
  })

  test('every omitted option is rolled', () => {
    const r = rollDocument(7)
    expect(STYLE_KEYS).toContain(r.options.style)
    expect([2, 3, 4]).toContain(r.options.beds)
    expect([1, 2, 3]).toContain(r.options.baths)
    expect(typeof r.options.garage).toBe('boolean')
  })

  test('50 seeds × every bed/bath/garage combination validate and build', () => {
    let built = 0
    for (let seed = 1; seed <= 50; seed++) {
      for (const beds of [2, 3, 4] as const) {
        for (const baths of [1, 2, 3] as const) {
          for (const garage of [false, true]) {
            const rolled = rollDocument(seed, { beds, baths, garage })
            const v = validateDocument(rolled.document)
            expect(v.errors, `seed ${seed} ${beds}bd/${baths}ba garage=${garage}: ${v.errors.join(' | ')}`).toEqual([])
            const result = buildHouse(rolled.document)
            expect(result.errors, `seed ${seed} ${beds}bd/${baths}ba garage=${garage}: ${result.errors.join(' | ')}`).toEqual([])
            const beds_ = result.ops.filter((op) => op.node.type === 'zone' && (op.node.metadata as any).kind === 'bed').length
            expect(beds_).toBe(beds)
            expect(result.ops.filter((op) => op.node.type === 'door').length).toBeGreaterThanOrEqual(rolled.document.attach!.filter((e) => e[2] !== 'zone').length + 1)
            built++
          }
        }
      }
    }
    expect(built).toBe(50 * 18)
    // 900 builds: past bun's 5 s default when the whole monorepo runs at once
  }, 20_000)

  test('shrinks to the buildable frontage before it warns', () => {
    const wide = rollDocument(3, { beds: 4, baths: 3, garage: true, style: 'ranch' })
    const w = (r: typeof wide) => Math.max(...r.document.rooms.map((x) => x.x + x.w))
    const narrow = rollDocument(3, { beds: 4, baths: 3, garage: true, style: 'ranch', maxWidthFt: 60 })
    expect(w(narrow)).toBeLessThanOrEqual(w(wide))
    // 2026-09-09: a 30' band takes the narrow parti — 4 beds and 3 baths fold to what it holds and say so
    const impossible = rollDocument(3, { beds: 4, baths: 3, garage: true, maxWidthFt: 30 })
    expect(impossible.document.name).toMatch(/narrow-lot plan/)
    expect(w(impossible)).toBeLessThanOrEqual(30)
    expect(impossible.warnings.join('\n')).toMatch(/fourth bedroom|powder room/)
    // a 46' band with a forced garage is still the two-column plan, and still says it will cross
    const tight = rollDocument(3, { beds: 4, baths: 3, garage: true, maxWidthFt: 46 })
    expect(tight.warnings.join('\n')).toContain('buildable frontage')
  })
})
