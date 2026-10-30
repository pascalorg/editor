import { describe, expect, test } from 'bun:test'
import { type AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { addDoorTool, addWindowTool } from '../agent-tools/wall-openings'
import { type LevelNode, RAILING_GUARD_HEIGHT, railingWallDefaults, WallNode } from '../schema'
import { OPENING_SCENE, openingScene, WALL_OPENING_CASES } from './__fixtures__/wall-opening-cases'
import { placedDoorFace, planWallOpening } from './wall-openings'

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
