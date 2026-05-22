import { z } from 'zod'

// Vendor-neutral visual presets. Picking one writes the four `panelWidth`,
// `panelHeight`, `frameThickness`, `frameDepth` fields onto a SolarPanelNode.
// Manually editing any of those four fields clears the preset back to undefined
// ("Custom") so the schema's `panelTypePreset` always matches the dims.

export const SolarPanelPresetKey = z.enum([
  'residential',
  'residential-large',
  'compact',
  'frameless',
])
export type SolarPanelPresetKey = z.infer<typeof SolarPanelPresetKey>

export type SolarPanelPresetDims = {
  panelWidth: number
  panelHeight: number
  frameThickness: number
  frameDepth: number
}

export const SOLAR_PANEL_PRESETS: Record<SolarPanelPresetKey, SolarPanelPresetDims> = {
  residential: {
    panelWidth: 1.0,
    panelHeight: 1.65,
    frameThickness: 0.04,
    frameDepth: 0.04,
  },
  'residential-large': {
    panelWidth: 1.0,
    panelHeight: 2.0,
    frameThickness: 0.04,
    frameDepth: 0.04,
  },
  compact: {
    panelWidth: 0.83,
    panelHeight: 1.0,
    frameThickness: 0.03,
    frameDepth: 0.035,
  },
  frameless: {
    panelWidth: 1.0,
    panelHeight: 1.65,
    frameThickness: 0.005,
    frameDepth: 0.025,
  },
}

export const SOLAR_PANEL_PRESET_LABELS: Record<SolarPanelPresetKey, string> = {
  residential: 'Residential',
  'residential-large': 'Residential Large',
  compact: 'Compact',
  frameless: 'Frameless',
}
