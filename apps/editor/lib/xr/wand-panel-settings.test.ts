import { beforeEach, describe, expect, test } from 'bun:test'
import {
  useXRWandPanelSettings,
  XR_WAND_PANEL_SCALE_MAX,
  XR_WAND_PANEL_SCALE_MIN,
} from './wand-panel-settings'

describe('XR wand panel settings', () => {
  beforeEach(() => useXRWandPanelSettings.setState({ panelScale: 1 }))

  test('updates panel size in stable decimal steps', () => {
    const { setPanelScale } = useXRWandPanelSettings.getState()

    setPanelScale(1.1)
    expect(useXRWandPanelSettings.getState().panelScale).toBe(1.1)
    setPanelScale(1.200_000_000_000_000_2)
    expect(useXRWandPanelSettings.getState().panelScale).toBe(1.2)
  })

  test('clamps the reference project scale range and rejects non-finite input', () => {
    const { setPanelScale } = useXRWandPanelSettings.getState()

    setPanelScale(99)
    expect(useXRWandPanelSettings.getState().panelScale).toBe(XR_WAND_PANEL_SCALE_MAX)
    setPanelScale(0)
    expect(useXRWandPanelSettings.getState().panelScale).toBe(XR_WAND_PANEL_SCALE_MIN)
    setPanelScale(Number.NaN)
    expect(useXRWandPanelSettings.getState().panelScale).toBe(XR_WAND_PANEL_SCALE_MIN)
  })
})
