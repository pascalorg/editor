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
    // Procedural cylinder geometry
    geometry: {
      type: 'cylinder',
      dimensions: {
        radius: 0.15, // 15cm radius (0.3m diameter)
        height: 2.7, // Default height from metadata
        radialSegments: 16,
      },
    },

    // Material properties
    material: {
      color: '#aaaabf',
      emissive: '#aaaabf',
      emissiveIntensity: 0,
      metalness: 0.1,
      roughness: 0.7,
    },

    // Selection appearance - rings at top/bottom + vertical edges
    selection: {
      color: '#ffffff',
      emissiveIntensity: 0.5,
      style: 'edges',
      outlineWidth: 0.02, // 2cm outline width
    },

    // Hover appearance
    hover: {
      emissiveIntensity: 0.3,
    },

    // Preview during placement
    preview: {
      validColor: '#44ff44',
      invalidColor: '#ff4444',
      opacity: 0.5,
      showOccluded: true,
      occludedOpacity: 0.15,
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
