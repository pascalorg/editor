import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import useEditor from '../../../store/use-editor'
import { collectSelectableCandidateIds } from './select-candidates'

function registerSelectableElevatorTestKind() {
  if (nodeRegistry.has('elevator')) return

  registerNode({
    kind: 'elevator',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('elevator') }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { selectable: {} },
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

describe('selectable candidates', () => {
  beforeAll(() => {
    registerSelectableElevatorTestKind()
  })

  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    useViewer.setState({
      selection: {
        buildingId: 'building_test',
        levelId: 'level_test',
        zoneId: null,
        selectedIds: [],
      },
      previewSelectedIds: [],
    })
    useEditor.setState({
      phase: 'structure',
      structureLayer: 'elements',
    })
  })

  test('includes building-scoped elevators for the active level building', () => {
    useScene.setState({
      nodes: {
        building_test: {
          id: 'building_test',
          type: 'building',
          children: ['level_test', 'elevator_test'],
        },
        level_test: {
          id: 'level_test',
          type: 'level',
          parentId: 'building_test',
          children: [],
        },
        elevator_test: {
          id: 'elevator_test',
          type: 'elevator',
          parentId: 'building_test',
          position: [1, 0, 2],
          rotation: 0,
        },
      } as unknown as Record<string, AnyNode>,
    } as never)

    expect(collectSelectableCandidateIds()).toContain('elevator_test')
  })

  test('includes legacy level-parented elevators already loaded in the editor', () => {
    useScene.setState({
      nodes: {
        building_test: {
          id: 'building_test',
          type: 'building',
          children: ['level_test'],
        },
        level_test: {
          id: 'level_test',
          type: 'level',
          parentId: 'building_test',
          children: ['elevator_test'],
        },
        elevator_test: {
          id: 'elevator_test',
          type: 'elevator',
          parentId: 'level_test',
          position: [1, 0, 2],
          rotation: 0,
        },
      } as unknown as Record<string, AnyNode>,
    } as never)

    expect(collectSelectableCandidateIds()).toContain('elevator_test')
  })
})
