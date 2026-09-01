import type { ParametricDescriptor } from '@pascal-app/core'
import type { ChimneyNode } from './schema'

export const chimneyParametrics: ParametricDescriptor<ChimneyNode> = {
  // The chimney panel is a bespoke tabbed UI (Cap / Flues / Shoulder /
  // Bands / Cricket / Panels) ported from the archive — auto-derived
  // groups can't reproduce its layout. `groups` stays declared for the
  // MCP path and for any future fallback consumer, but the inspector
  // mounts the custom panel.
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Body',
      fields: [
        {
          key: 'bodyShape',
          kind: 'enum',
          options: ['square', 'round'],
          optionLabelKeys: {
            "square": "nodes.chimney.square",
            "round": "nodes.chimney.round"
          },
          display: 'segmented',
        },
        { key: 'width', kind: 'number', unit: 'm', min: 0.2, max: 1000, step: 0.05 },
        {
          key: 'depth',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 1000,
          step: 0.05,
          visibleIf: (n) => n.bodyShape === 'square',
        },
        { key: 'heightAboveRidge', kind: 'number', unit: 'm', min: 0.2, max: 1000, step: 0.05 },
        {
          key: 'cornerBevel',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.1,
          step: 0.005,
          visibleIf: (n) => n.bodyShape === 'square',
        },
      ],
    },
    {
      label: 'Shoulder',
      fields: [
        {
          key: 'shoulderStyle',
          kind: 'enum',
          options: ['none', 'tapered', 'corbeled'],
          optionLabelKeys: {
            "none": "nodes.chimney.none",
            "tapered": "nodes.chimney.tapered",
            "corbeled": "nodes.chimney.corbeled"
          },
          display: 'segmented',
        },
        {
          key: 'shoulderHeight',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1.5,
          step: 0.05,
          visibleIf: (n) => n.shoulderStyle !== 'none',
        },
        {
          key: 'shoulderExtent',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.5,
          step: 0.01,
          visibleIf: (n) => n.shoulderStyle !== 'none',
        },
      ],
    },
    {
      label: 'Cap',
      fields: [
        { key: 'cap', kind: 'boolean' },
        {
          key: 'capShape',
          kind: 'enum',
          options: ['none', 'sloped', 'flat', 'stepped'],
          optionLabelKeys: {
            "none": "nodes.chimney.none",
            "sloped": "nodes.chimney.sloped",
            "flat": "nodes.chimney.flat",
            "stepped": "nodes.chimney.stepped"
          },
          display: 'segmented',
          visibleIf: (n) => n.cap === true,
        },
        {
          key: 'capOverhang',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.2,
          step: 0.01,
          visibleIf: (n) => n.cap === true && n.capShape !== 'none',
        },
        {
          key: 'capThickness',
          kind: 'number',
          unit: 'm',
          min: 0.02,
          max: 0.2,
          step: 0.005,
          visibleIf: (n) => n.cap === true && n.capShape !== 'none',
        },
      ],
    },
    {
      label: 'Flues',
      fields: [
        { key: 'flueCount', kind: 'number', min: 0, max: 4, step: 1 },
        {
          key: 'flueShape',
          kind: 'enum',
          options: ['round', 'square'],
          optionLabelKeys: {
            "round": "nodes.chimney.round",
            "square": "nodes.chimney.square"
          },
          display: 'segmented',
          visibleIf: (n) => n.flueCount > 0,
        },
        {
          key: 'flueHeight',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.8,
          step: 0.01,
          visibleIf: (n) => n.flueCount > 0,
        },
        {
          key: 'flueDiameter',
          kind: 'number',
          unit: 'm',
          min: 0.05,
          max: 0.4,
          step: 0.01,
          visibleIf: (n) => n.flueCount > 0,
        },
        {
          key: 'flueSpacing',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          visibleIf: (n) => n.flueCount > 1,
        },
      ],
    },
    {
      label: 'Cricket',
      fields: [
        {
          key: 'cricketStyle',
          kind: 'enum',
          options: ['none', 'simple'],
          optionLabelKeys: {
            "none": "nodes.chimney.none",
            "simple": "nodes.chimney.simple"
          },
          display: 'segmented',
          visibleIf: (n) => n.bodyShape === 'square',
        },
        {
          key: 'cricketSide',
          kind: 'enum',
          options: ['front', 'back'],
          optionLabelKeys: {
            "front": "nodes.chimney.front",
            "back": "nodes.chimney.back"
          },
          display: 'segmented',
          visibleIf: (n) => n.bodyShape === 'square' && n.cricketStyle !== 'none',
        },
        {
          key: 'cricketLength',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 2,
          step: 0.05,
          visibleIf: (n) => n.bodyShape === 'square' && n.cricketStyle !== 'none',
        },
        {
          key: 'cricketHeight',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 1,
          step: 0.05,
          visibleIf: (n) => n.bodyShape === 'square' && n.cricketStyle !== 'none',
        },
      ],
    },
  ],
}
