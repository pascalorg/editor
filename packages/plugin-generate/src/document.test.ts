import { describe, expect, test } from 'bun:test'
import { normalizeDocument, type PlanDocument, validateDocument } from './document'
import { POPPY } from './templates/poppy'

const tiny: PlanDocument = {
  rooms: [
    { name: 'Living', x: 0, y: 0, w: 16, d: 14 },
    { name: 'Bed 1', x: 16, y: 0, w: 12, d: 14 },
  ],
  attach: [['LIVING', 'BED 1', 'door']],
  frontDoor: 'LIVING',
}

describe('the plan document', () => {
  test('normalises to inches on the 6" grid with canonical names and kinds', () => {
    const doc = normalizeDocument(tiny)
    expect(doc.rooms[0]).toMatchObject({ name: 'LIVING', kind: 'living', u0: 0, v0: 0, u1: 192, v1: 168 })
    expect(doc.rooms[1]).toMatchObject({ name: 'BED 1', kind: 'bed', u0: 192, u1: 336 })
    expect(doc.ceiling).toBe(108)
    expect(doc.edges).toEqual([{ a: 'LIVING', b: 'BED 1', kind: 'door' }])
  })

  test('Poppy validates clean', () => {
    const v = validateDocument(POPPY)
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
  })

  test('errors read in room-name language', () => {
    const bad: PlanDocument = {
      rooms: [
        { name: 'A', x: 0, y: 0, w: 10, d: 10 },
        { name: 'A', x: 5, y: 5, w: 10, d: 10 },
        { name: 'FAR', x: 40, y: 40, w: 10, d: 10 },
        { name: 'BED 9', x: 10, y: 0, w: 1, d: 10 },
      ],
      attach: [['A', 'NOPE', 'door']],
      frontDoor: 'GHOST',
      roof: { form: 'gable', pitch: 40 },
    }
    const v = validateDocument(bad)
    expect(v.ok).toBe(false)
    expect(v.errors.join('\n')).toContain('two rooms are both named "A"')
    expect(v.errors.join('\n')).toContain('overlap')
    expect(v.errors.join('\n')).toContain('"FAR" does not touch the rest of the plan')
    expect(v.errors.join('\n')).toContain('under 2ft on a side')
    expect(v.errors.join('\n')).toContain('unknown room "NOPE"')
    expect(v.errors.join('\n')).toContain('frontDoor names unknown room "GHOST"')
    expect(v.errors.join('\n')).toContain('roof.pitch is rise:12')
  })

  test('a fully interior bedroom is refused — no egress wall', () => {
    const boxed: PlanDocument = {
      rooms: [
        { name: 'W', x: 0, y: 0, w: 6, d: 30 },
        { name: 'N', x: 6, y: 0, w: 12, d: 6 },
        { name: 'BED', x: 6, y: 6, w: 12, d: 18 },
        { name: 'S', x: 6, y: 24, w: 12, d: 6 },
        { name: 'E', x: 18, y: 0, w: 6, d: 30 },
      ],
    }
    const v = validateDocument(boxed)
    expect(v.errors.join('\n')).toContain('bedroom "BED" is fully interior')
  })
})
