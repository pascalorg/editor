import { afterEach, describe, expect, test } from 'bun:test'
import { useViewer } from '@pascal-app/viewer'
import useMeasurementInput from '../store/use-measurement-input'
import { resolveSurfacePlanPointSnap } from './surface-plan-snap'

// Polygon drafting (slab / ceiling / zone / roof) shares one resolver, so a
// typed edge length reaches all of them from here. `previousPoint` is the vertex
// the edge starts from; without it typed lengths simply stay inactive.

function type(text: string) {
  useMeasurementInput.setState({ buffer: text, field: 'length' })
}

afterEach(() => {
  useMeasurementInput.setState({ buffer: '', field: 'length' })
  useViewer.setState({ unit: 'metric', metricNotation: 'meters' })
})

describe('typed edge length in polygon drafting', () => {
  test('places the vertex at exactly the typed distance from the previous one', () => {
    type('4.2')
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10, 0],
      previousPoint: [0, 0],
      walls: [],
      magnetic: false,
      align: false,
    })
    expect(result.point[0]).toBeCloseTo(4.2, 6)
    expect(result.point[1]).toBeCloseTo(0, 6)
  })

  test('keeps the cursor direction, replacing only the distance', () => {
    type('10')
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [3, 4],
      previousPoint: [0, 0],
      walls: [],
      magnetic: false,
      align: false,
    })
    expect(result.point[0]).toBeCloseTo(6, 6)
    expect(result.point[1]).toBeCloseTo(8, 6)
  })

  test('reads a bare number in the viewer display unit', () => {
    useViewer.setState({ unit: 'metric', metricNotation: 'millimeters' })
    type('4200')
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10, 0],
      previousPoint: [0, 0],
      walls: [],
      magnetic: false,
      align: false,
    })
    expect(result.point[0]).toBeCloseTo(4.2, 6)
  })

  test('the first vertex has nothing to measure from, so the cursor wins', () => {
    type('4.2')
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [10, 0],
      walls: [],
      magnetic: false,
      align: false,
    })
    expect(result.point[0]).toBeCloseTo(10, 6)
  })

  test('an empty buffer leaves the resolver untouched', () => {
    const result = resolveSurfacePlanPointSnap({
      rawPoint: [4.13, 0],
      previousPoint: [0, 0],
      walls: [],
      magnetic: false,
      align: false,
    })
    expect(result.point[0]).toBeCloseTo(4.13, 6)
  })
})
