import { describe, expect, test } from 'bun:test'
import { ConstructionNoteNode } from './construction-note'
import { LevelNode } from './level'

describe('ConstructionNoteNode', () => {
  test('fills a complete free-note contract from defaults', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_free',
      type: 'construction-note',
    })

    expect(note).toMatchObject({
      anchor: [0, 0],
      textPosition: [1.5, 0.75],
      text: 'CONSTRUCTION NOTE',
      terminator: 'arrow',
      leaderStyle: 'straight',
      curveControl: [0.5, 0.35],
      shoulderLength: 0.55,
      targetId: null,
      targetOffset: [0, 0],
      specialty: null,
      contractScope: 'contract',
      scopeReference: '',
    })
  })

  test('accepts an associative target and rejects empty notes', () => {
    expect(
      ConstructionNoteNode.safeParse({
        id: 'construction-note_attached',
        type: 'construction-note',
        targetId: 'column_target',
        targetOffset: [0.2, -0.1],
        text: '8x8 COLUMN\nGROUT SOLID',
        terminator: 'dot',
        leaderStyle: 'curved',
        curveControl: [0.4, -0.25],
      }).success,
    ).toBe(true)
    expect(
      ConstructionNoteNode.safeParse({
        id: 'construction-note_empty',
        type: 'construction-note',
        text: '   ',
      }).success,
    ).toBe(false)
    expect(
      ConstructionNoteNode.safeParse({
        id: 'construction-note_invalid-control',
        type: 'construction-note',
        curveControl: [1.2, 0.25],
      }).success,
    ).toBe(false)
  })

  test('can be hosted by a level', () => {
    const note = ConstructionNoteNode.parse({
      id: 'construction-note_level-child',
      type: 'construction-note',
    })

    expect(LevelNode.parse({ children: [note.id] }).children).toEqual([note.id])
  })

  test('validates typed specialty data and contract scope', () => {
    const access = ConstructionNoteNode.parse({
      id: 'construction-note_access',
      type: 'construction-note',
      specialty: { kind: 'access', spaceType: 'crawl-space' },
      contractScope: 'nic',
      scopeReference: 'BY OWNER',
    })
    const overhead = ConstructionNoteNode.parse({
      id: 'construction-note_overhead',
      type: 'construction-note',
      specialty: { kind: 'overhead', outlineType: 'balcony', width: 4, depth: 1.8 },
    })

    expect(access.specialty).toEqual({
      kind: 'access',
      spaceType: 'crawl-space',
      accessType: 'scuttle',
      openingWidth: 0.55,
      openingHeight: 0.75,
    })
    expect(access).toMatchObject({ contractScope: 'nic', scopeReference: 'BY OWNER' })
    expect(overhead.specialty).toMatchObject({
      kind: 'overhead',
      outlineType: 'balcony',
      width: 4,
      depth: 1.8,
      rotation: 0,
    })
    expect(
      ConstructionNoteNode.safeParse({
        id: 'construction-note_invalid-specialty',
        type: 'construction-note',
        specialty: { kind: 'rated-assembly', ratingMinutes: 5 },
      }).success,
    ).toBe(false)
  })
})
