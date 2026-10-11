import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { addDoorOutput, addWindowOutput } from '../agent-tools'
import { OPENING_SCENE, openingScene } from '../building/__fixtures__/wall-opening-cases'
import { applySceneChanges } from './apply-changes'
import type { SceneNodes } from './types'
import { addWallOpening } from './wall-opening'

// The MCP and the chat answered add_door and add_window with two envelopes around one
// operation (coordinateSystem and position on one side, ok, message and wallId on the other) and
// neither said what the scene held after. One result now, from core, that both pass through.

const scene = () => openingScene().nodes as unknown as SceneNodes

describe('add_door and add_window answer once, for every surface', () => {
  test('a door: the node to create, and the result the contract declares', () => {
    const nodes = scene()
    const { result, changes } = addWallOpening(nodes, {
      kind: 'door',
      wallId: OPENING_SCENE.main,
      t: 0.5,
    })
    expect(z.object(addDoorOutput).strict().parse(result)).toEqual(result)
    expect(result).toMatchObject({
      ok: true,
      wallId: OPENING_SCENE.main,
      t: 0.5,
      localX: 2,
      clamped: false,
      coordinateSystem: 'wall-local-meters',
      achieved: { created: { door: 1 }, updated: 0, deleted: {} },
    })
    const after = applySceneChanges(nodes as never, changes) as SceneNodes
    expect(after[result.doorId!]).toMatchObject({ type: 'door', parentId: OPENING_SCENE.main })
  })

  test('a window says its sill height, in the same shape', () => {
    const { result } = addWallOpening(scene(), {
      kind: 'window',
      wallId: OPENING_SCENE.main,
      t: 0.5,
    })
    expect(z.object(addWindowOutput).strict().parse(result)).toEqual(result)
    expect(result.sillHeight).toBeCloseTo(0.9, 6)
    expect(result.achieved.created).toEqual({ window: 1 })
  })
})
