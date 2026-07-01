import type {
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  NodeDefinition,
} from '@pascal-app/core'
import { buildCabinetFloorplan, buildCabinetModuleFloorplan } from './floorplan'
import { buildCabinetGeometry } from './geometry'
import { cabinetModuleParametrics, cabinetParametrics } from './parametrics'
import { CabinetModuleNode, CabinetNode } from './schema'

export const cabinetDefinition: NodeDefinition<typeof CabinetNode> = {
  kind: 'cabinet',
  schemaVersion: 1,
  schema: CabinetNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    runTier: 'base',
    children: [],
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0.1,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0.02,
    countertopOverhang: 0.02,
    frontThickness: 0.018,
    frontGap: 0.003,
    doorStyle: 'double',
    handleStyle: 'bar',
    withBottomPanel: true,
    showPlinth: true,
    withCountertop: true,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    surfaces: {
      top: {
        height: (node) => {
          const n = node as CabinetNodeType
          return n.plinthHeight + n.carcassHeight + (n.withCountertop ? n.countertopThickness : 0)
        },
      },
    },
    floorPlaced: {
      footprint: (node) => {
        const n = node as CabinetNodeType
        return {
          dimensions: [
            n.width,
            (n.showPlinth ? n.plinthHeight : 0) +
              n.carcassHeight +
              (n.withCountertop ? n.countertopThickness : 0),
            n.depth,
          ] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
  },

  parametrics: cabinetParametrics,
  geometry: buildCabinetGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.width,
      n.depth,
      n.carcassHeight,
      n.runTier,
      n.operationState,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.frontThickness,
      n.frontGap,
      n.doorStyle,
      n.handleStyle,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place cabinet' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],

  presentation: {
    label: 'Modular Cabinet',
    description: 'A configurable parametric base cabinet.',
    icon: { kind: 'url', src: '/icons/furniture.webp' },
    paletteSection: 'furnish',
    paletteOrder: 34,
  },

  mcp: {
    description:
      'A configurable parametric base cabinet with plinth, carcass, front panels, optional countertop, and editable dimensions.',
  },
}

export const cabinetModuleDefinition: NodeDefinition<typeof CabinetModuleNode> = {
  kind: 'cabinet-module',
  schemaVersion: 1,
  schema: CabinetModuleNode,
  category: 'furnish',
  surfaceRole: 'joinery',
  snapProfile: 'item',
  facingIndicator: true,

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    children: [],
    cabinetType: 'base',
    width: 0.6,
    depth: 0.58,
    carcassHeight: 0.72,
    operationState: 0,
    plinthHeight: 0,
    toeKickDepth: 0.075,
    boardThickness: 0.018,
    countertopThickness: 0,
    countertopOverhang: 0.02,
    frontThickness: 0.018,
    frontGap: 0.003,
    doorStyle: 'double',
    handleStyle: 'bar',
    withBottomPanel: true,
    showPlinth: false,
    withCountertop: false,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprint: (node) => {
        const n = node as CabinetModuleNodeType
        return {
          dimensions: [
            n.width,
            (n.showPlinth ? n.plinthHeight : 0) +
              n.carcassHeight +
              (n.withCountertop ? n.countertopThickness : 0),
            n.depth,
          ] as [number, number, number],
          rotation: [0, n.rotation, 0] as [number, number, number],
        }
      },
      collides: true,
    },
  },

  parametrics: cabinetModuleParametrics,
  geometry: buildCabinetGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.cabinetType,
      n.width,
      n.depth,
      n.carcassHeight,
      n.operationState,
      n.plinthHeight,
      n.toeKickDepth,
      n.boardThickness,
      n.countertopThickness,
      n.countertopOverhang,
      n.frontThickness,
      n.frontGap,
      n.doorStyle,
      n.handleStyle,
      n.withBottomPanel,
      n.showPlinth,
      n.withCountertop,
      JSON.stringify(n.children ?? []),
      JSON.stringify(n.stack ?? null),
    ]),
  floorplan: buildCabinetModuleFloorplan,

  presentation: {
    label: 'Cabinet Module',
    description: 'An editable module inside a modular cabinet run.',
    icon: { kind: 'url', src: '/icons/furniture.webp' },
    paletteSection: 'furnish',
    paletteOrder: 35,
  },

  mcp: {
    description: 'A single editable cabinet module inside a modular cabinet run.',
  },
}
