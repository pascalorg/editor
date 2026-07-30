import { describe, expect, test } from 'bun:test'
import { DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY } from './annotation-visibility'
import {
  isFloorplanToolAvailableInMode,
  normalizeFloorplanMode,
  normalizeFloorplanModesByProject,
  resolveFloorplanAnnotationVisibility,
  resolveFloorplanWallDimensionReference,
} from './floorplan-mode'

describe('floor-plan mode', () => {
  test('defaults unknown and missing values to Default', () => {
    expect(normalizeFloorplanMode(undefined)).toBe('default')
    expect(normalizeFloorplanMode('legacy')).toBe('default')
    expect(normalizeFloorplanMode('expert')).toBe('expert')
  })

  test('keeps only valid per-project preferences', () => {
    expect(
      normalizeFloorplanModesByProject({
        alpha: 'expert',
        beta: 'default',
        invalid: 'legacy',
        empty: null,
      }),
    ).toEqual({ alpha: 'expert', beta: 'default' })
  })

  test('limits tools only when their registry extension declares available modes', () => {
    expect(isFloorplanToolAvailableInMode(undefined, 'default')).toBe(true)
    expect(isFloorplanToolAvailableInMode(['expert'], 'default')).toBe(false)
    expect(isFloorplanToolAvailableInMode(['expert'], 'expert')).toBe(true)
    expect(isFloorplanToolAvailableInMode(['default', 'expert'], 'default')).toBe(true)
  })

  test('preserves the existing annotation profile in Expert', () => {
    const expertVisibility = {
      ...DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY,
      openingMarks: false,
      roomLabels: false,
    }

    expect(
      resolveFloorplanAnnotationVisibility('expert', expertVisibility, {
        selected: false,
        target: 'editor',
      }),
    ).toBe(expertVisibility)
  })

  test('keeps Default clean until an item is selected', () => {
    expect(
      resolveFloorplanAnnotationVisibility('default', DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, {
        selected: false,
        target: 'editor',
      }),
    ).toEqual({
      automaticDimensions: false,
      contextualDimensions: false,
      manualDimensions: false,
      measurements: false,
      openingMarks: false,
      structuralGrids: false,
      roomLabels: true,
      stairAnnotations: false,
    })

    expect(
      resolveFloorplanAnnotationVisibility('default', DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, {
        selected: true,
        target: 'editor',
      }),
    ).toMatchObject({
      automaticDimensions: false,
      contextualDimensions: true,
      manualDimensions: true,
      measurements: true,
    })
  })

  test('reveals a measurement when a referenced object is selected', () => {
    expect(
      resolveFloorplanAnnotationVisibility('default', DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, {
        referencedAnnotationRole: 'measurement',
        target: 'editor',
      }).measurements,
    ).toBe(true)
    expect(
      resolveFloorplanAnnotationVisibility('default', DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, {
        referencedAnnotationRole: 'manual-dimension',
        target: 'editor',
      }).manualDimensions,
    ).toBe(true)
  })

  test('exports Default without selection chrome or technical annotations', () => {
    expect(
      resolveFloorplanAnnotationVisibility('default', DEFAULT_FLOORPLAN_ANNOTATION_VISIBILITY, {
        selected: true,
        target: 'export',
      }),
    ).toEqual({
      automaticDimensions: false,
      contextualDimensions: false,
      manualDimensions: false,
      measurements: false,
      openingMarks: false,
      structuralGrids: false,
      roomLabels: true,
      stairAnnotations: false,
    })
  })

  test('uses centerline dimensions only in Default', () => {
    expect(resolveFloorplanWallDimensionReference('default', 'finished-faces')).toBe('centerline')
    expect(resolveFloorplanWallDimensionReference('expert', 'finished-faces')).toBe(
      'finished-faces',
    )
  })
})
