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
    // Roofs use custom geometry (pitched roof segments)
    // This will be handled specially in the roof renderer
    geometry: {
      type: 'extrusion',
      dimensions: {
        height: 2.5, // Peak height
      },
    },
    
    material: {
      color: '#8b4513',
      emissive: '#8b4513',
      emissiveIntensity: 0,
      metalness: 0.2,
      roughness: 0.8,
    },
    
    selection: {
      color: '#ffffff',
      emissiveIntensity: 0.4,
      style: 'outline',
      outlineWidth: 0.03,
    },
    
    hover: {
      emissiveIntensity: 0.2,
    },
    
    preview: {
      validColor: '#44ff44',
      invalidColor: '#ff4444',
      opacity: 0.4,
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
