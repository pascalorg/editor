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
    // 3D model rendering
    model: {
      url: '/models/Door.glb',
      scale: 2, // Scale from existing Door component
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

export const DoorMetadata = {
  id: 'core.door',
  tags: ['opening', 'entry', 'access'],
  description: 'Standard hinged door',
  defaultWidth: 1.0, // meters
  defaultHeight: 2.1, // meters
}
