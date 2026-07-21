import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { ConstructionDrawingType } from './construction-dimension'

const PositiveFinite = z.number().finite().positive()
const SheetCoordinate = z.number().finite().min(0)

export const DrawingSheetPaperSize = z.enum([
  'letter',
  'tabloid',
  'arch-a',
  'arch-b',
  'arch-c',
  'a4',
  'a3',
  'custom',
])
export const DrawingSheetOrientation = z.enum(['portrait', 'landscape'])
export const DrawingSheetScale = z.enum([
  '1:20',
  '1:25',
  '1:50',
  '1:75',
  '1:100',
  '1/8"=1\'-0"',
  '1/4"=1\'-0"',
  '1/2"=1\'-0"',
  '1"=1\'-0"',
])
export const DrawingSheetAnnotationProfile = z.enum([
  'architectural-default',
  'presentation',
  'permit',
])

export const DrawingSheetRect = z.object({
  x: SheetCoordinate.default(0),
  y: SheetCoordinate.default(0),
  width: PositiveFinite.default(1),
  height: PositiveFinite.default(1),
})

export const DrawingSheetPlacedView = z.object({
  id: objectId('drawing-view'),
  drawingType: ConstructionDrawingType.default('floor-plan'),
  drawingNumber: z.string().trim().min(1).max(24).default('1'),
  title: z.string().trim().min(1).max(80).default('Floor Plan'),
  levelId: objectId('level').nullable().default(null),
  scale: DrawingSheetScale.default('1/4"=1\'-0"'),
  viewport: DrawingSheetRect.default({ x: 0.5, y: 0.5, width: 7, height: 5 }),
  annotationProfile: DrawingSheetAnnotationProfile.default('architectural-default'),
  showNorthArrow: z.boolean().default(true),
  showGraphicScale: z.boolean().default(true),
})

export const DrawingSheetGeneralNote = z.object({
  id: objectId('sheet-note'),
  number: z.number().int().positive().default(1),
  text: z.string().trim().min(1).max(500).default('GENERAL NOTE'),
})

export const DrawingSheetGeneralNoteSet = z.object({
  id: objectId('sheet-note-set'),
  name: z.string().trim().min(1).max(80).default('General Notes'),
  notes: z.array(DrawingSheetGeneralNote).max(200).default([]),
})

export const DrawingSheetKeyedNote = z.object({
  key: z.string().trim().min(1).max(16).default('1'),
  text: z.string().trim().min(1).max(500).default('KEYED NOTE'),
})

export const DrawingSheetKeyedNoteDefinition = z.object({
  id: objectId('keyed-note'),
  key: z.string().trim().min(1).max(16).default('1'),
  text: z.string().trim().min(1).max(500).default('KEYED NOTE'),
})

export const DrawingSheetKeyedNoteInstance = z.object({
  id: objectId('keyed-note-instance'),
  definitionId: DrawingSheetKeyedNoteDefinition.shape.id,
  placedViewId: DrawingSheetPlacedView.shape.id.nullable().default(null),
  position: z.tuple([SheetCoordinate, SheetCoordinate]).default([0.5, 0.5]),
})

export const DrawingSheetDocumentMarkerKind = z.enum([
  'wall-tag',
  'glazing-tag',
  'assembly-tag',
  'section-callout',
  'elevation-callout',
  'detail-reference',
  'delta-marker',
  'revision-cloud',
])

export const DrawingSheetDocumentMarker = z.object({
  id: objectId('sheet-marker'),
  kind: DrawingSheetDocumentMarkerKind.default('detail-reference'),
  placedViewId: DrawingSheetPlacedView.shape.id.nullable().default(null),
  label: z.string().trim().min(1).max(32).default('1'),
  title: z.string().trim().max(120).default(''),
  sheetReference: z.string().trim().max(24).default(''),
  drawingReference: z.string().trim().max(24).default(''),
  revisionId: z.string().trim().max(16).default(''),
  position: z.tuple([SheetCoordinate, SheetCoordinate]).default([0.5, 0.5]),
  endPosition: z.tuple([SheetCoordinate, SheetCoordinate]).nullable().default(null),
  points: z
    .array(z.tuple([SheetCoordinate, SheetCoordinate]))
    .max(64)
    .default([]),
})

export const DrawingSheetSchedulePlacement = z.object({
  id: objectId('sheet-schedule'),
  scheduleType: z.enum(['room', 'door', 'window', 'finish', 'custom']).default('room'),
  title: z.string().trim().min(1).max(80).default('Room Schedule'),
  region: DrawingSheetRect.default({ x: 0.5, y: 6, width: 4, height: 1.5 }),
})

export const DrawingSheetTitleBlock = z.object({
  projectName: z.string().trim().max(120).default(''),
  projectNumber: z.string().trim().max(40).default(''),
  clientName: z.string().trim().max(120).default(''),
  drawnBy: z.string().trim().max(40).default(''),
  checkedBy: z.string().trim().max(40).default(''),
  issueDate: z.string().trim().max(40).default(''),
  revision: z.string().trim().max(20).default(''),
})

const DEFAULT_DRAWING_SHEET_TITLE_BLOCK: DrawingSheetTitleBlock = {
  projectName: '',
  projectNumber: '',
  clientName: '',
  drawnBy: '',
  checkedBy: '',
  issueDate: '',
  revision: '',
}

export const DrawingSheetNode = BaseNode.extend({
  id: objectId('drawing-sheet'),
  type: nodeType('drawing-sheet'),
  sheetNumber: z.string().trim().min(1).max(24).default('A1.0'),
  sheetTitle: z.string().trim().min(1).max(100).default('Floor Plan'),
  paperSize: DrawingSheetPaperSize.default('arch-b'),
  orientation: DrawingSheetOrientation.default('landscape'),
  customPaperWidth: PositiveFinite.nullable().default(null),
  customPaperHeight: PositiveFinite.nullable().default(null),
  placedViews: z.array(DrawingSheetPlacedView).max(32).default([]),
  annotationProfile: DrawingSheetAnnotationProfile.default('architectural-default'),
  generalNoteSetIds: z.array(DrawingSheetGeneralNoteSet.shape.id).max(32).default([]),
  generalNoteSets: z.array(DrawingSheetGeneralNoteSet).max(64).default([]),
  generalNotes: z.array(DrawingSheetGeneralNote).max(200).default([]),
  keyedNoteDefinitions: z.array(DrawingSheetKeyedNoteDefinition).max(200).default([]),
  keyedNoteInstances: z.array(DrawingSheetKeyedNoteInstance).max(500).default([]),
  keyedNoteLegend: z.array(DrawingSheetKeyedNote).max(200).default([]),
  documentMarkers: z.array(DrawingSheetDocumentMarker).max(500).default([]),
  schedules: z.array(DrawingSheetSchedulePlacement).max(32).default([]),
  titleBlock: DrawingSheetTitleBlock.default(DEFAULT_DRAWING_SHEET_TITLE_BLOCK),
}).describe(
  dedent`
  Drawing sheet node - persistent construction-document sheet metadata
  - sheetNumber/sheetTitle: sheet identity in the drawing set
  - paperSize/orientation/customPaperWidth/customPaperHeight: plotted sheet definition
  - placedViews: drawing views with numbers, titles, fixed scales, viewport regions, and annotation profiles
  - generalNoteSets/generalNoteSetIds/generalNotes: reusable project notes plus sheet-level numbered notes
  - keyedNoteDefinitions/keyedNoteInstances/keyedNoteLegend: stable keyed notes, repeated symbols, and legacy legend entries
  - documentMarkers: wall/glazing/assembly tags, callouts, detail references, deltas, and revision clouds
  - schedules/titleBlock: sheet-level documentation content and title-block metadata
  `,
)

export type DrawingSheetPaperSize = z.infer<typeof DrawingSheetPaperSize>
export type DrawingSheetOrientation = z.infer<typeof DrawingSheetOrientation>
export type DrawingSheetScale = z.infer<typeof DrawingSheetScale>
export type DrawingSheetAnnotationProfile = z.infer<typeof DrawingSheetAnnotationProfile>
export type DrawingSheetRect = z.infer<typeof DrawingSheetRect>
export type DrawingSheetPlacedView = z.infer<typeof DrawingSheetPlacedView>
export type DrawingSheetGeneralNote = z.infer<typeof DrawingSheetGeneralNote>
export type DrawingSheetGeneralNoteSet = z.infer<typeof DrawingSheetGeneralNoteSet>
export type DrawingSheetKeyedNote = z.infer<typeof DrawingSheetKeyedNote>
export type DrawingSheetKeyedNoteDefinition = z.infer<typeof DrawingSheetKeyedNoteDefinition>
export type DrawingSheetKeyedNoteInstance = z.infer<typeof DrawingSheetKeyedNoteInstance>
export type DrawingSheetDocumentMarker = z.infer<typeof DrawingSheetDocumentMarker>
export type DrawingSheetDocumentMarkerKind = z.infer<typeof DrawingSheetDocumentMarkerKind>
export type DrawingSheetSchedulePlacement = z.infer<typeof DrawingSheetSchedulePlacement>
export type DrawingSheetTitleBlock = z.infer<typeof DrawingSheetTitleBlock>
export type DrawingSheetNode = z.infer<typeof DrawingSheetNode>
