import { afterEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useMeasurementTool } from '../../../store/use-measurement-tool'
import {
  MeasurementHistoryPanel,
  parseLinearMeasurementInputToMeters,
} from './measurement-history-panel'

afterEach(() => {
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  useMeasurementTool.getState().setAllSnapKindsEnabled(true)
})

describe('MeasurementHistoryPanel', () => {
  test('renders snapping options as a closed accordion', () => {
    const markup = renderToStaticMarkup(
      createElement(MeasurementHistoryPanel, { portal: false, unit: 'metric' }),
    )

    expect(markup).toContain('Snapping options')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('Enable all measurement snap kinds')
    expect(markup).not.toContain('Disable all measurement snap kinds')
    expect(markup).not.toContain('Reset measurement snap kinds')
    expect(markup).not.toContain('Endpoint snaps')
    expect(markup).not.toContain('Surface distance snaps')
    expect(markup).toContain('Cycle measurement display precision')
    expect(markup).toContain('Chained measurements')
  })

  test('parses typed linear measurement units for exact length entry', () => {
    expect(parseLinearMeasurementInputToMeters('6 ft', 'metric')).toBeCloseTo(1.8288)
    expect(parseLinearMeasurementInputToMeters('180cm', 'metric')).toBeCloseTo(1.8)
    expect(parseLinearMeasurementInputToMeters('72in', 'imperial')).toBeCloseTo(1.8288)
  })

  test('treats bare linear measurement numbers as the active display unit', () => {
    expect(parseLinearMeasurementInputToMeters('2', 'metric')).toBeCloseTo(2)
    expect(parseLinearMeasurementInputToMeters('2', 'imperial')).toBeCloseTo(0.6096)
  })
})
