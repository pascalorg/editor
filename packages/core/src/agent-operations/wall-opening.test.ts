import { describe, expect, test } from 'bun:test'
import { DOOR_TYPE_SIZES } from '@pascal-app/core/building'
import { z } from 'zod'
import { addDoorOutput, addWindowOutput, addWindowTool } from '../agent-tools'
import { createRoomTool } from '../agent-tools/create-room'
import { OPENING_SCENE, openingScene } from '../building/__fixtures__/wall-opening-cases'
import { LevelNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { AGENT_OPERATIONS } from './index'
import type { SceneNodes } from './types'
import { addWallOpening } from './wall-opening'

// The MCP and the chat answered add_door and add_window with two envelopes around one
// operation (coordinateSystem and position on one side, ok, message and wallId on the other) and
// neither said what the scene held after. One result now, from core, that both pass through.

const scene = () => openingScene().nodes as unknown as SceneNodes

describe('add_door and add_window answer once, for every surface', () => {
  test.each(Object.keys(DOOR_TYPE_SIZES) as (keyof typeof DOOR_TYPE_SIZES)[])(
    'a %s door: the node to create, and the result the contract declares',
    (doorType) => {
      const nodes = scene()
      const { result, changes } = addWallOpening(nodes, {
        kind: 'door',
        doorType,
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
      expect(after[result.doorId!]).toMatchObject({
        type: 'door',
        parentId: OPENING_SCENE.main,
        frameThickness: 0.02,
      })
    },
  )

  test('a window says its sill height, centred on the wall by default, in the same shape', () => {
    const { result } = addWallOpening(scene(), {
      kind: 'window',
      wallId: OPENING_SCENE.main,
      t: 0.5,
    })
    expect(z.object(addWindowOutput).strict().parse(result)).toEqual(result)
    expect(result.sillHeight).toBeCloseTo(0.5, 6)
    expect(result.achieved.created).toEqual({ window: 1 })
  })
})

test('create_room carries its door handle style from tool input to created node', () => {
  const level = LevelNode.parse({ id: 'level_room_handles' })
  const input = z.object(createRoomTool.input).parse({
    levelId: level.id,
    name: 'Office',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    doors: [{ wallIndex: 0, handleStyle: 'knob' }],
  })
  const outcome = AGENT_OPERATIONS.create_room({ [level.id]: level }, input as never, {
    activeLevelId: level.id,
  })
  const after = applySceneChanges({ [level.id]: level }, outcome.changes) as SceneNodes
  expect(Object.values(after).find((node) => node.type === 'door')).toMatchObject({
    handleStyle: 'knob',
  })
})

test('window authoring retains direction, tilt-turn, shutter and sill details on add_window and create_room', () => {
  const details = {
    windowType: 'tilt-turn' as const,
    openingDirection: 'inward' as const,
    tiltTurnMode: 'turn' as const,
    hingesSide: 'right' as const,
    shutterOpen: 0.25,
    shutterSides: 'left' as const,
    shutters: 'board-batten' as const,
    shutterWidth: 0.8,
    rollerShutter: 'concealed' as const,
    rollerShutterBoxHeight: 0.27,
    rollerShutterOpen: 0.5,
    sillInterior: true,
    sillInteriorDepth: 0.12,
    sillInteriorThickness: 0.04,
    sillInteriorOverhang: 0.02,
    sillOverhang: 0.1,
  }
  const input = z
    .object(addWindowTool.input)
    .parse({ wallId: OPENING_SCENE.main, t: 0.5, ...details })
  const outcome = addWallOpening(scene(), { kind: 'window', ...input })
  expect(outcome.changes.create?.[0]?.node).toMatchObject(details)
  const room = z.object(createRoomTool.input).parse({
    name: 'Room',
    polygon: [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ],
    windows: [{ wallIndex: 0, ...details }],
  })
  const result = AGENT_OPERATIONS.create_room(scene(), room, {
    activeLevelId: OPENING_SCENE.levelId,
  })
  const windows = result.changes.create?.filter((entry) => entry.node.type === 'window') ?? []
  expect(windows).toHaveLength(1)
  expect(windows[0]!.node).toMatchObject(details)
  for (const windowType of ['casement', 'awning'] as const) {
    const created = addWallOpening(scene(), {
      kind: 'window',
      wallId: OPENING_SCENE.main,
      windowType,
      t: 0.5,
    })
    expect(created.changes.create?.[0]?.node).toMatchObject({ openingDirection: 'outward' })
  }
})
