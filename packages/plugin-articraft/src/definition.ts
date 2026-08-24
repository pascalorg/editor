import type { HandleDescriptor, NodeDefinition, ParametricDescriptor } from '@pascal-app/core'
import type { Object3D } from 'three'
import { bakeArticraftAnimation } from './animation'
import { ARTICRAFT_ICON } from './brand'
import { buildArticraftFloorplan } from './floorplan'
import { ArticraftAssetNode } from './schema'

type Definition = NodeDefinition<typeof ArticraftAssetNode> & Record<string, unknown>

const floorPlacement = {
  footprint: (value: unknown) => {
    const node = value as ArticraftAssetNode
    return {
      dimensions: [
        node.dimensions[0] * node.scale,
        node.dimensions[1] * node.scale,
        node.dimensions[2] * node.scale,
      ] as [number, number, number],
      rotation: node.rotation,
    }
  },
  collides: false,
}

const rotateHandle: HandleDescriptor<ArticraftAssetNode> = {
  kind: 'arc-resize',
  axis: 'angular',
  shape: 'rotate',
  apply: (initial, delta) => ({
    rotation: [initial.rotation[0], initial.rotation[1] - delta, initial.rotation[2]] as [
      number,
      number,
      number,
    ],
  }),
  placement: {
    position: (node) => {
      const radius = Math.max(node.dimensions[0], node.dimensions[2]) * node.scale * 0.65
      return [radius, 0.08, radius]
    },
    rotationY: () => -Math.PI / 4,
  },
  decoration: {
    kind: 'ring',
    radius: (node) => Math.max(node.dimensions[0], node.dimensions[2]) * node.scale * 0.65,
    y: () => 0.08,
  },
}

const parametrics: ParametricDescriptor<ArticraftAssetNode> = {
  groups: [],
  trailingSection: () => import('./joint-controls'),
}

export const articraftAssetDefinition: Definition = {
  kind: 'articraft:asset',
  schemaVersion: 1,
  schema: ArticraftAssetNode,
  category: 'furnish',
  snapProfile: 'item',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    catalogId: '',
    title: 'Articraft asset',
    source: 'articraft-10k',
    artifact: { format: 'urdf', url: 'https://example.invalid/model.urdf' },
    dimensions: [1, 1, 1],
    parts: [],
    joints: [],
    jointValues: {},
    motionEnabled: false,
    attribution: {
      creator: 'Articraft authors',
      license: 'CC-BY-4.0',
      sourceUrl: 'https://huggingface.co/datasets/camvsl/Articraft-10K',
    },
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    snappable: {},
    floorPlaced: floorPlacement,
    dragBounds: (value) => {
      const node = value as unknown as ArticraftAssetNode
      return {
        size: [
          node.dimensions[0] * node.scale,
          node.dimensions[1] * node.scale,
          node.dimensions[2] * node.scale,
        ],
      }
    },
  },
  parametrics,
  handles: [rotateHandle],
  floorplan: buildArticraftFloorplan,
  exportAnimation: (context: { node: ArticraftAssetNode; object: Object3D }) =>
    bakeArticraftAnimation(context.node, context.object),
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place articulated asset' },
    { key: 'Esc', label: 'Stop' },
  ],
  presentation: {
    label: 'Articraft asset',
    description: 'A poseable articulated URDF or USDZ asset from Articraft.',
    icon: ARTICRAFT_ICON,
    paletteSection: 'furnish',
    hidden: true,
  },
  mcp: {
    description:
      'A poseable Articraft asset. Stores an immutable artifact, rigid-part joint graph, per-joint revolute/continuous/prismatic pose values, and persistent motion state.',
  },
}
