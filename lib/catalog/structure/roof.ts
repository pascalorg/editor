/**
 * Roof Element Specification
 */

import type { ElementSpec } from '@/lib/engine'

export const RoofSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.roof',
  label: 'Roof',
  category: 'structure',

  node: {
    gridItem: true,
    defaults: {
      size_m: [4.0, 4.0], // 4m x 4m
      rotation_rad: 0,
    },
    parentRules: ['level', 'group'],
  },

  render: {
    color: '#8b4513', // Brown
  },

  bounds: {
    strategy: 'orientedRectFromSize',
  },

  footprint: {
    strategy: 'rectFromSize',
  },

  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4],
    targets: ['gridFloor'],
    radius_m: 1.0,
    priority: ['gridPoint'],
  },
}

export const RoofMetadata = {
  id: 'core.roof',
  tags: ['structural', 'cover', 'shelter'],
  description: 'Pitched roof',
  defaultPitch: 30, // degrees
  defaultHeight: 2.5, // meters (peak height)
}
