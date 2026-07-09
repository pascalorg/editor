import { beforeEach, describe, expect, test } from 'bun:test'
import { nodeRegistry, registerNode, spatialGridManager, useScene } from '@pascal-app/core'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { CabinetModuleNode, CabinetNode } from '../schema'

const LEVEL_ID = 'level_cabinet-placement-collision'

function levelNode() {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['cabinet_existing'],
    level: 0,
  }
}

describe('cabinet placement collision', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerNode(cabinetDefinition)
    registerNode(cabinetModuleDefinition)
    spatialGridManager.clear()
    useScene.setState({ nodes: {} })
  })

  test('ignores child module local footprints when the parent run is elsewhere', () => {
    const level = levelNode()
    const run = CabinetNode.parse({
      id: 'cabinet_existing',
      parentId: LEVEL_ID,
      position: [0, 0, 2],
      rotation: 0,
      children: ['cabinet-module_existing'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_existing',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 1.2,
      depth: 0.58,
    })
    useScene.setState({ nodes: { [level.id]: level, [run.id]: run, [module.id]: module } })

    const result = spatialGridManager.canPlaceOnFloor(
      LEVEL_ID,
      [0, 0, 0],
      [0.6, 0.84, 0.58],
      [0, 0, 0],
    )

    expect(result).toEqual({ valid: true, conflictIds: [] })
  })

  test('still blocks against the parent run world footprint', () => {
    const level = levelNode()
    const run = CabinetNode.parse({
      id: 'cabinet_existing',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: ['cabinet-module_existing'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_existing',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 1.2,
      depth: 0.58,
    })
    useScene.setState({ nodes: { [level.id]: level, [run.id]: run, [module.id]: module } })

    const result = spatialGridManager.canPlaceOnFloor(
      LEVEL_ID,
      [0, 0, 0],
      [0.6, 0.84, 0.58],
      [0, 0, 0],
    )

    expect(result.valid).toBe(false)
    expect(result.conflictIds).toEqual(['cabinet_existing'])
  })

  test('does not treat nested cabinet run local footprints as world blockers', () => {
    const level = levelNode()
    const rootRun = {
      ...CabinetNode.parse({
        id: 'cabinet_existing',
        parentId: LEVEL_ID,
        position: [10, 0, 0],
        rotation: 0,
        children: [],
      }),
      children: ['cabinet_child-run'],
    }
    const childRun = CabinetNode.parse({
      id: 'cabinet_child-run',
      parentId: rootRun.id,
      position: [5, 0, 0],
      rotation: 0,
      children: ['cabinet-module_nested'],
    })
    const nestedModule = CabinetModuleNode.parse({
      id: 'cabinet-module_nested',
      parentId: childRun.id,
      position: [0, 0.1, 0],
      width: 1.2,
      depth: 0.58,
    })
    useScene.setState({
      nodes: {
        [level.id]: level,
        [rootRun.id]: rootRun,
        [childRun.id]: childRun,
        [nestedModule.id]: nestedModule,
      },
    })

    const falseBlockAtChildLocal = spatialGridManager.canPlaceOnFloor(
      LEVEL_ID,
      [5, 0, 0],
      [0.6, 0.84, 0.58],
      [0, 0, 0],
    )
    const blockAtChildWorld = spatialGridManager.canPlaceOnFloor(
      LEVEL_ID,
      [15, 0, 0],
      [0.6, 0.84, 0.58],
      [0, 0, 0],
    )

    expect(falseBlockAtChildLocal).toEqual({ valid: true, conflictIds: [] })
    expect(blockAtChildWorld.valid).toBe(false)
    expect(blockAtChildWorld.conflictIds).toEqual(['cabinet_existing'])
  })
})
