import { describe, expect, test } from 'bun:test'
import {
  type Floor,
  FollowPresentation,
  type PresentationPort,
  type ViewPresentation,
} from './follow-pascal-presentation'

// The owner, 12 October, on 3114: Follow Pascal left the view in cutaway with the upper floors hidden
// after it stopped, and the walls looked invisible. Follow changes the presentation to see what a build
// works on; when it ends it puts back what it changed, and only that.

const GROUND: Floor = {
  buildingId: 'b',
  levelId: 'ground',
  zoneId: null,
  selectedIds: [],
  room: null,
}

/** A view and a record of every write made to it. */
function view(initial: Partial<ViewPresentation> = {}) {
  const state: ViewPresentation = {
    wall: 'up',
    levels: 'stacked',
    hideAbove: false,
    floor: { ...GROUND },
    ...initial,
  }
  const writes: string[] = []
  const port: PresentationPort = {
    read: () => ({ ...state, floor: { ...state.floor } }),
    setWall: (mode) => {
      writes.push(`wall:${mode}`)
      state.wall = mode
    },
    setLevels: (mode) => {
      writes.push(`levels:${mode}`)
      state.levels = mode
    },
    setHideAbove: (hide) => {
      writes.push(`hideAbove:${hide}`)
      state.hideAbove = hide
    },
    // A selected floor drops the room and what was picked, as the viewer's selection does.
    setFloor: ({ buildingId, levelId }) => {
      writes.push(`floor:${levelId}`)
      state.floor = {
        buildingId: buildingId ?? state.floor.buildingId,
        levelId,
        zoneId: null,
        selectedIds: [],
        room: null,
      }
    },
    putFloor: (floor) => {
      writes.push(`put:${floor.levelId}`)
      state.floor = { ...floor }
    },
  }
  return { state, writes, port }
}

describe('what Follow changes, it puts back', () => {
  test('the cutaway it switched to', () => {
    const { state, port } = view({ wall: 'up' })
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    expect(state.wall).toBe('cutaway')
    follow.restore()
    expect(state.wall).toBe('up')
  })

  test('the floor it selected, with the room and the picks the person had', () => {
    const had: Floor = {
      buildingId: 'b',
      levelId: 'upper',
      zoneId: 'zone_kitchen',
      selectedIds: ['item_a', 'item_b'],
      room: { levelId: 'upper', zoneId: 'zone_kitchen' },
    }
    const { state, port } = view({ floor: had })
    const follow = new FollowPresentation(port)
    follow.floor({ buildingId: 'b', levelId: 'ground' })
    expect(state.floor.levelId).toBe('ground')
    expect(state.floor.room).toBeNull()
    follow.restore()
    expect(state.floor).toEqual(had)
  })

  test('the upper floors it hid, and the level display it set', () => {
    const { state, port } = view({ hideAbove: false, levels: 'solo' })
    const follow = new FollowPresentation(port)
    follow.hideAbove(true)
    follow.levels('stacked')
    expect(state).toMatchObject({ hideAbove: true, levels: 'stacked' })
    follow.restore()
    expect(state).toMatchObject({ hideAbove: false, levels: 'solo' })
  })

  test('to what the person had before the first change, however many floors it visited', () => {
    const { state, port } = view()
    const follow = new FollowPresentation(port)
    follow.floor({ buildingId: 'b', levelId: 'upper' })
    follow.floor({ buildingId: 'b', levelId: 'roof' })
    follow.wall('cutaway')
    follow.wall('cutaway')
    follow.restore()
    expect(state.floor.levelId).toBe('ground')
    expect(state.wall).toBe('up')
  })

  test('nothing it did not change: a setting already as Follow wants it is not written', () => {
    const { writes, port } = view({ wall: 'cutaway', hideAbove: true, levels: 'stacked' })
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    follow.hideAbove(true)
    follow.levels('stacked')
    follow.floor({ buildingId: 'b', levelId: 'ground' })
    follow.restore()
    expect(writes).toEqual([])
  })

  test('once: ending again, with nothing held, writes nothing', () => {
    const { writes, port } = view()
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    follow.restore()
    const count = writes.length
    follow.restore()
    expect(writes).toHaveLength(count)
  })

  test('a later session starts from what the person has then', () => {
    const { state, port } = view()
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    follow.restore()
    state.wall = 'down'
    follow.wall('cutaway')
    follow.restore()
    expect(state.wall).toBe('down')
  })
})

describe("the person's own choices stand", () => {
  test('a wall mode picked while Follow is on is kept, and Follow does not take it back', () => {
    const { state, writes, port } = view({ wall: 'up' })
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    state.wall = 'translucent'
    follow.wall('cutaway')
    expect(state.wall).toBe('translucent')
    follow.restore()
    expect(state.wall).toBe('translucent')
    expect(writes).toEqual(['wall:cutaway'])
  })

  test('a floor picked while Follow is on is kept, and Follow does not select over it', () => {
    const { state, writes, port } = view()
    const follow = new FollowPresentation(port)
    follow.floor({ buildingId: 'b', levelId: 'upper' })
    state.floor = { ...state.floor, levelId: 'roof' }
    follow.floor({ buildingId: 'b', levelId: 'upper' })
    expect(state.floor.levelId).toBe('roof')
    follow.restore()
    expect(state.floor.levelId).toBe('roof')
    expect(writes).toEqual(['floor:upper'])
  })

  test('the floor stays when the person picked something on it', () => {
    const { state, writes, port } = view()
    const follow = new FollowPresentation(port)
    follow.floor({ buildingId: 'b', levelId: 'upper' })
    state.floor = { ...state.floor, selectedIds: ['item_x'] }
    follow.restore()
    expect(state.floor).toMatchObject({ levelId: 'upper', selectedIds: ['item_x'] })
    expect(writes).toEqual(['floor:upper'])
  })

  test('the settings are independent: a wall mode of their own, the floor still goes back', () => {
    const { state, port } = view()
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    follow.floor({ buildingId: 'b', levelId: 'upper' })
    state.wall = 'down'
    follow.restore()
    expect(state.wall).toBe('down')
    expect(state.floor.levelId).toBe('ground')
  })

  test("the person's choice is theirs for the session, then Follow may change it again", () => {
    const { state, port } = view()
    const follow = new FollowPresentation(port)
    follow.wall('cutaway')
    state.wall = 'down'
    follow.restore()
    follow.wall('cutaway')
    expect(port.read().wall).toBe('cutaway')
    follow.restore()
    expect(port.read().wall).toBe('down')
  })
})
