/**
 * Window Element Specification
 */

import type { ElementSpec } from '@/lib/engine'

export const WindowSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.window',
  label: 'Window',
  category: 'openings',

  node: {
    gridItem: true,
    defaults: {
      size_m: [1.2, 0.2], // 1.2m width, 0.2m depth (matches wall thickness)
      rotation_rad: 0,
    },
    parentRules: ['wall'],
  },

  render: {
    model: {
      url: '/models/Window.glb',
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

export const WindowMetadata = {
  id: 'core.window',
  tags: ['opening', 'light', 'ventilation'],
  description: 'Standard window',
  defaultWidth: 1.2, // meters
  defaultHeight: 1.2, // meters
  sillHeight: 0.9, // meters from floor
}
