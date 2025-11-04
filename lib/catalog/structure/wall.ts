/**
 * Wall Element Specification
 */

import type { ElementSpec } from '@/lib/engine'

export const WallSpec: ElementSpec = {
  schemaVersion: '1.0',
  type: 'structure.wall',
  label: 'Wall',
  category: 'structure',

  node: {
    gridItem: true,
    defaults: {
      size_m: [1, 0.2], // 1m length, 0.2m thickness
      rotation_rad: 0,
    },
    parentRules: ['level', 'group'],
  },

  render: {
    // Walls use custom extrusion geometry (mitered junctions)
    // This will be handled specially in the wall renderer
    geometry: {
      type: 'extrusion',
      dimensions: {
        height: 2.7, // Default wall height
      },
    },
    
    material: {
      color: '#e0e0e0',
      emissive: '#e0e0e0',
      emissiveIntensity: 0,
      metalness: 0.0,
      roughness: 0.9,
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
      opacity: 0.3,
      showOccluded: true,
      occludedOpacity: 0.1,
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
    priority: ['gridPoint', 'wallLine'],
  },

  physics: {
    shape: 'box',
    mass: 0, // Static
  },
}

export const WallMetadata = {
  id: 'core.wall',
  tags: ['structural', 'boundary', 'partition'],
  description: 'Standard interior/exterior wall',
  defaultHeight: 2.7, // meters
}
