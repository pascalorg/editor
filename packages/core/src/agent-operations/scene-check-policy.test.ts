import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  ItemNode,
  LevelNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { usageIssues } from '../spatial/usage-field/findings'
import { setSdfChecks } from '../spatial/usage-field/flag'
import './index'
import { SCENE_CHECK_PROBATION, withoutProbation } from './scene-check-policy'
import type { SceneNodes } from './types'
import { verifyScene } from './verify-scene'

// A 6 x 4 m kitchen; its south wall is along z = 0, the room on the +z side of it.
function kitchen(extra: AnyNode[], wallChildren: string[] = []): SceneNodes {
  const nodes: AnyNode[] = [
    BuildingNode.parse({ id: 'building_1', children: ['level_1'] }),
    LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] }),
    SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [-0.3, -0.3],
        [6.3, -0.3],
        [6.3, 4.3],
        [-0.3, 4.3],
      ],
      elevation: 0.05,
    }),
    WallNode.parse({
      id: 'wall_s',
      parentId: 'level_1',
      start: [0, 0],
      end: [6, 0],
      thickness: 0.1,
      children: wallChildren,
    }),
    WallNode.parse({
      id: 'wall_e',
      parentId: 'level_1',
      start: [6, 0],
      end: [6, 4],
      thickness: 0.1,
    }),
    WallNode.parse({
      id: 'wall_n',
      parentId: 'level_1',
      start: [6, 4],
      end: [0, 4],
      thickness: 0.1,
    }),
    WallNode.parse({
      id: 'wall_w',
      parentId: 'level_1',
      start: [0, 4],
      end: [0, 0],
      thickness: 0.1,
    }),
    ZoneNode.parse({
      id: 'zone_k',
      parentId: 'level_1',
      name: 'Kitchen',
      polygon: [
        [0.05, 0.05],
        [5.95, 0.05],
        [5.95, 3.95],
        [0.05, 3.95],
      ],
    }),
    ...extra,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as SceneNodes
}

/** A wall-hung piece whose depth stands it out of the face it is on. */
const hanging = () =>
  ItemNode.parse({
    id: 'item_hung',
    parentId: 'wall_s',
    wallId: 'wall_s',
    position: [3, 1.4, 0],
    side: 'front',
    asset: {
      id: 'rail',
      name: 'Rail',
      category: 'bathroom',
      thumbnail: '/thumb.webp',
      src: '/items/rail/model.glb',
      dimensions: [0.85, 0.6, 0.46],
      attachTo: 'wall-side',
    },
  })

const typesOf = (nodes: SceneNodes) =>
  (verifyScene(nodes, {}, { activeLevelId: 'level_1' }).result as { issues: { type: string }[] })
    .issues

describe('a finding type on probation', () => {
  test('is withheld; the others keep their order', () => {
    const issues = [
      { type: 'usage_pocket', message: 'first' },
      { type: 'usage_wall_object_protrudes', message: 'second' },
      { type: 'empty_levels', message: 'third' },
    ]
    expect(withoutProbation(issues)).toEqual([issues[0], issues[2]])
  })

  test('an empty list stays empty', () => {
    expect(withoutProbation([])).toEqual([])
  })

  test('the list names the type and why it is withheld', () => {
    expect(Object.keys(SCENE_CHECK_PROBATION)).toEqual(['usage_wall_object_protrudes'])
    expect(SCENE_CHECK_PROBATION.usage_wall_object_protrudes).toContain('towel rails')
  })

  test('verify_scene reports none of it while usageIssues still finds it', () => {
    const nodes = kitchen([hanging()], ['item_hung'])
    expect(usageIssues(nodes).some((issue) => issue.type === 'usage_wall_object_protrudes')).toBe(
      true,
    )
    setSdfChecks(true)
    try {
      const withheld = typesOf(nodes).filter(
        (issue) => issue.type === 'usage_wall_object_protrudes',
      )
      expect(withheld).toEqual([])
    } finally {
      setSdfChecks(false)
    }
  })
})
