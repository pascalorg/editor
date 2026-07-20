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
})
