import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { AGENT_OPERATIONS } from '../agent-operations'
import { createRoomTool } from '../agent-tools/create-room'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { addDoorTool, addWindowTool } from '../agent-tools/wall-openings'
import { getDoorOpeningSize } from '../lib/door-opening'
import { openingHostFacing } from '../lib/opening-casing'
import { getOpeningWallCut } from '../lib/opening-floor-datum'
import {
  type AnyNode,
  type LevelNode,
  RAILING_GUARD_HEIGHT,
  railingWallDefaults,
  SlabNode,
  WallNode,
  type WallNode as WallNodeType,
} from '../schema'
import { OPENING_SCENE, openingScene, WALL_OPENING_CASES } from './__fixtures__/wall-opening-cases'
import { clampDoorToWall, placedDoorFace, planWallOpening } from './wall-openings'

// Layer 1 of 3: the operation both agent surfaces call. The cases are the spec.
describe('planWallOpening', () => {
  for (const c of WALL_OPENING_CASES) {
    test(c.name, () => {
      const { nodes } = openingScene()
      const input = { kind: c.tool === 'add_door' ? 'door' : 'window', ...c.input } as never
      if ('refusal' in c.expect) {
        let error: unknown
        try {
          planWallOpening(nodes, input)
        } catch (thrown) {
          error = thrown
        }
        expect(isAgentRefusal(error)).toBe(true)
        expect((error as AgentRefusal).code).toBe(c.expect.refusal)
        for (const text of c.expect.mentions ?? []) expect((error as Error).message).toContain(text)
        return
      }
      const planned = planWallOpening(nodes, input)
      expect(planned.localX).toBeCloseTo(c.expect.localX, 6)
      expect(planned.node.position[0]).toBeCloseTo(c.expect.localX, 6)
      expect(planned.node.position[1]).toBeCloseTo(c.expect.centerY, 6)
      expect(planned.clamped).toBe(c.expect.clamped)
      expect(planned.node.casingFaceA).toBe(true)
      expect(planned.node.casingFaceB).toBe(true)
      expect(planned.node.frameThickness).toBe(0.02)
      if (c.expect.glassPanels) expect(JSON.stringify(planned.node)).toContain('"glass"')
      if (c.expect.node) expect(planned.node).toMatchObject(c.expect.node)
    })
  }
})

// Not a shared case: core stands a window taller than its wall on the floor and says it clamped,
// while a host refuses what pokes above the wall when it writes it ("The window does not fit").
describe('a window taller than its wall, with no sill given', () => {
  test('stands on the floor and is reported clamped', () => {
    const { nodes } = openingScene()
    const planned = planWallOpening(nodes, {
      kind: 'window',
      wallId: 'wall_main',
      t: 0.5,
      height: 3,
    })

    expect(planned.node.position[1]).toBeCloseTo(1.5, 6)
    expect(planned.sillHeight).toBeCloseTo(0, 6)
    expect(planned.clamped).toBe(true)
  })
})

// add_door's sill is rare: a door down to a floor sunk beside its wall (a garage under the house).
describe('a door given a sill', () => {
  /** The opening scene with a garage sunk 0.73 m beside the house, under wall_main past x = 2. */
  const sunken = () => {
    const { nodes } = openingScene()
    const slab = (id: string, x0: number, x1: number, elevation: number) =>
      SlabNode.parse({
        id,
        parentId: OPENING_SCENE.levelId,
        polygon: [
          [x0, -4],
          [x1, -4],
          [x1, 1],
          [x0, 1],
        ],
        elevation,
      })
    const house = slab('slab_house', -1, 2, 0.05)
    const garage = slab('slab_garage', 2, 5, -0.68)
    const level = nodes[OPENING_SCENE.levelId] as LevelNode
    return {
      ...nodes,
      [house.id]: house,
      [garage.id]: garage,
      [level.id]: { ...level, children: [...level.children, house.id, garage.id] },
    } as Record<string, AnyNode>
  }
  const bottomOf = (nodes: Record<string, AnyNode>, sillHeight: number) => {
    const planned = planWallOpening(nodes, {
      kind: 'door',
      wallId: OPENING_SCENE.main,
      t: 0.5,
      width: 2.4,
      height: 2.2,
      sillHeight,
    })
    const wall = nodes[OPENING_SCENE.main] as WallNodeType
    return { planned, bottom: getOpeningWallCut(wall, planned.node, nodes).bottom }
  }

  test('reaches down to the floor sunk beside the wall, and stops at the wall bottom', () => {
    const { planned, bottom } = bottomOf(sunken(), -2)
    expect(bottom).toBeCloseTo(-0.68, 6)
    expect(planned.clamped).toBe(true)
  })

  test('on a wall standing on its floor, it stays on the floor', () => {
    const { planned } = bottomOf(openingScene().nodes, -0.5)
    expect(planned.sillHeight).toBeCloseTo(0, 6)
    expect(planned.node.position[1]).toBeCloseTo(1.1, 6)
    expect(planned.clamped).toBe(true)
  })

  test('without one, a door stands on the floor and says no sill', () => {
    const planned = planWallOpening(sunken(), { kind: 'door', wallId: OPENING_SCENE.main, t: 0.5 })
    expect(planned.node.position[1]).toBeCloseTo(1.05, 6)
    expect(planned.sillHeight).toBeUndefined()
    expect(planned.clamped).toBe(false)
  })
})

// An agent wrote a front door's three glass strips off as "not possible": both tools take code,
// and their descriptions stopped at outline, type and style.
describe('where an opening beyond the fields is made', () => {
  test('add_door and add_window say what outline, type and style cannot express goes in code', () => {
    for (const tool of [addDoorTool, addWindowTool]) {
      expect(tool.description).toContain('code')
      expect(tool.description).toContain('glass strips')
    }
  })
})

// The user (2026-10-05 19:25): one rule for agents and people. A door placed by hand on an outside
// wall faces out whichever face is hovered (R still flips it); any other wall, the face hovered.
describe('the face a door placed by hand takes', () => {
  const { nodes } = openingScene()
  const wallOf = (id: string) => nodes[id] as never

  test('out on an outside wall, from either face', () => {
    for (const hovered of ['front', 'back'] as const) {
      expect(placedDoorFace(wallOf('wall_out_back'), hovered)).toBe('back')
      expect(placedDoorFace(wallOf('wall_out_front'), hovered)).toBe('front')
    }
  })

  test('the face hovered on a wall that does not know its outside', () => {
    expect(placedDoorFace(wallOf('wall_main'), 'back')).toBe('back')
    expect(placedDoorFace(wallOf('wall_main'), 'front')).toBe('front')
  })
})

// Not a shared case: a railing's openings are gaps in its guard.
describe('an opening on a railing', () => {
  const railed = () => {
    const { nodes } = openingScene()
    const railing = WallNode.parse({
      id: 'wall_railing',
      parentId: OPENING_SCENE.levelId,
      start: [0, 20],
      end: [4, 20],
      ...railingWallDefaults(),
    })
    const level = nodes[OPENING_SCENE.levelId] as LevelNode
    return {
      ...nodes,
      [railing.id]: railing,
      [level.id]: { ...level, children: [...level.children, railing.id] },
    }
  }

  test('a door is a gap as tall as the guard, standing on the floor, with no casing or threshold', () => {
    const planned = planWallOpening(railed(), { kind: 'door', wallId: 'wall_railing', t: 0.5 })
    expect(planned.node).toMatchObject({
      openingKind: 'opening',
      height: RAILING_GUARD_HEIGHT,
      threshold: false,
      casingFaceA: false,
      casingFaceB: false,
    })
    expect(planned.node.position[1]).toBeCloseTo(RAILING_GUARD_HEIGHT / 2, 6)
  })

  test('a window is refused: a guard has nothing for it to fill', () => {
    let error: unknown
    try {
      planWallOpening(railed(), { kind: 'window', wallId: 'wall_railing', t: 0.5 })
    } catch (thrown) {
      error = thrown
    }
    expect(isAgentRefusal(error)).toBe(true)
    expect((error as AgentRefusal).code).toBe('railing_window')
  })
})

for (const handleStyle of ['lever', 'lever-curved', 'knob', 'bar', 'plate'] as const) {
  test(`add_door carries ${handleStyle} from its wire input into the node`, () => {
    const input = z.object(addDoorTool.input).parse({ wallId: 'wall_main', t: 0.5, handleStyle })
    const planned = planWallOpening(openingScene().nodes, { ...input, kind: 'door' })
    expect(planned.node.type).toBe('door')
    if (planned.node.type === 'door') expect(planned.node.handleStyle).toBe(handleStyle)
  })
}
describe('agent-authored window details', () => {
  test.each(['casement', 'single-hung', 'double-hung', 'sliding', 'awning', 'hopper'] as const)(
    'add_window applies columns and rows per %s sash',
    (windowType) => {
      const input = z.object(addWindowTool.input).parse({
        wallId: OPENING_SCENE.main,
        t: 0.5,
        windowType,
        columns: 3,
        rows: 2,
        windowHandle: false,
        sillInterior: true,
        shutters: 'louvered',
        shutterWidth: '40 cm',
        rollerShutter: 'box',
        rollerShutterBoxHeight: '27 cm',
      })
      const { node } = planWallOpening(openingScene().nodes, { kind: 'window', ...input })
      expect(node).toMatchObject({
        type: 'window',
        windowType,
        sashGrid: true,
        columnRatios: [1 / 3, 1 / 3, 1 / 3],
        rowRatios: [0.5, 0.5],
        windowHandle: false,
        sillInterior: true,
        shutters: 'louvered',
        shutterWidth: 0.4,
        rollerShutter: 'box',
        rollerShutterBoxHeight: 0.27,
      })
    },
  )

  test('windows without requested divisions keep the optional sash grid absent', () => {
    for (const windowType of ['fixed', 'casement'] as const) {
      const { node } = planWallOpening(openingScene().nodes, {
        kind: 'window',
        wallId: OPENING_SCENE.main,
        t: 0.5,
        windowType,
      })
      expect(node).not.toHaveProperty('sashGrid')
    }
  })

  test('create_room preserves its operable window details', () => {
    const { nodes } = openingScene()
    const input = z.object(createRoomTool.input).parse({
      name: 'Study',
      levelId: OPENING_SCENE.levelId,
      polygon: [
        [20, 20],
        [24, 20],
        [24, 24],
        [20, 24],
      ],
      windows: [
        {
          wallIndex: 0,
          windowType: 'double-hung',
          columns: 3,
          rows: 2,
          sillInterior: true,
          shutters: 'panel',
          shutterWidth: 0.45,
        },
      ],
    })
    const outcome = AGENT_OPERATIONS.create_room(nodes, input, {
      activeLevelId: OPENING_SCENE.levelId,
    })
    const window = outcome.changes?.create?.find(({ node }) => node.type === 'window')?.node
    expect(window).toMatchObject({
      type: 'window',
      windowType: 'double-hung',
      sashGrid: true,
      columnRatios: [1 / 3, 1 / 3, 1 / 3],
      rowRatios: [0.5, 0.5],
      sillInterior: true,
      shutters: 'panel',
      shutterWidth: 0.45,
    })
  })
})

describe('swing door fixed lights', () => {
  const lights = { sidelightLeft: 0.3, sidelightRight: 0.5, transomHeight: 0.4 }
  test('add_door preserves leaf dimensions and cuts the full assembly', () => {
    const { nodes } = openingScene()
    const input = z.object(addDoorTool.input).parse({ wallId: 'wall_main', t: 0.5, ...lights })
    const { node } = planWallOpening(nodes, { ...input, kind: 'door' })
    expect(node).toMatchObject({ width: 0.9, height: 2.1, ...lights })
    expect(node.position[1]).toBeCloseTo(1.05)
    const cut = getOpeningWallCut(nodes.wall_main as WallNodeType, node, nodes)
    expect(cut.top).toBeCloseTo(2.5)
    const xs = cut.band.map(([x]) => x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.7)
  })

  test('placement clamps the whole asymmetric cutout and detects existing sidelights', () => {
    const { nodes } = openingScene()
    const first = planWallOpening(nodes, {
      kind: 'door',
      wallId: 'wall_main',
      t: 0,
      ...lights,
    }).node
    expect(first.position[0]).toBeCloseTo(0.75)
    const wall = nodes.wall_main as WallNodeType
    const scene = {
      ...nodes,
      [first.id]: first,
      [wall.id]: { ...wall, children: [...wall.children, first.id] },
    }
    expect(() =>
      planWallOpening(scene, {
        kind: 'door',
        wallId: wall.id,
        t: first.position[0] / 6 + 0.12,
        width: 0.3,
      }),
    ).toThrow()
  })

  test('create_room carries the fixed lights from tool input to its door', () => {
    const { nodes } = openingScene()
    const input = z.object(createRoomTool.input).parse({
      name: 'Entry',
      levelId: OPENING_SCENE.levelId,
      polygon: [
        [20, 20],
        [24, 20],
        [24, 24],
        [20, 24],
      ],
      doors: [{ wallIndex: 0, ...lights }],
    })
    const result = AGENT_OPERATIONS.create_room(nodes, input, {
      activeLevelId: OPENING_SCENE.levelId,
    })
    expect(result.changes?.create?.find(({ node }) => node.type === 'door')?.node).toMatchObject(
      lights,
    )
  })

  test('sliding and folding tool inputs preserve the chosen mechanism and style', () => {
    const { nodes } = openingScene()
    for (const fields of [
      { doorType: 'sliding', leafCount: 4, slidingStyle: 'bypass' },
      { doorType: 'folding', leafCount: 8, style: 'modern' },
    ]) {
      const input = z.object(addDoorTool.input).parse({ wallId: 'wall_main', t: 0.5, ...fields })
      const { node } = planWallOpening(nodes, { ...input, kind: 'door' })
      expect(node).toMatchObject({ doorType: fields.doorType, leafCount: fields.leafCount })
      if (node.type === 'door' && fields.style === 'modern')
        expect(node.segments.some((s) => s.type === 'glass')).toBe(false)
    }
  })
})

for (const wallId of [OPENING_SCENE.outFront, OPENING_SCENE.outBack]) {
  test(`add_door centres the complete entry cutout at t on ${wallId}`, () => {
    const { nodes } = openingScene()
    const { node, clamped } = planWallOpening(nodes, {
      kind: 'door',
      wallId,
      t: 0.35,
      sidelightLeft: 0.2,
      sidelightRight: 0.6,
    })
    expect(
      node.position[0] - getDoorOpeningSize(node).leafOffsetX * openingHostFacing(node),
    ).toBeCloseTo(1.4)
    expect(clamped).toBe(false)
  })
}

test('door clamp shortens the transom under an explicit wall top without changing the leaf', () => {
  const { nodes } = openingScene()
  const wall = nodes.wall_main as WallNodeType
  const fitted = clampDoorToWall(wall, 2, 0.9, 2.1, { transomHeight: 0.8 }, nodes)
  expect(fitted.clampedY).toBeCloseTo(1.05)
  expect(fitted.transomHeight).toBeCloseTo(0.4)
})

test('door clamp resolves a plane-bound wall ceiling and leaves an overheight leaf intact', () => {
  const { nodes } = openingScene()
  const wall = nodes[OPENING_SCENE.storey] as WallNodeType
  expect(clampDoorToWall(wall, 2, 0.9, 2.1, { transomHeight: 1 }, nodes).transomHeight).toBeCloseTo(
    0.7,
  )
  const fitted = clampDoorToWall(wall, 2, 0.9, 3, { transomHeight: 1 }, nodes)
  expect(fitted.transomHeight).toBe(0)
  expect(fitted.clampedY).toBe(1.5)
})
