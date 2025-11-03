/**
 * Door Element Specification
 */

import type { ElementSpec } from '@/lib/engine'

export const DoorSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.door',
  label: 'Door',
  category: 'openings',

  node: {
    gridItem: true,
    defaults: {
      size_m: [1.0, 0.2], // 1m width, 0.2m depth (matches wall thickness)
      rotation_rad: 0,
    },
    parentRules: ['wall'],
  },

  render: {
    model: {
      url: '/models/Door.glb',
      scale: 1,
      upAxis: 'Y',
    },
    anchor: 'center',
  },

  bounds: {
    strategy: 'orientedRectFromSize',
  },

  footprint: {
    strategy: 'rectFromSize',
  },

  snap: {
    gridStep_m: 0.5,
    allowedAngles_rad: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    targets: ['wallMount'],
    radius_m: 0.5,
    priority: ['wallLine'],
  },
}

export const DoorMetadata = {
  id: 'core.door',
  tags: ['opening', 'entry', 'access'],
  description: 'Standard hinged door',
  defaultWidth: 1.0, // meters
  defaultHeight: 2.1, // meters
}
