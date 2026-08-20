import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, registerNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'
import { filterPreparedSceneForPrintContent } from './print-content-scope'
import { exportSceneToPrintStl } from './print-export'

function registerFixtureKind(category: 'site' | 'structure' | 'furnish'): string {
  const kind = `print-${category}-${crypto.randomUUID()}`
  registerNode({
    kind,
    schemaVersion: 1,
    category,
    defaults: () => ({}),
    capabilities: {},
  } as never)
  return kind
}

function printContentFixture() {
  const root = new THREE.Group()
  const building = new THREE.Group()
  const level = new THREE.Group()
  const wall = new THREE.Group()
  const furniture = new THREE.Group()
  wall.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2)))
  furniture.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  root.add(building)
  building.add(level)
  level.add(wall, furniture)

  const buildingKind = registerFixtureKind('site')
  const levelKind = registerFixtureKind('site')
  const wallKind = registerFixtureKind('structure')
  const furnitureKind = registerFixtureKind('furnish')

  sceneRegistry.nodes.set('building_main', building)
  sceneRegistry.nodes.set('level_ground', level)
  sceneRegistry.nodes.set('wall_main', wall)
  sceneRegistry.nodes.set('chair_main', furniture)

  const nodes: Record<string, AnyNode> = {
    building_main: {
      object: 'node',
      id: 'building_main',
      type: buildingKind,
      parentId: null,
      children: ['level_ground'],
    } as unknown as AnyNode,
    level_ground: {
      object: 'node',
      id: 'level_ground',
      type: levelKind,
      parentId: 'building_main',
      children: ['wall_main', 'chair_main'],
    } as unknown as AnyNode,
    wall_main: {
      object: 'node',
      id: 'wall_main',
      type: wallKind,
      parentId: 'level_ground',
    } as unknown as AnyNode,
    chair_main: {
      object: 'node',
      id: 'chair_main',
      type: furnitureKind,
      parentId: 'level_ground',
    } as unknown as AnyNode,
  }

  return { root, nodes }
}

describe('print content scope', () => {
  afterEach(() => {
    sceneRegistry.nodes.clear()
  })

  test('keeps registered structure and its transform ancestors while removing visible furniture', () => {
    const fixture = printContentFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })

    const structure = filterPreparedSceneForPrintContent(prepared.scene, fixture.nodes, 'structure')
    const print = exportSceneToPrintStl(structure, { scale: 100 })

    expect(structure.getObjectByName('building_main')).toBeDefined()
    expect(structure.getObjectByName('level_ground')).toBeDefined()
    expect(structure.getObjectByName('wall_main')).toBeDefined()
    expect(structure.getObjectByName('chair_main')).toBeUndefined()
    expect(print.report.triangleCount).toBe(12)
  })

  test('preserves all prepared semantic geometry in everything scope', () => {
    const fixture = printContentFixture()
    const prepared = prepareSceneForExport(fixture.root, fixture.nodes, { onlyVisible: true })

    const everything = filterPreparedSceneForPrintContent(
      prepared.scene,
      fixture.nodes,
      'everything',
    )
    const print = exportSceneToPrintStl(everything, { scale: 100 })

    expect(everything.getObjectByName('chair_main')).toBeDefined()
    expect(print.report.triangleCount).toBe(24)
  })
})
