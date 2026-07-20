import { describe, expect, test } from 'bun:test'
import { constructionNoteDefinition } from './definition'

describe('constructionNoteDefinition', () => {
  test('registers a selectable, floor-plan-only construction annotation', () => {
    expect(constructionNoteDefinition.kind).toBe('construction-note')
    expect(constructionNoteDefinition.category).toBe('analysis')
    expect(constructionNoteDefinition.bake).toBe('strip')
    expect(constructionNoteDefinition.schemaVersion).toBe(2)
    expect(constructionNoteDefinition.dirtyTracking).toBe(false)
    expect(constructionNoteDefinition.capabilities).toMatchObject({
      selectable: { hitVolume: 'bbox' },
      deletable: true,
      duplicable: true,
      presettable: false,
    })
    expect(typeof constructionNoteDefinition.tool).toBe('function')
    expect(constructionNoteDefinition.floorplanAffordances).toHaveProperty(
      'move-construction-note-anchor',
    )
    expect(constructionNoteDefinition.floorplanAffordances).toHaveProperty(
      'move-construction-note-curve',
    )
    expect(constructionNoteDefinition.floorplanAffordances).toHaveProperty(
      'move-construction-note-text',
    )
  })

  test('produces schema-valid defaults', () => {
    expect(
      constructionNoteDefinition.schema.safeParse({
        id: 'construction-note_default',
        type: 'construction-note',
        ...constructionNoteDefinition.defaults(),
      }).success,
    ).toBe(true)
  })
})
