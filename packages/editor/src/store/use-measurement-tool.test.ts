import { afterEach, describe, expect, test } from 'bun:test'
import {
  axisLockedMeasurementPoint,
  hydrateMeasurements,
  normalizePersistedMeasurements,
  serializeMeasurements,
  useMeasurementTool,
} from './use-measurement-tool'

afterEach(() => {
  useMeasurementTool.getState().clear()
})

describe('useMeasurementTool', () => {
  test('axisLockedMeasurementPoint constrains to the strongest drawing axis', () => {
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 2, 4], '2d')).toEqual([0, 0, 4])
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 2, 4], '3d')).toEqual([0, 0, 4])
    expect(axisLockedMeasurementPoint([0, 0, 0], [1, 5, 4], '3d')).toEqual([0, 5, 0])
  })

  test('commits point-to-point measurements and selects the new segment', () => {
    const measurement = useMeasurementTool.getState()
    measurement.begin('2d', [0, 0, 0])
    measurement.update([3, 0, 4])
    measurement.commit()

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]?.view).toBe('2d')
    expect(state.segments[0]?.start).toEqual([0, 0, 0])
    expect(state.segments[0]?.end).toEqual([3, 0, 4])
    expect(state.selectedId).toBe(state.segments[0]?.id ?? null)
  })

  test('adds every direct measurement kind and deletes the selected row', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [0, 0, 0], [2, 0, 0], 2)
    measurement.addArea('3d', [1, 0, 1], 12)
    measurement.addPerimeter('3d', [1, 0, 1], 14)
    measurement.beginAngle('3d', [1, 0, 0])
    measurement.commitAngle([0, 0, 0])
    measurement.commitAngle([0, 0, 1])

    const beforeDelete = useMeasurementTool.getState()
    expect(beforeDelete.segments).toHaveLength(1)
    expect(beforeDelete.areas).toHaveLength(1)
    expect(beforeDelete.perimeters).toHaveLength(1)
    expect(beforeDelete.angles).toHaveLength(1)
    expect(beforeDelete.selectedId).toBe(beforeDelete.angles[0]?.id ?? null)

    useMeasurementTool.getState().deleteSelected()
    const afterDelete = useMeasurementTool.getState()
    expect(afterDelete.angles).toHaveLength(0)
    expect(afterDelete.segments).toHaveLength(1)
    expect(afterDelete.areas).toHaveLength(1)
    expect(afterDelete.perimeters).toHaveLength(1)
    expect(afterDelete.selectedId).toBeNull()
  })

  test('clear removes drafts, cursor, selection, and all measurement collections', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.addArea('2d', [0, 0, 0], 8)
    measurement.addPerimeter('2d', [0, 0, 0], 12)
    measurement.beginAngle('2d', [1, 0, 0])
    measurement.commitAngle([0, 0, 0])
    measurement.updateAngle([0, 0, 1])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setCursor('2d', [0, 0, 2])

    measurement.clear()

    expect(useMeasurementTool.getState()).toMatchObject({
      angleDraft: null,
      angles: [],
      areas: [],
      cursor: null,
      draft: null,
      perimeters: [],
      selectedId: null,
      segments: [],
    })
  })

  test('mode changes cancel in-flight drafts and preserve measurement collections', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setMode('angle')

    expect(useMeasurementTool.getState().mode).toBe('angle')
    expect(useMeasurementTool.getState().draft).toBeNull()
    expect(useMeasurementTool.getState().angleDraft).toBeNull()
    expect(useMeasurementTool.getState().segments).toHaveLength(1)
    expect(useMeasurementTool.getState().selectedId).toBeNull()
  })

  test('serializes and hydrates committed measurements without transient draft state', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [0, 0, 0], [1, 0, 0])
    measurement.addArea('3d', [0.5, 0, 0.5], 6)
    measurement.addPerimeter('3d', [0.5, 0, 0.5], 10)
    measurement.beginAngle('2d', [1, 0, 0])
    measurement.commitAngle([0, 0, 0])
    measurement.commitAngle([0, 0, 1])
    measurement.begin('2d', [0, 0, 0])
    measurement.update([0, 0, 2])
    measurement.setCursor('2d', [0, 0, 2])

    const persisted = serializeMeasurements()
    useMeasurementTool.getState().clear()
    hydrateMeasurements(persisted)

    expect(useMeasurementTool.getState()).toMatchObject({
      angleDraft: null,
      areas: persisted.areas,
      cursor: null,
      draft: null,
      perimeters: persisted.perimeters,
      selectedId: null,
      segments: persisted.segments,
    })
    expect(useMeasurementTool.getState().angles).toEqual(persisted.angles)
  })

  test('normalizes invalid persisted measurement entries', () => {
    const persisted = normalizePersistedMeasurements({
      segments: [
        { id: 'measurement-1', start: [0, 0, 0], end: [1, 0, 0], view: '2d' },
        { id: 'bad-segment', start: [0, 0], end: [1, 0, 0], view: '2d' },
      ],
      areas: [
        { id: 'measurement-area-2', areaSquareMeters: 8, labelPoint: [0, 0, 0], view: '3d' },
        { id: 'bad-area', areaSquareMeters: Number.NaN, labelPoint: [0, 0, 0], view: '3d' },
      ],
      perimeters: [
        {
          id: 'measurement-perimeter-3',
          labelPoint: [0, 0, 0],
          lengthMeters: 12,
          view: '2d',
        },
        { id: 'bad-perimeter', labelPoint: [0, 0, 0], lengthMeters: 12, view: 'side' },
      ],
      angles: [
        {
          id: 'measurement-angle-4',
          first: [1, 0, 0],
          vertex: [0, 0, 0],
          second: [0, 0, 1],
          view: '3d',
        },
        {
          id: 'bad-angle',
          first: [1, 0, 0],
          vertex: [0, 0, 0],
          second: ['x', 0, 1],
          view: '3d',
        },
      ],
    })

    expect(persisted.segments).toHaveLength(1)
    expect(persisted.areas).toHaveLength(1)
    expect(persisted.perimeters).toHaveLength(1)
    expect(persisted.angles).toHaveLength(1)
  })
})
