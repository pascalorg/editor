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
      scale: 2, // Scale from existing Window component
      upAxis: 'Y',
    },
    anchor: 'center',
    
    // Selection appearance - bounding box outline
    selection: {
      color: '#ffffff',
      emissiveIntensity: 0.5,
      style: 'box',
      outlineWidth: 0.02,
    },
    
    // Hover appearance
    hover: {
      emissiveIntensity: 0.3,
    },
    
    // Preview during placement
    preview: {
      validColor: '#44ff44',
      invalidColor: '#ff4444',
      opacity: 0.3,
      showOccluded: false,
    },
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
