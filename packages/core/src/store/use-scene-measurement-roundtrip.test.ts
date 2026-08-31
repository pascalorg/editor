import { beforeEach, describe, expect, test } from 'bun:test'
import {
  AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  MeasurementNode,
  SiteNode,
} from '../schema'
import type { AnyNode as AnyNodeValue } from '../schema/types'
import useScene from './use-scene'

describe('scene measurement round-trip', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()
  })

  test('preserves a complete measurement graph across JSON and setScene', () => {
    const distance = MeasurementNode.parse({
      id: 'measurement_distance',
      parentId: 'level_ground',
      visible: false,
      measurement: {
        kind: 'distance',
        points: [
          [0.25, 0.5, 0.75],
          [4.5, 2.25, 1.5],
        ],
      },
    })
    const area = MeasurementNode.parse({
      id: 'measurement_area',
      parentId: 'level_ground',
      visible: true,
      measurement: {
        kind: 'area',
        base: [
          [0, 0, 0],
          [3, 0, 0],
          [3, 0, 2],
          [0, 0, 2],
        ],
      },
    })
    const volume = MeasurementNode.parse({
      id: 'measurement_volume',
      parentId: 'level_ground',
      visible: false,
      measurement: {
        kind: 'volume',
        base: [
          [1, 0, 1],
          [3, 0, 1],
          [3, 0, 4],
          [1, 0, 4],
        ],
        extrusion: [0.5, 2.5, 0],
      },
    })
    const level = LevelNode.parse({
      id: 'level_ground',
      parentId: 'building_main',
      level: 0,
      children: [distance.id, area.id, volume.id],
    })
    const building = BuildingNode.parse({
      id: 'building_main',
      parentId: 'site_measurements',
      children: [level.id],
    })
    const site = SiteNode.parse({
      id: 'site_measurements',
      children: [building.id],
    })

    const nodes = Object.fromEntries(
      [site, building, level, distance, area, volume].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNodeValue>
    const serialized = JSON.stringify({ nodes, rootNodeIds: [site.id] })
    const decoded = JSON.parse(serialized) as {
      nodes: Record<string, unknown>
      rootNodeIds: AnyNodeId[]
    }
    const parsedNodes = Object.fromEntries(
      Object.entries(decoded.nodes).map(([id, node]) => [id, AnyNode.parse(node)]),
    ) as Record<AnyNodeId, AnyNodeValue>

    useScene.getState().setScene(parsedNodes, decoded.rootNodeIds)

    const reloaded = useScene.getState()
    const reloadedSite = SiteNode.parse(reloaded.nodes[site.id])
    const reloadedBuilding = BuildingNode.parse(reloaded.nodes[building.id])
    const reloadedLevel = LevelNode.parse(reloaded.nodes[level.id])
    const reloadedMeasurements = [distance.id, area.id, volume.id].map((id) =>
      MeasurementNode.parse(AnyNode.parse(reloaded.nodes[id])),
    )

    expect(reloaded.rootNodeIds).toEqual([site.id])
    expect(reloadedSite.children).toEqual([building.id])
    expect(reloadedBuilding.children).toEqual([level.id])
    expect(reloadedLevel.children).toEqual([distance.id, area.id, volume.id])
    expect(
      reloadedMeasurements.map((node) => ({
        id: node.id,
        visible: node.visible,
        measurement: node.measurement,
      })),
    ).toEqual([
      { id: distance.id, visible: false, measurement: distance.measurement },
      { id: area.id, visible: true, measurement: area.measurement },
      { id: volume.id, visible: false, measurement: volume.measurement },
    ])
  })
})
