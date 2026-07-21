import { describe, expect, test } from 'bun:test'
import { BuildingNode } from './building'
import { DrawingSheetNode } from './drawing-sheet'

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
      keyedNoteLegend: [],
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
      keyedNoteLegend: [{ key: 'A', text: 'ALIGN WITH EXISTING WALL.' }],
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
})
