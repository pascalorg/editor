// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import useViewer from './use-viewer'

const resetMeasurementPreferences = () => {
  useViewer.setState({
    externalSelectedIds: [],
    projectId: null,
    projectPreferences: {},
    showMeasurements: true,
    unit: 'metric',
    metricNotation: 'meters',
  })
}

beforeEach(resetMeasurementPreferences)
afterEach(resetMeasurementPreferences)

describe('measurement display preferences', () => {
  test('stores global visibility per project and defaults new projects to visible', () => {
    const viewer = useViewer.getState()
    viewer.setProjectId('project-a')
    viewer.setShowMeasurements(false)

    expect(useViewer.getState()).toMatchObject({
      projectId: 'project-a',
      showMeasurements: false,
      projectPreferences: {
        'project-a': { showMeasurements: false },
      },
    })

    useViewer.getState().setProjectId('project-b')
    expect(useViewer.getState().showMeasurements).toBe(true)

    useViewer.getState().setProjectId('project-a')
    expect(useViewer.getState().showMeasurements).toBe(false)
  })

  test('changes display units without changing measurement visibility preferences', () => {
    const viewer = useViewer.getState()
    viewer.setProjectId('project-a')
    viewer.setShowMeasurements(false)
    const preferences = useViewer.getState().projectPreferences

    useViewer.getState().setUnit('imperial')

    expect(useViewer.getState().unit).toBe('imperial')
    expect(useViewer.getState().projectPreferences).toEqual(preferences)
    expect(useViewer.getState().showMeasurements).toBe(false)
  })

  test('selects millimeters as a metric display notation', () => {
    useViewer.getState().setUnit('imperial')
    useViewer.getState().setMetricNotation('millimeters')

    expect(useViewer.getState()).toMatchObject({
      unit: 'metric',
      metricNotation: 'millimeters',
      unitExplicit: true,
    })
  })
})

describe('external selection highlights', () => {
  test('tracks host-owned highlights without changing the local selection', () => {
    const localSelection = useViewer.getState().selection

    useViewer.getState().setExternalSelectedIds(['wall_remote'])

    expect(useViewer.getState().externalSelectedIds).toEqual(['wall_remote'])
    expect(useViewer.getState().selection).toBe(localSelection)
  })
})
