import { afterEach, describe, expect, test } from 'bun:test'
import type { QuickMeasurementReport } from '@pascal-app/core'
import { selectQuickMeasurementHudEntry, useQuickMeasurementHud } from './use-quick-measurement-hud'

const report = (title: string): QuickMeasurementReport => ({
  title,
  kindLabel: 'Wall',
  anchor: [0, 0, 0],
  metrics: [],
})

afterEach(() => {
  useQuickMeasurementHud.setState({
    activeSource: null,
    sources: { '2d': null, '3d': null },
  })
})

describe('quick measurement HUD ownership', () => {
  test('uses one active source across split view while single views stay pinned to their pane', () => {
    const twoDimensional = { lensState: 'live' as const, report: report('2D wall') }
    const threeDimensional = { lensState: 'pinned' as const, report: report('3D wall') }
    const store = useQuickMeasurementHud.getState()
    store.publish('2d', twoDimensional)
    store.publish('3d', threeDimensional)

    expect(selectQuickMeasurementHudEntry(useQuickMeasurementHud.getState(), 'split')).toBe(
      twoDimensional,
    )
    store.activate('3d')
    expect(selectQuickMeasurementHudEntry(useQuickMeasurementHud.getState(), 'split')).toBe(
      threeDimensional,
    )
    expect(selectQuickMeasurementHudEntry(useQuickMeasurementHud.getState(), '2d')).toBe(
      twoDimensional,
    )
    expect(selectQuickMeasurementHudEntry(useQuickMeasurementHud.getState(), '3d')).toBe(
      threeDimensional,
    )
  })

  test('falls back to the sibling only when the active source unmounts', () => {
    const store = useQuickMeasurementHud.getState()
    store.publish('2d', { lensState: 'pinned', report: report('2D wall') })
    store.publish('3d', { lensState: 'live', report: report('3D wall') })
    store.activate('3d')
    store.clear('3d')

    const state = useQuickMeasurementHud.getState()
    expect(state.activeSource).toBe('2d')
    expect(selectQuickMeasurementHudEntry(state, 'split')?.report.title).toBe('2D wall')
  })
})
