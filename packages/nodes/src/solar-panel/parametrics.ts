import type { ParametricDescriptor } from '@pascal-app/core'
import type { SolarPanelNode } from './schema'

export const solarPanelParametrics: ParametricDescriptor<SolarPanelNode> = {
  groups: [
    {
      label: 'Preset',
      fields: [
        // Treated as an enum field; the picker labels live in
        // `solar-panel-presets.ts`. The framework's preset picker
        // syncs the four dims via `derive` (TODO once derive is wired
        // for inspector edits) — until then, picking a preset is
        // a marker only; the dims editor below is authoritative.
        {
          key: 'panelTypePreset',
          kind: 'enum',
          options: ['residential', 'residential-large', 'compact', 'frameless'],
          display: 'select',
        },
      ],
    },
    {
      label: 'Grid',
      fields: [
        { key: 'rows', kind: 'number', min: 1, max: 20, step: 1 },
        { key: 'columns', kind: 'number', min: 1, max: 20, step: 1 },
      ],
    },
    {
      label: 'Panel dimensions',
      fields: [
        { key: 'panelWidth', kind: 'number', unit: 'm', min: 0.4, max: 2, step: 0.01 },
        { key: 'panelHeight', kind: 'number', unit: 'm', min: 0.4, max: 2.5, step: 0.01 },
        { key: 'gapX', kind: 'number', unit: 'm', min: 0, max: 0.2, step: 0.005 },
        { key: 'gapY', kind: 'number', unit: 'm', min: 0, max: 0.2, step: 0.005 },
      ],
    },
    {
      label: 'Mounting',
      fields: [
        {
          key: 'mountingType',
          kind: 'enum',
          options: ['flush', 'tilted'],
          display: 'segmented',
        },
        {
          key: 'tiltAngle',
          kind: 'number',
          unit: '°',
          min: 0,
          max: 45,
          step: 1,
          visibleIf: (n) => n.mountingType === 'tilted',
        },
        { key: 'standoffHeight', kind: 'number', unit: 'm', min: 0, max: 0.3, step: 0.01 },
      ],
    },
    {
      label: 'Frame',
      fields: [
        { key: 'frameThickness', kind: 'number', unit: 'm', min: 0, max: 0.1, step: 0.005 },
        { key: 'frameDepth', kind: 'number', unit: 'm', min: 0.005, max: 0.1, step: 0.005 },
      ],
    },
  ],
}
