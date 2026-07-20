import type { AnyNodeId, NodeDefinition } from '@pascal-app/core'
import { buildConstructionNoteFloorplan } from './floorplan'
import {
  moveConstructionNoteAnchorAffordance,
  moveConstructionNoteCurveAffordance,
  moveConstructionNoteTextAffordance,
} from './floorplan-affordances'
import { constructionNoteParametrics } from './parametrics'
import { ConstructionNoteNode } from './schema'

export const constructionNoteDefinition: NodeDefinition<typeof ConstructionNoteNode> = {
  kind: 'construction-note',
  bake: 'strip',
  schemaVersion: 2,
  schema: ConstructionNoteNode,
  category: 'analysis',
  snapProfile: 'structural',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    anchor: [0, 0],
    textPosition: [1.5, 0.75],
    text: 'CONSTRUCTION NOTE',
    terminator: 'arrow',
    leaderStyle: 'straight',
    curveControl: [0.5, 0.35],
    shoulderLength: 0.55,
    targetId: null,
    targetOffset: [0, 0],
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    deletable: true,
    duplicable: true,
    presettable: false,
  },

  parametrics: constructionNoteParametrics,
  dirtyTracking: false,
  floorplan: buildConstructionNoteFloorplan,
  floorplanDependencies: (node) => (node.targetId ? [node.targetId as AnyNodeId] : []),
  floorplanAffordances: {
    'move-construction-note-anchor': moveConstructionNoteAnchorAffordance,
    'move-construction-note-curve': moveConstructionNoteCurveAffordance,
    'move-construction-note-text': moveConstructionNoteTextAffordance,
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place leader anchor' },
    { key: 'Left click', label: 'Place note text' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Construction Note',
    description: 'Multiline floor-plan note with an associative straight or curved leader.',
    icon: { kind: 'iconify', name: 'lucide:message-square-text' },
    paletteSection: 'structure',
    paletteOrder: 95,
  },

  mcp: {
    description:
      'A floor-plan construction note with a straight or curved leader, shoulder, terminator, multiline text, and optional target-node attachment.',
  },
}
