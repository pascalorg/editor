import { afterEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useMeasurementTool } from '../../../store/use-measurement-tool'
import { MeasurementHistoryPanel } from './measurement-history-panel'

afterEach(() => {
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  useMeasurementTool.getState().setAllSnapKindsEnabled(true)
})

describe('MeasurementHistoryPanel', () => {
  test('renders snap preset controls', () => {
    const markup = renderToStaticMarkup(
      createElement(MeasurementHistoryPanel, { portal: false, unit: 'metric' }),
    )

    expect(markup).toContain('Enable all measurement snap kinds')
    expect(markup).toContain('Disable all measurement snap kinds')
    expect(markup).toContain('Reset measurement snap kinds')
    expect(markup).toContain('Endpoint snaps')
    expect(markup).toContain('Surface distance snaps')
  })
})
