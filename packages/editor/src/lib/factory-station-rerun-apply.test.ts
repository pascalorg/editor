import { describe, expect, test } from 'bun:test'
import { AssemblyNode, BoxNode, LevelNode, ZoneNode } from '@pascal-app/core/schema'
import {
  prepareStationRerunPatches,
  stationRerunSpecFromResult,
  topLevelStationNodeIds,
} from './factory-station-rerun-apply'

describe('factory station rerun apply', () => {
  const level = LevelNode.parse({ id: 'level_current' })
  const oldZone = ZoneNode.parse({
    id: 'zone_feed_pump',
    name: 'Feed pump zone',
    parentId: level.id,
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    metadata: { stationId: 'feed_pump' },
  })
  const oldAssembly = AssemblyNode.parse({
    id: 'assembly_feed_pump',
    parentId: level.id,
    children: ['box_feed_pump_shell'],
    metadata: { stationId: 'feed_pump' },
  })
  const oldPart = BoxNode.parse({
    id: 'box_feed_pump_shell',
    parentId: oldAssembly.id,
    metadata: { stationId: 'feed_pump', semanticRole: 'pump_casing' },
  })
  const otherAssembly = AssemblyNode.parse({
    id: 'assembly_booster_pump',
    parentId: level.id,
    metadata: { stationId: 'booster_pump' },
  })
  const nodes = {
    [level.id]: level,
    [oldZone.id]: oldZone,
    [oldAssembly.id]: oldAssembly,
    [oldPart.id]: oldPart,
    [otherAssembly.id]: otherAssembly,
  }

  const rerunResult = {
    workflowRerun: {
      sourceRunId: 'run_source',
      stageId: 'equipment-compiler',
      stationId: 'feed_pump',
    },
  }

  test('reads station rerun metadata from a run result', () => {
    expect(stationRerunSpecFromResult(rerunResult)).toEqual({
      sourceRunId: 'run_source',
      stageId: 'equipment-compiler',
      stationId: 'feed_pump',
    })
  })

  test('finds only top-level nodes for a station replacement', () => {
    expect(topLevelStationNodeIds(nodes, 'feed_pump').sort()).toEqual([
      'assembly_feed_pump',
      'zone_feed_pump',
    ])
  })

  test('prepends old station deletes and reparents new station roots', () => {
    const newAssembly = AssemblyNode.parse({
      id: 'assembly_feed_pump_rerun',
      parentId: 'level_from_source_run',
      children: ['box_feed_pump_rerun_shell'],
      metadata: { stationId: 'feed_pump' },
    })
    const newPart = BoxNode.parse({
      id: 'box_feed_pump_rerun_shell',
      parentId: newAssembly.id,
      metadata: { stationId: 'feed_pump', semanticRole: 'pump_casing' },
    })

    expect(
      prepareStationRerunPatches({
        result: rerunResult,
        nodes,
        patches: [
          { op: 'create', parentId: 'level_from_source_run', node: newAssembly },
          { op: 'create', parentId: newAssembly.id, node: newPart },
        ],
      }),
    ).toEqual([
      { op: 'delete', id: 'zone_feed_pump' },
      { op: 'delete', id: 'assembly_feed_pump' },
      { op: 'create', parentId: 'level_current', node: newAssembly },
      { op: 'create', parentId: newAssembly.id, node: newPart },
    ])
  })

  test('leaves normal factory run patches unchanged', () => {
    const patches = [{ op: 'create', node: oldAssembly }]
    expect(prepareStationRerunPatches({ result: {}, nodes, patches })).toBe(patches)
  })
})
