/**
 * Column Element Specification
 */

import type { ElementSpec } from '@/lib/engine'

export const ColumnSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.column',
  label: 'Column',
  category: 'structure',

  node: {
    gridItem: true,
    defaults: {
      size_m: [0.3, 0.3], // 0.3m x 0.3m
      rotation_rad: 0,
    },
    parentRules: ['level', 'group'],
  },

  render: {
    color: '#b0b0b0', // Gray
  },

  bounds: {
    strategy: 'orientedRectFromSize',
  },

  footprint: {
    strategy: 'rectFromSize',
  },

  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0],
    targets: ['gridFloor'],
    radius_m: 1.0,
    priority: ['gridPoint'],
  },

  physics: {
    shape: 'box',
    mass: 0, // Static
  },
}

export const ColumnMetadata = {
  id: 'core.column',
  tags: ['structural', 'support', 'vertical'],
  description: 'Structural column/pillar',
  defaultHeight: 2.7, // meters
}
