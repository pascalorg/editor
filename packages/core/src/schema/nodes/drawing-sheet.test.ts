import { describe, expect, test } from 'bun:test'
import { BuildingNode } from './building'
import { DrawingSheetNode, remapDrawingSheetReferences } from './drawing-sheet'

describe('DrawingSheetNode', () => {
  test('creates persistent sheet defaults', () => {
    const sheet = DrawingSheetNode.parse({})

    expect(sheet.type).toBe('drawing-sheet')
    expect(sheet.id).toMatch(/^drawing-sheet_/)
    expect(sheet).toMatchObject({
      sheetNumber: 'A1.0',
      sheetTitle: 'Floor Plan',
      paperSize: 'arch-b',
      orientation: 'landscape',
      customPaperWidth: null,
      customPaperHeight: null,
      annotationProfile: 'architectural-default',
      placedViews: [],
      generalNoteSetIds: [],
      generalNoteSets: [],
      generalNotes: [],
      keyedNoteDefinitions: [],
      keyedNoteInstances: [],
      keyedNoteLegend: [],
      documentMarkers: [],
      schedules: [],
      titleBlock: {
        projectName: '',
        projectNumber: '',
        clientName: '',
        drawnBy: '',
        checkedBy: '',
        issueDate: '',
        revision: '',
      },
    })
  })

  test('stores placed views, notes, schedules, and title-block metadata', () => {
    const sheet = DrawingSheetNode.parse({
      sheetNumber: 'A2.1',
      sheetTitle: 'Enlarged Plans',
      paperSize: 'custom',
      customPaperWidth: 24,
      customPaperHeight: 36,
      placedViews: [
        {
          id: 'drawing-view_main',
          drawingType: 'floor-plan',
          drawingNumber: '2',
          title: 'Main Floor Plan',
          levelId: 'level_main',
          scale: '1/4"=1\'-0"',
          viewport: { x: 1, y: 1, width: 12, height: 8 },
        },
      ],
      generalNoteSetIds: ['sheet-note-set_project'],
      generalNoteSets: [
        {
          id: 'sheet-note-set_project',
          name: 'Project Notes',
          notes: [{ id: 'sheet-note_project-1', number: 1, text: 'COORDINATE WITH OWNER.' }],
        },
      ],
      generalNotes: [{ id: 'sheet-note_1', number: 1, text: 'VERIFY DIMENSIONS.' }],
      keyedNoteDefinitions: [
        { id: 'keyed-note_patch-slab', key: 'A', text: 'PATCH EXISTING SLAB.' },
      ],
      keyedNoteInstances: [
        {
          id: 'keyed-note-instance_patch-slab-1',
          definitionId: 'keyed-note_patch-slab',
          placedViewId: 'drawing-view_main',
          position: [3.25, 2.5],
        },
        {
          id: 'keyed-note-instance_patch-slab-2',
          definitionId: 'keyed-note_patch-slab',
          position: [5, 4],
        },
      ],
      keyedNoteLegend: [{ key: 'A', text: 'ALIGN WITH EXISTING WALL.' }],
      documentMarkers: [
        {
          id: 'sheet-marker_wall-a',
          kind: 'wall-tag',
          label: 'W1',
          placedViewId: 'drawing-view_main',
          position: [2, 3],
        },
        {
          id: 'sheet-marker_revision-a',
          kind: 'revision-cloud',
          label: '1',
          revisionId: 'A',
          points: [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
          ],
        },
      ],
      schedules: [
        {
          id: 'sheet-schedule_room',
          scheduleType: 'room',
          title: 'Room Schedule',
          region: { x: 15, y: 1, width: 6, height: 5 },
        },
      ],
      titleBlock: {
        projectName: 'House',
        projectNumber: '2401',
        clientName: 'Owner',
      },
    })

    expect(sheet.placedViews[0]).toMatchObject({
      drawingType: 'floor-plan',
      levelId: 'level_main',
      annotationProfile: 'architectural-default',
      showNorthArrow: true,
      showGraphicScale: true,
    })
    expect(sheet.generalNotes[0]?.text).toBe('VERIFY DIMENSIONS.')
    expect(sheet.generalNoteSetIds).toEqual(['sheet-note-set_project'])
    expect(sheet.generalNoteSets[0]).toMatchObject({
      id: 'sheet-note-set_project',
      name: 'Project Notes',
      notes: [{ text: 'COORDINATE WITH OWNER.' }],
    })
    expect(sheet.keyedNoteLegend[0]).toEqual({
      key: 'A',
      text: 'ALIGN WITH EXISTING WALL.',
    })
    expect(sheet.keyedNoteDefinitions[0]).toEqual({
      id: 'keyed-note_patch-slab',
      key: 'A',
      text: 'PATCH EXISTING SLAB.',
    })
    expect(sheet.keyedNoteInstances).toHaveLength(2)
    expect(sheet.keyedNoteInstances[0]).toMatchObject({
      definitionId: 'keyed-note_patch-slab',
      placedViewId: 'drawing-view_main',
      position: [3.25, 2.5],
    })
    expect(sheet.keyedNoteInstances[1]?.placedViewId).toBeNull()
    expect(sheet.documentMarkers).toHaveLength(2)
    expect(sheet.documentMarkers[0]).toMatchObject({
      kind: 'wall-tag',
      label: 'W1',
      position: [2, 3],
    })
    expect(sheet.documentMarkers[1]).toMatchObject({
      kind: 'revision-cloud',
      revisionId: 'A',
      points: [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    })
    expect(sheet.schedules[0]?.title).toBe('Room Schedule')
    expect(sheet.titleBlock).toMatchObject({
      projectName: 'House',
      projectNumber: '2401',
      clientName: 'Owner',
      drawnBy: '',
    })
  })

  test('can live under a building instead of a level', () => {
    const sheet = DrawingSheetNode.parse({ id: 'drawing-sheet_a101' })

    expect(BuildingNode.parse({ children: ['level_main', sheet.id] }).children).toEqual([
      'level_main',
      sheet.id,
    ])
  })

  test('remaps sheet-local identities and their references together', () => {
    const sheet = DrawingSheetNode.parse({
      placedViews: [{ id: 'drawing-view_main', levelId: 'level_main' }],
      generalNoteSetIds: ['sheet-note-set_project'],
      generalNoteSets: [
        {
          id: 'sheet-note-set_project',
          notes: [{ id: 'sheet-note_set-1', number: 1, text: 'SET NOTE' }],
        },
      ],
      generalNotes: [{ id: 'sheet-note_sheet-1', number: 1, text: 'SHEET NOTE' }],
      keyedNoteDefinitions: [{ id: 'keyed-note_a', key: 'A', text: 'KEYED NOTE' }],
      keyedNoteInstances: [
        {
          id: 'keyed-note-instance_a1',
          definitionId: 'keyed-note_a',
          placedViewId: 'drawing-view_main',
        },
      ],
      documentMarkers: [{ id: 'sheet-marker_a', placedViewId: 'drawing-view_main', label: 'A' }],
      schedules: [{ id: 'sheet-schedule_a' }],
    })
    const remapped = remapDrawingSheetReferences(sheet, new Map([['level_main', 'level_cloned']]))

    expect(remapped.placedViews[0]?.id).not.toBe(sheet.placedViews[0]?.id)
    expect(remapped.placedViews[0]?.levelId).toBe('level_cloned')
    expect(remapped.generalNoteSetIds[0]).toBe(remapped.generalNoteSets[0]?.id)
    expect(remapped.generalNoteSets[0]?.notes[0]?.id).not.toBe(
      sheet.generalNoteSets[0]?.notes[0]?.id,
    )
    expect(remapped.generalNotes[0]?.id).not.toBe(sheet.generalNotes[0]?.id)
    expect(remapped.keyedNoteInstances[0]?.definitionId).toBe(remapped.keyedNoteDefinitions[0]?.id)
    expect(remapped.keyedNoteInstances[0]?.placedViewId).toBe(remapped.placedViews[0]?.id)
    expect(remapped.documentMarkers[0]?.placedViewId).toBe(remapped.placedViews[0]?.id)
    expect(remapped.keyedNoteInstances[0]?.id).not.toBe(sheet.keyedNoteInstances[0]?.id)
    expect(remapped.documentMarkers[0]?.id).not.toBe(sheet.documentMarkers[0]?.id)
    expect(remapped.schedules[0]?.id).not.toBe(sheet.schedules[0]?.id)
  })
})
