import type { ParametricDescriptor } from '@pascal-app/core'
import type { SolarPanelNode } from './schema'

export const solarPanelParametrics: ParametricDescriptor<SolarPanelNode> = {
  // Bespoke panel ported from the archive — preset cards, auto-fit,
  // and flip orientation can't be expressed by auto-derived groups.
  // `groups` stays declared so the MCP path keeps a structured view.
  customPanel: () => import('./panel'),
  groups: [
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
