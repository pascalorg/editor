import { describe, expect, test } from 'bun:test'
import { buildHouse } from './build'
import { validateDocument } from './document'
import { rollDocument } from './roll'
import { STYLE_KEYS } from './styles'

describe('the roller on a narrow frontage', () => {
  test('a rolled garage gives way before the plan crosses a side setback; a requested one stays and warns', () => {
    // seed 1082019874 rolled a farmhouse with a garage on the Land Park lot: 58.5' on a 39' frontage
    const dropped = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', maxWidthFt: 39 })
    expect(dropped.options.garage).toBe(false)
    expect(dropped.warnings.some((w) => w.includes('cannot take an attached garage'))).toBe(true)
    expect(dropped.warnings.some((w) => w.includes('cross a side setback'))).toBe(false)
    const widest = Math.max(...dropped.document.rooms.map((r) => r.x + r.w))
    expect(widest).toBeLessThanOrEqual(39)

    const forced = rollDocument(1082019874, { beds: 2, baths: 2, style: 'farmhouse', garage: true, maxWidthFt: 39 })
    expect(forced.options.garage).toBe(true)
    expect(forced.warnings.some((w) => w.includes('cross a side setback'))).toBe(true)
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
  })

  test('shrinks to the buildable frontage before it warns', () => {
    const wide = rollDocument(3, { beds: 4, baths: 3, garage: true, style: 'ranch' })
    const w = (r: typeof wide) => Math.max(...r.document.rooms.map((x) => x.x + x.w))
    const narrow = rollDocument(3, { beds: 4, baths: 3, garage: true, style: 'ranch', maxWidthFt: 60 })
    expect(w(narrow)).toBeLessThanOrEqual(w(wide))
    const impossible = rollDocument(3, { beds: 4, baths: 3, garage: true, maxWidthFt: 30 })
    expect(impossible.warnings.join('\n')).toContain('buildable frontage')
  })
})
