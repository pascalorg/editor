import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, WallNode, WindowNode } from '@pascal-app/core'
import {
  buildConstructionModuleAdvisories,
  type ConstructionModuleProfile,
  DEFAULT_CONSTRUCTION_MODULE_PROFILES,
} from './construction-module-advisories'

const FOOT = 0.3048

const metricProfile: ConstructionModuleProfile = {
  ...DEFAULT_CONSTRUCTION_MODULE_PROFILES.find((profile) => profile.id === 'metric-common')!,
  enabled: true,
}

const imperialProfile: ConstructionModuleProfile = {
  ...DEFAULT_CONSTRUCTION_MODULE_PROFILES.find((profile) => profile.id === 'imperial-common')!,
  enabled: true,
}

function nodes(...items: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, AnyNode>
}

describe('construction module advisories', () => {
  test('keeps default construction module profiles optional and quiet', () => {
    const wall = WallNode.parse({
      id: 'wall_off_module',
      start: [0, 0],
      end: [3.97, 0],
    })

    expect(buildConstructionModuleAdvisories(nodes(wall))).toEqual([])
  })

  test('reports metric wall lengths that miss the configured construction module', () => {
    const compliantWall = WallNode.parse({
      id: 'wall_metric_ok',
      start: [0, 0],
      end: [4, 0],
    })
    const offModuleWall = WallNode.parse({
      id: 'wall_metric_off',
      start: [0, 0],
      end: [3.97, 0],
    })

    const advisories = buildConstructionModuleAdvisories(nodes(compliantWall, offModuleWall), {
      profiles: [metricProfile],
    })

    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toMatchObject({
      id: 'construction-module:metric-common:wall_metric_off:wall-length',
      nodeId: 'wall_metric_off',
      profileId: 'metric-common',
      kind: 'wall-length',
      module: 0.1,
      measured: 3.97,
      nearestMultiple: 4,
      severity: 'info',
    })
    expect(advisories[0]?.deviation).toBeCloseTo(0.03)
    expect(advisories[0]?.message).toContain('100 mm construction module')
  })

  test('checks overall level extents at exterior finish faces', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_bottom',
        parentId: 'level_main',
        start: [0, 0],
        end: [4.03, 0],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_right',
        parentId: 'level_main',
        start: [4.03, 0],
        end: [4.03, 3],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_top',
        parentId: 'level_main',
        start: [4.03, 3],
        end: [0, 3],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_left',
        parentId: 'level_main',
        start: [0, 3],
        end: [0, 0],
        thickness: 0.2,
      }),
    ]

    const advisories = buildConstructionModuleAdvisories(nodes(...walls), {
      profiles: [metricProfile],
    })

    expect(advisories).toContainEqual(
      expect.objectContaining({
        id: 'construction-module:metric-common:level_main:level-overall-width',
        nodeId: 'level_main',
        nodeType: 'level',
        kind: 'level-overall-width',
      }),
    )
    expect(
      advisories.find((advisory) => advisory.kind === 'level-overall-width')?.measured,
    ).toBeCloseTo(4.23)
    expect(advisories).not.toContainEqual(expect.objectContaining({ kind: 'level-overall-depth' }))
  })

  test('reports imperial opening widths that miss common inch modules', () => {
    const compliantDoor = DoorNode.parse({
      id: 'door_imperial_ok',
      width: 3 * FOOT,
    })
    const offModuleDoor = DoorNode.parse({
      id: 'door_imperial_off',
      width: 0.95,
    })

    const advisories = buildConstructionModuleAdvisories(nodes(compliantDoor, offModuleDoor), {
      profiles: [imperialProfile],
    })

    expect(advisories).toHaveLength(1)
    expect(advisories[0]).toMatchObject({
      id: 'construction-module:imperial-common:door_imperial_off:opening-width',
      nodeId: 'door_imperial_off',
      profileId: 'imperial-common',
      kind: 'opening-width',
    })
    expect(advisories[0]?.module).toBeCloseTo(12 * 0.0254)
    expect(advisories[0]?.message).toContain('1\'-0" construction module')
  })

  test('checks verified rough, masonry, and finish opening widths without inventing them', () => {
    const door = DoorNode.parse({
      id: 'door_verified_widths',
      width: 1.2,
      roughOpeningWidth: 1.23,
      masonryOpeningWidth: 1.4,
    })
    const window = WindowNode.parse({
      id: 'window_verified_widths',
      width: 1.2,
      finishOpeningWidth: 1.27,
    })

    const advisories = buildConstructionModuleAdvisories(nodes(door, window), {
      profiles: [metricProfile],
    })

    expect(advisories.map((advisory) => advisory.id)).toEqual([
      'construction-module:metric-common:door_verified_widths:rough-opening-width',
      'construction-module:metric-common:window_verified_widths:finish-opening-width',
    ])
  })

  test('can explicitly include disabled profiles for preflight previews', () => {
    const wall = WallNode.parse({
      id: 'wall_preview',
      start: [0, 0],
      end: [3.97, 0],
    })

    const advisories = buildConstructionModuleAdvisories(nodes(wall), {
      includeDisabled: true,
    })

    expect(advisories.map((advisory) => advisory.profileId).sort()).toEqual([
      'imperial-common',
      'metric-common',
    ])
  })
})
