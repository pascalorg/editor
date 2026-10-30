import { wallSlots } from '../../node-slots/wall'
import {
  DEFAULT_RAILING_WALL,
  getRailingWallConfig,
  getRailingWallHeight,
  isRailingWall,
  RAILING_GUARD_HEIGHT,
  RAILING_GUARD_HEIGHT_TALL,
  RAILING_SPHERE_LIMIT,
  RAILING_STYLE_DEFAULTS,
  railingOpeningFields,
  railingWallDefaults,
} from './railing-wall'
import { WallNode } from './wall'

const IN = 0.0254

describe('railing wall defaults', () => {
  test('the default railing is the DCA 6 deck guard: 4x4 posts at most 6 ft apart, 2x2 balusters 3½ in clear on a rail 3½ in up, a 2x6 cap', () => {
    expect(DEFAULT_RAILING_WALL).toEqual({
      style: 'post-and-rail',
      postSpacing: 72 * IN,
      postSize: 3.5 * IN,
      infillSize: 1.5 * IN,
      infillGap: 3.5 * IN,
      bottomClearance: 3.5 * IN,
      cap: true,
    })
    expect(RAILING_GUARD_HEIGHT).toBeCloseTo(0.9144, 9)
    expect(RAILING_GUARD_HEIGHT_TALL).toBeCloseTo(1.0668, 9)
  })

  test('every style starts with openings a 4 in sphere cannot pass', () => {
    for (const members of Object.values(RAILING_STYLE_DEFAULTS)) {
      expect(members.infillGap).toBeLessThan(RAILING_SPHERE_LIMIT)
      expect(members.bottomClearance).toBeLessThan(RAILING_SPHERE_LIMIT)
    }
  })

  test('a drawn railing is a 36 in guard of its style, as thick as its posts, with no assembly', () => {
    const patch = railingWallDefaults()
    expect(patch).toEqual({
      wallType: 'railing',
      thickness: 3.5 * IN,
      height: RAILING_GUARD_HEIGHT,
      railing: DEFAULT_RAILING_WALL,
      assembly: undefined,
    })
    const cable = railingWallDefaults('cable')
    expect(cable.railing.style).toBe('cable')
    expect(cable.railing.postSize).toBeCloseTo(2 * IN, 9)
    expect(cable.thickness).toBe(cable.railing.postSize)

    const wall = WallNode.parse({ start: [0, 0], end: [4, 0], ...patch })
    expect(isRailingWall(wall)).toBe(true)
    expect(wall.height).toBe(RAILING_GUARD_HEIGHT)
    expect(wall.assembly).toBeUndefined()
  })
})

describe('railing wall config', () => {
  test('a partial config reads over the defaults; a wall saved before railings parses as it was', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      wallType: 'railing',
      railing: { style: 'glass' },
    })
    expect(wall.railing).toEqual({ ...DEFAULT_RAILING_WALL, style: 'glass' })
    expect(getRailingWallConfig({ railing: { postSpacing: 1.2 } })).toEqual({
      ...DEFAULT_RAILING_WALL,
      postSpacing: 1.2,
    })

    const plain = WallNode.parse({ start: [0, 0], end: [4, 0] })
    expect(plain.railing).toBeUndefined()
    expect(isRailingWall(plain)).toBe(false)
    expect(getRailingWallConfig(plain)).toBe(DEFAULT_RAILING_WALL)
  })

  test('a railing never follows the storey: with no height of its own it is a 36 in guard', () => {
    expect(getRailingWallHeight({})).toBe(RAILING_GUARD_HEIGHT)
    expect(getRailingWallHeight({ height: RAILING_GUARD_HEIGHT_TALL })).toBe(
      RAILING_GUARD_HEIGHT_TALL,
    )
  })

  test('a door on a railing is a gap as tall as the guard, with no casing or threshold', () => {
    expect(railingOpeningFields({ height: RAILING_GUARD_HEIGHT_TALL })).toEqual({
      openingKind: 'opening',
      height: RAILING_GUARD_HEIGHT_TALL,
      threshold: false,
      casingFaceA: false,
      casingFaceB: false,
    })
  })

  test('a railing paints its posts and rails and its infill, not two faces', () => {
    const wood = WallNode.parse({ start: [0, 0], end: [4, 0], ...railingWallDefaults() })
    expect(wallSlots(wood)).toEqual([
      { slotId: 'railing-frame', label: 'Posts & rails', default: 'library:preset-white' },
      { slotId: 'railing-infill', label: 'Infill', default: 'library:preset-white' },
    ])
    const glass = WallNode.parse({ start: [0, 0], end: [4, 0], ...railingWallDefaults('glass') })
    expect(wallSlots(glass).map((slot) => [slot.slotId, slot.default])).toEqual([
      ['railing-frame', 'library:metal-steel'],
      ['railing-infill', 'library:preset-glass'],
    ])
  })
})
